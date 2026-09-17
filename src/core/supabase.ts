/**
 * Supabase: client factory + the cloud GardenStore (M1).
 *
 * `gardens` holds one row per user with the whole Garden blob in `data`.
 * Last-write-wins on `updated_at`. RLS keeps rows to their owner. Migration
 * 0002 adds a unique index on user_id; this store does not depend on it, so
 * it re-checks for an existing row before inserting and follows the newest
 * row per user in realtime.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { Garden } from './model';
import { emptyGarden } from './model';
import type { GardenStore } from './store';

export function supabaseConfig(): { url: string; key: string } | null {
    const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
    const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
    if (!url || !key) return null;
    return { url, key };
}

/** null when the build has no Supabase config: the app then stays local-only. */
export function createSupabase(): SupabaseClient | null {
    const cfg = supabaseConfig();
    if (!cfg) return null;
    return createClient(cfg.url, cfg.key, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            flowType: 'pkce',
        },
    });
}

interface GardenRow {
    id: string;
    user_id?: string;
    data: unknown;
    updated_at: string;
}

function rowToGarden(row: GardenRow): Garden {
    const base = emptyGarden();
    const data = (row.data ?? {}) as Partial<Garden>;
    return {
        version: 1,
        projects: Array.isArray(data.projects) ? data.projects : [],
        settings: { ...base.settings, ...(data.settings ?? {}) },
        updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : row.updated_at,
    };
}

export class SupabaseStore implements GardenStore {
    private rowId: string | null = null;
    private lastSeen = '';
    private channel: RealtimeChannel | null = null;

    constructor(private readonly client: SupabaseClient, private readonly userId: string) {}

    /** The newest row for this user, or null. Adopts its id. */
    private async findRow(): Promise<GardenRow | null> {
        const { data, error } = await this.client
            .from('gardens')
            .select('id, data, updated_at')
            .eq('user_id', this.userId)
            .order('updated_at', { ascending: false })
            .limit(1);
        if (error) throw error;
        const row = (data ?? [])[0] as GardenRow | undefined;
        if (!row) return null;
        this.rowId = row.id;
        return row;
    }

    async load(): Promise<Garden | null> {
        const row = await this.findRow();
        if (!row) return null;
        const garden = rowToGarden(row);
        this.lastSeen = garden.updatedAt;
        return garden;
    }

    async save(garden: Garden): Promise<void> {
        this.lastSeen = garden.updatedAt;
        // Another page of the same user may have inserted the row a moment ago
        // (sign-in is broadcast to every tab): re-check before inserting.
        if (!this.rowId) await this.findRow();
        if (this.rowId) {
            const { error } = await this.client
                .from('gardens')
                .update({ data: garden, updated_at: garden.updatedAt })
                .eq('id', this.rowId);
            if (error) throw error;
            return;
        }
        const { data, error } = await this.client
            .from('gardens')
            .insert({ user_id: this.userId, name: 'My garden', data: garden, updated_at: garden.updatedAt })
            .select('id')
            .single();
        if (error) {
            // Unique index (migration 0002) refused a second row: adopt the existing one.
            if (error.code === '23505') {
                const row = await this.findRow();
                if (row) return this.save(garden);
            }
            throw error;
        }
        this.rowId = (data as { id: string }).id;
    }

    subscribe(listener: (garden: Garden) => void): () => void {
        this.channel = this.client
            .channel(`gardens:${this.userId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'gardens', filter: `user_id=eq.${this.userId}` },
                (payload) => {
                    const row = payload.new as GardenRow | undefined;
                    if (!row || !row.id) return;
                    const garden = rowToGarden(row);
                    // Our own writes come back too: skip anything not newer than what we last wrote/saw.
                    // Rows are matched by user, not by a remembered id, so a row created by another
                    // page of the same user is followed instead of ignored.
                    if (garden.updatedAt <= this.lastSeen) return;
                    this.rowId = row.id;
                    this.lastSeen = garden.updatedAt;
                    listener(garden);
                }
            )
            .subscribe();
        return () => {
            this.channel?.unsubscribe();
            this.channel = null;
        };
    }
}
