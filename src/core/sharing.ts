/**
 * Shared gardens (M4): the calls behind the share modal, the garden list in the
 * pill menu and the invite link. No UI here; errors come back typed so the UI
 * can word them. Needs migrations 0005 and 0006; `sharingAvailable()` hides the
 * feature when they are missing.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** Where invite links point. Every build talks to the same project, so one origin serves all. */
export const APP_URL = 'https://cells.garden/';

export class InvalidInviteError extends Error {
    constructor() { super('This link no longer works.'); this.name = 'InvalidInviteError'; }
}

export class GardenFullError extends Error {
    constructor() { super('That garden is full.'); this.name = 'GardenFullError'; }
}

export class SharingUnavailableError extends Error {
    constructor() { super('Sharing is not available.'); this.name = 'SharingUnavailableError'; }
}

export interface SharedGarden {
    id: string;
    name: string;
    ownerName: string;
}

export interface GardenMember {
    userId: string;
    name: string;
}

interface PgError { code?: string; message?: string }

const MISSING = new Set(['42P01', 'PGRST205', 'PGRST202', '42883']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(error: PgError): never {
    if (MISSING.has(error.code ?? '')) throw new SharingUnavailableError();
    throw new Error(error.message ?? 'Request failed');
}

let available: Promise<boolean> | null = null;

/** True when the sharing tables exist. Asked once per page. */
export function sharingAvailable(client: SupabaseClient): Promise<boolean> {
    available ??= (async () => {
        const { error } = await client.from('garden_members').select('garden_id').limit(1);
        if (!error) return true;
        if (!MISSING.has(error.code ?? '')) console.warn('Garden Cells: could not check for sharing', error);
        return false;
    })();
    return available;
}

/** The token in a `#join=<uuid>` hash, or null. */
export function inviteTokenFromHash(hash: string): string | null {
    const match = /(?:^#|&)join=([^&]+)/.exec(hash);
    const token = match ? decodeURIComponent(match[1]) : '';
    return UUID.test(token) ? token.toLowerCase() : null;
}

export function inviteUrl(token: string): string {
    return `${APP_URL}#join=${token}`;
}

/** Gardens other people shared with this user. */
export async function listSharedGardens(client: SupabaseClient, userId: string): Promise<SharedGarden[]> {
    const { data, error } = await client
        .from('garden_members')
        .select('garden_id, gardens(id, name, user_id)')
        .eq('user_id', userId);
    if (error) fail(error);
    const rows = (data ?? []) as unknown as { garden_id: string; gardens: { id: string; name: string; user_id: string } | null }[];
    const gardens = rows.map(r => r.gardens).filter((g): g is { id: string; name: string; user_id: string } => !!g);
    if (gardens.length === 0) return [];
    const { data: profiles } = await client
        .from('profiles')
        .select('id, display_name')
        .in('id', gardens.map(g => g.user_id));
    const names = new Map(((profiles ?? []) as { id: string; display_name: string | null }[]).map(p => [p.id, p.display_name ?? '']));
    return gardens
        .map(g => ({ id: g.id, name: g.name, ownerName: names.get(g.user_id) || 'someone' }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** Present an invite token; the user becomes a member. Returns the garden. */
export async function joinGarden(client: SupabaseClient, token: string): Promise<{ id: string; name: string }> {
    const { data, error } = await client.rpc('join_garden', { invite: token });
    if (error) {
        if (error.code === 'P0002') throw new InvalidInviteError();
        if (error.code === '53400') throw new GardenFullError();
        fail(error);
    }
    const row = ((data ?? []) as { garden_id: string; name: string }[])[0];
    if (!row) throw new InvalidInviteError();
    return { id: row.garden_id, name: row.name };
}

/** The own garden's row id, or null when the account has never saved. */
export async function ownGardenId(client: SupabaseClient, userId: string): Promise<{ id: string; name: string } | null> {
    const { data, error } = await client
        .from('gardens')
        .select('id, name')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1);
    if (error) fail(error);
    const row = ((data ?? []) as { id: string; name: string }[])[0];
    return row ?? null;
}

export async function getInvite(client: SupabaseClient, gardenId: string): Promise<string | null> {
    const { data, error } = await client.from('garden_invites').select('token').eq('garden_id', gardenId).limit(1);
    if (error) fail(error);
    return ((data ?? []) as { token: string }[])[0]?.token ?? null;
}

/** Make a new link. Any older link for this garden stops working. */
export async function renewInvite(client: SupabaseClient, gardenId: string): Promise<string> {
    const token = crypto.randomUUID();
    const { error } = await client.from('garden_invites').upsert({ garden_id: gardenId, token, created_at: new Date().toISOString() });
    if (error) fail(error);
    return token;
}

/** Turn the link off. People already in keep access. */
export async function clearInvite(client: SupabaseClient, gardenId: string): Promise<void> {
    const { error } = await client.from('garden_invites').delete().eq('garden_id', gardenId);
    if (error) fail(error);
}

export async function listMembers(client: SupabaseClient, gardenId: string): Promise<GardenMember[]> {
    const { data, error } = await client
        .from('garden_members')
        .select('user_id, created_at, profiles(display_name)')
        .eq('garden_id', gardenId)
        .order('created_at');
    if (error) fail(error);
    return ((data ?? []) as unknown as { user_id: string; profiles: { display_name: string | null } | null }[])
        .map(m => ({ userId: m.user_id, name: m.profiles?.display_name || 'someone' }));
}

/** The owner removing someone, or a member leaving: the same delete. */
export async function removeMember(client: SupabaseClient, gardenId: string, userId: string): Promise<void> {
    const { error } = await client.from('garden_members').delete().eq('garden_id', gardenId).eq('user_id', userId);
    if (error) fail(error);
}

export async function renameGarden(client: SupabaseClient, gardenId: string, name: string): Promise<void> {
    const { error } = await client.from('gardens').update({ name }).eq('id', gardenId);
    if (error) fail(error);
}
