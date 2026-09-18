/**
 * Collaborative plants: one plant kept in step between everyone who has it.
 *
 * A shared plant is an ordinary plant in each person's garden with a
 * `sharedPlantId`, plus a `plants` row (migration 0007) that holds its cells.
 * This module keeps the two in step for the signed-in user:
 *
 *  - on open, each referenced row is fetched and merged with the local copy
 *  - edits made here are written to the row after the garden saves
 *    (compare-and-swap on `rev`, merge and retry when someone wrote first)
 *  - edits from others arrive over realtime and are merged into the local copy
 *
 * The garden blob keeps its copy of the plant, so the plant still works offline
 * and for anyone who cannot reach the row. The last version synced for each
 * plant is remembered on the device as the base for the next merge.
 */
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { GardenApp } from './app';
import { mergePlant, plantData, sameData, type PlantData } from './merge';
import type { ProjectData } from './model';
import { LOCAL_KEY, snapshot } from './store';

interface PlantRow {
    id: string;
    owner_id?: string;
    data: PlantData | null;
    rev: number;
}

interface Tracked {
    rev: number;
    base: PlantData;
    ownerId: string;
    channel: RealtimeChannel | null;
    /** Serialises writes and arrivals for this plant. */
    queue: Promise<void>;
}

const MAX_ROUNDS = 4;
const baseKey = (plantId: string) => `${LOCAL_KEY}/plant/${plantId}`;

function remember(plantId: string, rev: number, base: PlantData) {
    try {
        localStorage.setItem(baseKey(plantId), JSON.stringify({ rev, base }));
    } catch {
        // Storage full or blocked: the next offline merge is a union.
    }
}

function remembered(plantId: string): { rev: number; base: PlantData } | null {
    try {
        const raw = localStorage.getItem(baseKey(plantId));
        const parsed = raw ? (JSON.parse(raw) as { rev?: unknown; base?: PlantData }) : null;
        return parsed && typeof parsed.rev === 'number' && parsed.base ? { rev: parsed.rev, base: parsed.base } : null;
    } catch {
        return null;
    }
}

