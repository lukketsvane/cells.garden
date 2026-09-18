/**
 * Supabase: client factory + the cloud GardenStore (M1, shared gardens in M4).
 *
 * `gardens` holds one row per owner with the whole Garden blob in `data`. A
 * store opens either the signed-in user's own row or, with a target, a row
 * someone shared with them (migration 0005). RLS decides which rows a user can
 * read and update.
 *
 * Saves are compare-and-swap on `rev`, a version the database bumps on every
 * update. When someone else wrote first, the store fetches their version,
 * merges it with ours over the last version we both knew (merge.ts) and tries
 * again.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { mergeGardens } from './merge';
import type { Garden } from './model';
import { local } from './local';
import { GardenGoneError, gardenFrom, readJson, snapshot, writeJson, LOCAL_KEY, type GardenStore } from './store';

/** null when the build has no Supabase config: the app then stays local-only. */
export function createSupabase(): SupabaseClient | null {
    const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined ?? '').trim();
    const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined ?? '').trim();
    // Keep the auth session in the same host-provided device storage as the garden.
    // In Obsidian that means Plugin.loadData/saveData rather than Web Storage.
    const authStorage = {
        getItem: (storageKey: string) => local.get(`cells.garden/auth/${storageKey}`),
        setItem: (storageKey: string, value: string) => {
            local.set(`cells.garden/auth/${storageKey}`, value);
        },
        removeItem: (storageKey: string) => {
            local.remove(`cells.garden/auth/${storageKey}`);
        },
    };
    return url && key ? createClient(url, key, { auth: { flowType: 'pkce', storage: authStorage } }) : null;
}

interface GardenRow {
    id: string;
    user_id?: string;
    data: unknown;
    updated_at: string;
    rev?: number;
}

/** At most this many fetch-merge-retry rounds before a save gives up. */
const MAX_SAVE_ROUNDS = 4;

const rowToGarden = (row: GardenRow): Garden => gardenFrom(row.data ?? {}, row.updated_at);

export class SupabaseStore implements GardenStore {
    private rowId: string | null;
    /** Server version of the row as this store last saw it; null until known. */
    private rev: number | null = null;
    /** The last version this store knows the server held: the common base for a merge. */
    private base: Garden | null = null;
    /** What load() fetched, kept for mergeOffline(). */
    private loaded: Garden | null = null;
    /** A base remembered from an earlier session on this device, with its rev. */
    private remembered: { rev: number; garden: Garden } | null = null;
    private lastSeen = '';
    private channel: RealtimeChannel | null = null;
    private saving = false;
    private buffered: GardenRow | null = null;
    private listener: ((garden: Garden) => void) | null = null;

    constructor(
        private readonly client: SupabaseClient,
        private readonly userId: string,
        /** Open this row (a garden shared with the user) instead of the user's own. */
        private readonly gardenId?: string,
    ) {
        this.rowId = gardenId ?? null;
    }

    private get baseKey(): string {
        return `${LOCAL_KEY}/base/${this.gardenId ?? `user/${this.userId}`}`;
    }

    /** Not kept (storage full or blocked): an offline merge falls back to a union. */
    private rememberBase() {
        if (this.base && this.rev !== null) writeJson(this.baseKey, { rev: this.rev, garden: this.base });
    }

    private readRememberedBase(): { rev: number; garden: Garden } | null {
        const parsed = readJson<{ rev?: unknown; garden?: Garden }>(this.baseKey);
        if (!parsed || typeof parsed.rev !== 'number' || !parsed.garden || !Array.isArray(parsed.garden.projects)) return null;
        return { rev: parsed.rev, garden: parsed.garden };
    }

    /** Own garden: the newest row for this user. Shared: the target row. Adopts its id. */
    private async findRow(): Promise<GardenRow | null> {
        const q = this.client.from('gardens').select('id, data, updated_at, rev');
        const { data, error } = await (this.gardenId
            ? q.eq('id', this.gardenId).limit(1)
            : q.eq('user_id', this.userId).order('updated_at', { ascending: false }).limit(1));
        if (error) throw error;
        const row = ((data ?? []) as GardenRow[])[0];
        if (!row) return null;
        this.rowId = row.id;
        return row;
    }

    async load(): Promise<Garden | null> {
        const row = await this.findRow();
        if (!row) {
            if (this.gardenId) throw new GardenGoneError();
            return null;
        }
        const garden = rowToGarden(row);
        this.lastSeen = garden.updatedAt;
        this.loaded = snapshot(garden);
        if (typeof row.rev === 'number') {
            const remembered = this.readRememberedBase();
            this.remembered = remembered && remembered.rev <= row.rev ? remembered : null;
            this.rev = row.rev;
        }
        this.base = snapshot(garden);
        return garden;
    }

    async mergeOffline(local: Garden): Promise<Garden> {
        const remote = this.loaded ?? (await this.load());
        if (!remote) return local;
        // The remembered base is what this device last synced; with none, merge as a union.
        return mergeGardens(this.remembered?.garden ?? null, local, remote);
    }

