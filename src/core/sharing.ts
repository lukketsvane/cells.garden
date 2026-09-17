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
    /** The generated picture's seed; the user id before migration 0009. */
    avatar: string;
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
        .select('user_id, created_at, profiles(*)')
        .eq('garden_id', gardenId)
        .order('created_at');
    if (error) fail(error);
    return ((data ?? []) as unknown as { user_id: string; profiles: { display_name: string | null; avatar_seed?: string | null } | null }[])
        .map(m => ({ userId: m.user_id, name: m.profiles?.display_name || 'someone', avatar: m.profiles?.avatar_seed || m.user_id }));
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

// --- Collaborative plants (migration 0007) -----------------------------------

/** The token in a `#plant=<uuid>` hash, or null. */
export function plantTokenFromHash(hash: string): string | null {
    const match = /(?:^#|&)plant=([^&]+)/.exec(hash);
    const token = match ? decodeURIComponent(match[1]) : '';
    return UUID.test(token) ? token.toLowerCase() : null;
}

export function plantInviteUrl(token: string): string {
    return `${APP_URL}#plant=${token}`;
}

export interface SharedPlantRow {
    id: string;
    owner_id: string;
    data: import('./merge').PlantData;
    rev: number;
}

/** Make a plants row from a plant in this garden. The caller links it with sharedPlantId. */
export async function createSharedPlant(client: SupabaseClient, userId: string, data: import('./merge').PlantData): Promise<SharedPlantRow> {
    const { data: row, error } = await client
        .from('plants')
        .insert({ owner_id: userId, data })
        .select('id, owner_id, data, rev')
        .single();
    if (error) fail(error);
    return row as unknown as SharedPlantRow;
}

/** Present a plant invite; the user becomes a member. Returns the plant row. */
export async function joinPlant(client: SupabaseClient, token: string): Promise<SharedPlantRow> {
    const { data, error } = await client.rpc('join_plant', { invite: token });
    if (error) {
        if (error.code === 'P0002') throw new InvalidInviteError();
        if (error.code === '53400') throw new GardenFullError();
        fail(error);
    }
    const row = ((data ?? []) as { plant_id: string; data: import('./merge').PlantData; rev: number }[])[0];
    if (!row) throw new InvalidInviteError();
    const { data: owner } = await client.from('plants').select('owner_id').eq('id', row.plant_id).limit(1);
    const ownerId = ((owner ?? []) as { owner_id: string }[])[0]?.owner_id ?? '';
    return { id: row.plant_id, owner_id: ownerId, data: row.data, rev: row.rev };
}

export async function plantOwner(client: SupabaseClient, plantId: string): Promise<string | null> {
    const { data, error } = await client.from('plants').select('owner_id').eq('id', plantId).limit(1);
    if (error) fail(error);
    return ((data ?? []) as { owner_id: string }[])[0]?.owner_id ?? null;
}

export async function getPlantInvite(client: SupabaseClient, plantId: string): Promise<string | null> {
    const { data, error } = await client.from('plant_invites').select('token').eq('plant_id', plantId).limit(1);
    if (error) fail(error);
    return ((data ?? []) as { token: string }[])[0]?.token ?? null;
}

export async function renewPlantInvite(client: SupabaseClient, plantId: string): Promise<string> {
    const token = crypto.randomUUID();
    const { error } = await client.from('plant_invites').upsert({ plant_id: plantId, token, created_at: new Date().toISOString() });
    if (error) fail(error);
    return token;
}

export async function clearPlantInvite(client: SupabaseClient, plantId: string): Promise<void> {
    const { error } = await client.from('plant_invites').delete().eq('plant_id', plantId);
    if (error) fail(error);
}

export async function listPlantMembers(client: SupabaseClient, plantId: string): Promise<GardenMember[]> {
    const { data, error } = await client
        .from('plant_members')
        .select('user_id, created_at, profiles(*)')
        .eq('plant_id', plantId)
        .order('created_at');
    if (error) fail(error);
    return ((data ?? []) as unknown as { user_id: string; profiles: { display_name: string | null; avatar_seed?: string | null } | null }[])
        .map(m => ({ userId: m.user_id, name: m.profiles?.display_name || 'someone', avatar: m.profiles?.avatar_seed || m.user_id }));
}

export async function removePlantMember(client: SupabaseClient, plantId: string, userId: string): Promise<void> {
    const { error } = await client.from('plant_members').delete().eq('plant_id', plantId).eq('user_id', userId);
    if (error) fail(error);
}

/** The owner stops sharing: the row goes, everyone keeps their own copy. */
export async function deleteSharedPlant(client: SupabaseClient, plantId: string): Promise<void> {
    const { error } = await client.from('plants').delete().eq('id', plantId);
    if (error) fail(error);
}

// --- Friends and plant offers (migration 0009) --------------------------------

export interface Friend {
    userId: string;
    name: string;
    avatar: string;
    gardens: number;
    plants: number;
}

export interface PlantOffer {
    plantId: string;
    fromId: string;
    fromName: string;
    fromAvatar: string;
    seed: string;
}

/** Everyone who shares a garden or a plant with the signed-in user. */
export async function listFriends(client: SupabaseClient): Promise<Friend[]> {
    const { data, error } = await client.rpc('friends');
    if (error) fail(error);
    return ((data ?? []) as { user_id: string; display_name: string; avatar_seed: string; gardens: number; plants: number }[])
        .map(f => ({ userId: f.user_id, name: f.display_name || 'someone', avatar: f.avatar_seed || f.user_id, gardens: Number(f.gardens), plants: Number(f.plants) }));
}

/** Offer a plant to a friend. They take it into their garden or turn it down. */
export async function offerPlant(client: SupabaseClient, plantId: string, friendId: string): Promise<void> {
    const { error } = await client.rpc('offer_plant', { pid: plantId, friend: friendId });
    if (error) fail(error);
}

/** Offers this plant is waiting on: who it was sent to and has not taken it yet. */
export async function pendingOffersFor(client: SupabaseClient, plantId: string): Promise<Set<string>> {
    const { data, error } = await client.from('plant_offers').select('to_id').eq('plant_id', plantId);
    if (error) fail(error);
    return new Set(((data ?? []) as { to_id: string }[]).map(r => r.to_id));
}

export async function listPlantOffers(client: SupabaseClient): Promise<PlantOffer[]> {
    const { data, error } = await client.rpc('plant_offers_for_me');
    if (error) fail(error);
    return ((data ?? []) as { plant_id: string; from_id: string; from_name: string; from_avatar: string; seed: string }[])
        .map(o => ({ plantId: o.plant_id, fromId: o.from_id, fromName: o.from_name, fromAvatar: o.from_avatar || o.from_id, seed: o.seed }));
}

/** Take an offered plant: the user becomes a member and gets the row back. */
export async function acceptPlantOffer(client: SupabaseClient, plantId: string): Promise<SharedPlantRow> {
    const { data, error } = await client.rpc('accept_plant_offer', { pid: plantId });
    if (error) {
        if (error.code === 'P0002') throw new InvalidInviteError();
        if (error.code === '53400') throw new GardenFullError();
        fail(error);
    }
    const row = ((data ?? []) as { plant_id: string; owner_id: string; data: import('./merge').PlantData; rev: number }[])[0];
    if (!row) throw new InvalidInviteError();
    return { id: row.plant_id, owner_id: row.owner_id, data: row.data, rev: row.rev };
}

export async function declinePlantOffer(client: SupabaseClient, plantId: string, userId: string): Promise<void> {
    const { error } = await client.from('plant_offers').delete().eq('plant_id', plantId).eq('to_id', userId);
    if (error) fail(error);
}

// --- The signed-in user's own profile -----------------------------------------

export interface Profile {
    name: string;
    avatar: string;
}

export async function getProfile(client: SupabaseClient, userId: string): Promise<Profile> {
    const { data, error } = await client.from('profiles').select('*').eq('id', userId).limit(1);
    if (error) fail(error);
    const row = ((data ?? []) as { display_name: string | null; avatar_seed?: string | null }[])[0];
    return { name: row?.display_name ?? '', avatar: row?.avatar_seed || userId };
}

export async function updateProfile(client: SupabaseClient, userId: string, changes: { name?: string; avatar?: string }): Promise<void> {
    const patch: Record<string, string> = {};
    if (changes.name !== undefined) patch.display_name = changes.name;
    if (changes.avatar !== undefined) patch.avatar_seed = changes.avatar;
    const { error } = await client.from('profiles').update(patch).eq('id', userId);
    if (error) fail(error);
}