export class PlantSync {
    private tracked = new Map<string, Tracked>();
    /** Rows this user cannot reach (not a member, or the owner stopped sharing). */
    private unreachable = new Set<string>();
    private attaching = new Map<string, Promise<void>>();
    private stopped = false;
    private refreshTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private readonly client: SupabaseClient,
        private readonly userId: string,
        private readonly app: GardenApp,
    ) {}

    start() {
        this.app.onGardenApplied = () => this.scheduleRefresh();
        this.app.onPersisted = () => this.pushChanges();
        this.scheduleRefresh();
    }

    stop() {
        this.stopped = true;
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.app.onGardenApplied = null;
        this.app.onPersisted = null;
        for (const t of this.tracked.values()) void t.channel?.unsubscribe();
        this.tracked.clear();
    }

    /** Start following a plant that was just shared or joined, with its row as the base. */
    adopt(row: { id: string; owner_id: string; data: PlantData; rev: number }) {
        this.unreachable.delete(row.id);
        if (this.tracked.has(row.id)) return;
        const t: Tracked = { rev: row.rev, base: snapshot(row.data), ownerId: row.owner_id, channel: null, queue: Promise.resolve() };
        this.tracked.set(row.id, t);
        remember(row.id, row.rev, t.base);
        this.listen(row.id, t);
        this.reportOwners();
    }

    /** The shared plants someone else owns, for the garden's arrangement. */
    private reportOwners() {
        if (this.stopped) return;
        this.app.setFriendPlants([...this.tracked].filter(([, t]) => t.ownerId && t.ownerId !== this.userId).map(([id]) => id));
    }

    /** Stop following a plant (left, stopped sharing, or removed from the garden). */
    forget(plantId: string) {
        const t = this.tracked.get(plantId);
        void t?.channel?.unsubscribe();
        this.tracked.delete(plantId);
        this.unreachable.delete(plantId);
    }

    private project(plantId: string): ProjectData | undefined {
        return this.app.gardenData.find(p => p.sharedPlantId === plantId);
    }

    private scheduleRefresh() {
        if (this.stopped || this.refreshTimer) return;
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null;
            void this.refresh();
        }, 50);
    }

    /** Follow every shared plant the garden on screen holds, and drop the rest. */
    private async refresh() {
        const wanted = new Set(this.app.gardenData.map(p => p.sharedPlantId).filter((id): id is string => !!id));
        for (const id of [...this.tracked.keys()]) {
            if (!wanted.has(id)) this.forget(id);
        }
        await Promise.all([...wanted].filter(id => !this.tracked.has(id) && !this.unreachable.has(id)).map(id => this.attach(id)));
    }

    private attach(plantId: string): Promise<void> {
        const running = this.attaching.get(plantId);
        if (running) return running;
        const job = (async () => {
            const { data, error } = await this.client.from('plants').select('id, owner_id, data, rev').eq('id', plantId).limit(1);
            if (this.stopped) return;
            if (error) {
                console.warn('Garden Cells: could not open a shared plant', error);
                return;
            }
            const row = ((data ?? []) as PlantRow[])[0];
            const local = this.project(plantId);
            if (!row || !row.data || !local) {
                this.unreachable.add(plantId);
                return;
            }
            const remote = row.data;
            const t: Tracked = { rev: row.rev, base: snapshot(remote), ownerId: row.owner_id ?? '', channel: null, queue: Promise.resolve() };
            this.tracked.set(plantId, t);
            this.listen(plantId, t);
            this.reportOwners();

            // Edits made on this device while away are merged over the last synced version.
            const prior = remembered(plantId);
            const merged = mergePlant(prior ? prior.base : null, plantData(local), remote);
            remember(plantId, row.rev, t.base);
            if (!sameData(merged, plantData(local))) await this.app.patchProject(local.id, merged, false);
            const patched = !sameData(merged, plantData(local));
            if (!sameData(merged, remote)) this.enqueue(plantId, () => this.write(plantId, patched));
            else if (patched) await this.app.saveGardenData();
        })().finally(() => this.attaching.delete(plantId));
        this.attaching.set(plantId, job);
        return job;
    }

    private listen(plantId: string, t: Tracked) {
        t.channel = this.client
            .channel(`plants:${plantId}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'plants', filter: `id=eq.${plantId}` }, (payload) => {
                const row = payload.new as PlantRow | undefined;
                if (!row) return;
                this.enqueue(plantId, () => this.arrive(plantId, row));
            })
            .subscribe();
    }

    private enqueue(plantId: string, job: () => Promise<void>) {
        const t = this.tracked.get(plantId);
        if (!t) return;
        t.queue = t.queue.then(job, job).catch((e) => console.error('Garden Cells: shared plant sync failed', e));
    }

    /** Someone else changed the plant. */
    private async arrive(plantId: string, row: PlantRow) {
        const t = this.tracked.get(plantId);
        const local = this.project(plantId);
        if (!t || !local || row.rev <= t.rev) return;
        let remote = row.data;
        if (!remote) {
            // Too large for one realtime message: fetch it.
            const { data } = await this.client.from('plants').select('id, data, rev').eq('id', plantId).limit(1);
            const fetched = ((data ?? []) as PlantRow[])[0];
            if (!fetched?.data) return;
            remote = fetched.data;
            row = fetched;
        }
        const merged = mergePlant(t.base, plantData(local), remote);
        t.base = snapshot(remote);
        t.rev = row.rev;
        remember(plantId, t.rev, t.base);
        const patched = !sameData(merged, plantData(local));
        if (patched) await this.app.patchProject(local.id, merged, false);
        // Unsaved edits here that the arrival did not include still need to go out.
        if (!sameData(merged, remote)) await this.write(plantId, patched);
        else if (patched) await this.app.saveGardenData();
    }

    /** After a garden save: send every shared plant that differs from what the row holds. */
    private pushChanges() {
        for (const [plantId, t] of this.tracked) {
            const local = this.project(plantId);
            if (local && !sameData(plantData(local), t.base)) this.enqueue(plantId, () => this.write(plantId));
        }
    }

    /** `dirty`: the garden copy was changed by a merge and still needs saving. */
    private async write(plantId: string, dirty = false) {
        for (let round = 0; round < MAX_ROUNDS; round++) {
            const t = this.tracked.get(plantId);
            const local = this.project(plantId);
            if (!t || !local) return;
            const outgoing = plantData(local);
            if (sameData(outgoing, t.base)) {
                if (dirty) await this.app.saveGardenData();
                return;
            }

            const { data, error } = await this.client
                .from('plants')
                .update({ data: outgoing })
                .eq('id', plantId)
                .eq('rev', t.rev)
                .select('rev');
            if (error) throw error;
            const written = (data ?? []) as { rev: number }[];
            if (written.length > 0) {
                t.rev = written[0].rev;
                t.base = snapshot(outgoing);
                remember(plantId, t.rev, t.base);
                if (dirty) await this.app.saveGardenData();
                return;
            }

            // Someone wrote first, or access is gone.
            const { data: rows, error: fetchError } = await this.client.from('plants').select('id, data, rev').eq('id', plantId).limit(1);
            if (fetchError) throw fetchError;
            const row = ((rows ?? []) as PlantRow[])[0];
            if (!row?.data) {
                this.forget(plantId);
                this.unreachable.add(plantId);
                return;
            }
            const merged = mergePlant(t.base, outgoing, row.data);
            t.base = snapshot(row.data);
            t.rev = row.rev;
            await this.app.patchProject(local.id, merged, false);
            dirty = true;
        }
        throw new Error('Garden Cells: a shared plant kept changing while saving.');
    }
}