    async save(garden: Garden): Promise<Garden | void> {
        this.saving = true;
        try {
            return await this.write(garden);
        } finally {
            this.saving = false;
            this.flushBuffered();
        }
    }

    private async write(garden: Garden): Promise<Garden | void> {
        this.lastSeen = garden.updatedAt;
        // Another page of the same user may have inserted the row a moment ago
        // (sign-in is broadcast to every tab): re-check before inserting.
        if (!this.rowId || this.rev === null) {
            const row = await this.findRow();
            if (row && typeof row.rev === 'number' && this.rev === null) {
                this.rev = row.rev;
                this.base = snapshot(rowToGarden(row));
            }
        }

        if (!this.rowId) {
            if (this.gardenId) throw new GardenGoneError();
            return this.insert(garden);
        }

        if (this.rev === null) {
            const { error } = await this.client
                .from('gardens')
                .update({ data: garden, updated_at: garden.updatedAt })
                .eq('id', this.rowId);
            if (error) throw error;
            return;
        }

        let local = garden;
        let merged = false;
        for (let round = 0; round < MAX_SAVE_ROUNDS; round++) {
            const { data, error } = await this.client
                .from('gardens')
                .update({ data: local, updated_at: local.updatedAt })
                .eq('id', this.rowId)
                .eq('rev', this.rev)
                .select('rev');
            if (error) throw error;
            const written = (data ?? []) as { rev: number }[];
            if (written.length > 0) {
                this.rev = written[0].rev;
                this.base = snapshot(local);
                this.lastSeen = local.updatedAt;
                this.rememberBase();
                return merged ? local : undefined;
            }

            // Nothing matched: someone wrote first, or the row is out of reach now.
            const { data: rows, error: fetchError } = await this.client
                .from('gardens')
                .select('id, data, updated_at, rev')
                .eq('id', this.rowId)
                .limit(1);
            if (fetchError) throw fetchError;
            const row = ((rows ?? []) as GardenRow[])[0];
            if (!row) throw new GardenGoneError();
            const remote = rowToGarden(row);
            local = mergeGardens(this.base, local, remote);
            merged = true;
            this.base = snapshot(remote);
            this.rev = row.rev ?? this.rev;
        }
        throw new Error('Garden Cells: the garden kept changing while saving; try again.');
    }

    private async insert(garden: Garden): Promise<Garden | void> {
        const { data, error } = await this.client
            .from('gardens')
            .insert({ user_id: this.userId, name: 'My garden', data: garden, updated_at: garden.updatedAt })
            .select('id, rev')
            .single();
        if (error) {
            // Unique index (migration 0002) refused a second row: adopt the existing one.
            if (error.code === '23505') {
                const row = await this.findRow();
                if (row) {
                    if (typeof row.rev === 'number') {
                        this.rev = row.rev;
                        this.base = snapshot(rowToGarden(row));
                    }
                    return this.write(garden);
                }
            }
            throw error;
        }
        const inserted = data as unknown as { id: string; rev?: number };
        this.rowId = inserted.id;
        if (typeof inserted.rev === 'number') {
            this.rev = inserted.rev;
            this.base = snapshot(garden);
            this.rememberBase();
        }
    }

    subscribe(listener: (garden: Garden) => void): () => void {
        this.listener = listener;
        const filter = this.gardenId ? `id=eq.${this.gardenId}` : `user_id=eq.${this.userId}`;
        this.channel = this.client
            .channel(`gardens:${this.gardenId ?? this.userId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'gardens', filter },
                (payload) => {
                    const row = payload.new as GardenRow | undefined;
                    if (!row || !row.id) return;
                    if (this.saving) {
                        // Our own save may already have merged this; decide once it lands.
                        this.buffered = row;
                        return;
                    }
                    void this.deliver(row);
                }
            )
            .subscribe();
        return () => {
            this.listener = null;
            this.buffered = null;
            void this.channel?.unsubscribe();
            this.channel = null;
        };
    }

    private flushBuffered() {
        const row = this.buffered;
        this.buffered = null;
        if (row) void this.deliver(row);
    }

    private async deliver(row: GardenRow) {
        // Our own writes come back too: skip anything not newer than what we hold.
        if (typeof row.rev === 'number' && this.rev !== null) {
            if (row.rev <= this.rev) return;
        } else if (rowToGarden(row).updatedAt <= this.lastSeen) {
            return;
        }
        // Realtime leaves out values too large for one message; fetch those.
        let full = row;
        if (row.data === undefined || row.data === null) {
            const { data } = await this.client.from('gardens').select('id, data, updated_at, rev').eq('id', row.id).limit(1);
            const fetched = ((data ?? []) as GardenRow[])[0];
            if (!fetched) return;
            full = fetched;
        }
        const garden = rowToGarden(full);
        // Own garden: rows are matched by user, so a row created by another page is followed.
        this.rowId = full.id;
        if (typeof full.rev === 'number') this.rev = full.rev;
        this.lastSeen = garden.updatedAt;
        this.base = snapshot(garden);
        this.rememberBase();
        this.listener?.(garden);
    }
}
