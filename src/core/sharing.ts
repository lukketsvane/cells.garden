/**
 * Shared gardens (M4): the calls behind the share modal, the garden list in the
 * pill menu and the invite link. No UI here; a failure the user should read
 * comes back as a ShareError. Needs migrations 0005 and 0006;
 * `sharingAvailable()` hides the feature when they are missing.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlantData } from './merge';

/** Where invite links point. Every build talks to the same project, so one origin serves all. */
export const APP_URL = 'https://cells.garden/';

/** A failure worded for the user: its message is what the UI shows. */
export class ShareError extends Error {}

const linkGone = () => new ShareError('This link no longer works.');

interface SharedGarden {
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

/** A database function's reply; its rows are cast where they are read. */
type Rpc = { data: unknown; error: PgError | null };

function fail(error: PgError): never {
    if (MISSING.has(error.code ?? '')) throw new ShareError('Sharing is not available.');
    throw new Error(error.message ?? 'Request failed');
}

/** Joining says the same two things whether it is a garden or a plant. */
function failJoin(error: PgError): never {
    if (error.code === 'P0002') throw linkGone();
    if (error.code === '53400') throw new ShareError('That garden is full.');
    fail(error);
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

/** The uuid a `#join=` or `#plant=` hash carries, or null. */
function tokenFromHash(hash: string, name: string): string | null {
    const match = new RegExp(`(?:^#|&)${name}=([^&]+)`).exec(hash);
    const token = match ? decodeURIComponent(match[1]) : '';
    return UUID.test(token) ? token.toLowerCase() : null;
}

export const inviteTokenFromHash = (hash: string) => tokenFromHash(hash, 'join');

export const inviteUrl = (token: string) => `${APP_URL}#join=${token}`;

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
    const { data, error } = (await client.rpc('join_garden', { invite: token })) as Rpc;
    if (error) failJoin(error);
    const row = ((data ?? []) as { garden_id: string; name: string }[])[0];
    if (!row) throw linkGone();
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

/**
 * Gardens and plants are shared the same way: an invites table holding one
 * token per thing, and a members table holding everyone who used it. Only the
 * table and the column that names the thing differ.
 */
const GARDEN = { invites: 'garden_invites', members: 'garden_members', key: 'garden_id' } as const;
const PLANT = { invites: 'plant_invites', members: 'plant_members', key: 'plant_id' } as const;
type Shared = typeof GARDEN | typeof PLANT;

async function invite(client: SupabaseClient, of: Shared, id: string): Promise<string | null> {
    const { data, error } = await client.from(of.invites).select('token').eq(of.key, id).limit(1);
    if (error) fail(error);
    return ((data ?? []) as { token: string }[])[0]?.token ?? null;
}

/** Make a new link. Any older link for the same thing stops working. */
async function renew(client: SupabaseClient, of: Shared, id: string): Promise<string> {
    const token = crypto.randomUUID();
    const { error } = await client.from(of.invites).upsert({ [of.key]: id, token, created_at: new Date().toISOString() });
    if (error) fail(error);
    return token;
}

/** Turn the link off. People already in keep access. */
async function clear(client: SupabaseClient, of: Shared, id: string): Promise<void> {
    const { error } = await client.from(of.invites).delete().eq(of.key, id);
    if (error) fail(error);
}

async function members(client: SupabaseClient, of: Shared, id: string): Promise<GardenMember[]> {
    const { data, error } = await client
        .from(of.members)
        .select('user_id, created_at, profiles(*)')
        .eq(of.key, id)
        .order('created_at');
    if (error) fail(error);
    return ((data ?? []) as unknown as { user_id: string; profiles: { display_name: string | null; avatar_seed?: string | null } | null }[])
        .map(m => ({ userId: m.user_id, name: m.profiles?.display_name || 'someone', avatar: m.profiles?.avatar_seed || m.user_id }));
}

/** The owner removing someone, or a member leaving: the same delete. */
async function removeFrom(client: SupabaseClient, of: Shared, id: string, userId: string): Promise<void> {
    const { error } = await client.from(of.members).delete().eq(of.key, id).eq('user_id', userId);
    if (error) fail(error);
}

export const getInvite = (c: SupabaseClient, gardenId: string) => invite(c, GARDEN, gardenId);
export const renewInvite = (c: SupabaseClient, gardenId: string) => renew(c, GARDEN, gardenId);
export const clearInvite = (c: SupabaseClient, gardenId: string) => clear(c, GARDEN, gardenId);
export const listMembers = (c: SupabaseClient, gardenId: string) => members(c, GARDEN, gardenId);
export const removeMember = (c: SupabaseClient, gardenId: string, userId: string) => removeFrom(c, GARDEN, gardenId, userId);

export async function renameGarden(client: SupabaseClient, gardenId: string, name: string): Promise<void> {
    const { error } = await client.from('gardens').update({ name }).eq('id', gardenId);
    if (error) fail(error);
}

// --- Collaborative plants (migration 0007) -----------------------------------

export const plantTokenFromHash = (hash: string) => tokenFromHash(hash, 'plant');

export const plantInviteUrl = (token: string) => `${APP_URL}#plant=${token}`;

export interface SharedPlantRow {
    id: string;
    owner_id: string;
    data: PlantData;
    rev: number;
}

/** Make a plants row from a plant in this garden. The caller links it with sharedPlantId. */
export async function createSharedPlant(client: SupabaseClient, userId: string, data: PlantData): Promise<SharedPlantRow> {
    const { data: row, error } = await client
        .from('plants')
        .insert({ owner_id: userId, data })
        .select('id, owner_id, data, rev')
        .single();
    if (error) fail(error);
    return row;
}

/** Present a plant invite; the user becomes a member. Returns the plant row. */
export async function joinPlant(client: SupabaseClient, token: string): Promise<SharedPlantRow> {
    const { data, error } = (await client.rpc('join_plant', { invite: token })) as Rpc;
    if (error) failJoin(error);
    const row = ((data ?? []) as { plant_id: string; data: PlantData; rev: number }[])[0];
    if (!row) throw linkGone();
    const { data: owner } = await client.from('plants').select('owner_id').eq('id', row.plant_id).limit(1);
    const ownerId = ((owner ?? []) as { owner_id: string }[])[0]?.owner_id ?? '';
    return { id: row.plant_id, owner_id: ownerId, data: row.data, rev: row.rev };
}

export async function plantOwner(client: SupabaseClient, plantId: string): Promise<string | null> {
    const { data, error } = await client.from('plants').select('owner_id').eq('id', plantId).limit(1);
    if (error) fail(error);
    return ((data ?? []) as { owner_id: string }[])[0]?.owner_id ?? null;
}

export const getPlantInvite = (c: SupabaseClient, plantId: string) => invite(c, PLANT, plantId);
export const renewPlantInvite = (c: SupabaseClient, plantId: string) => renew(c, PLANT, plantId);
export const clearPlantInvite = (c: SupabaseClient, plantId: string) => clear(c, PLANT, plantId);
export const listPlantMembers = (c: SupabaseClient, plantId: string) => members(c, PLANT, plantId);
export const removePlantMember = (c: SupabaseClient, plantId: string, userId: string) => removeFrom(c, PLANT, plantId, userId);

/** The owner stops sharing: the row goes, everyone keeps their own copy. */
export async function deleteSharedPlant(client: SupabaseClient, plantId: string): Promise<void> {
    const { error } = await client.from('plants').delete().eq('id', plantId);
    if (error) fail(error);
}

// --- Friends and plant offers (migration 0009) --------------------------------

interface Friend {
    userId: string;
    name: string;
    avatar: string;
    gardens: number;
    plants: number;
}

interface PlantOffer {
    plantId: string;
    fromName: string;
    fromAvatar: string;
    seed: string;
}

/** Everyone who shares a garden or a plant with the signed-in user. */
export async function listFriends(client: SupabaseClient): Promise<Friend[]> {
    const { data, error } = (await client.rpc('friends')) as Rpc;
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
    const { data, error } = (await client.rpc('plant_offers_for_me')) as Rpc;
    if (error) fail(error);
    return ((data ?? []) as { plant_id: string; from_id: string; from_name: string; from_avatar: string; seed: string }[])
        .map(o => ({ plantId: o.plant_id, fromName: o.from_name, fromAvatar: o.from_avatar || o.from_id, seed: o.seed }));
}

/** Take an offered plant: the user becomes a member and gets the row back. */
export async function acceptPlantOffer(client: SupabaseClient, plantId: string): Promise<SharedPlantRow> {
    const { data, error } = (await client.rpc('accept_plant_offer', { pid: plantId })) as Rpc;
    if (error) failJoin(error);
    const row = ((data ?? []) as { plant_id: string; owner_id: string; data: PlantData; rev: number }[])[0];
    if (!row) throw linkGone();
    return { id: row.plant_id, owner_id: row.owner_id, data: row.data, rev: row.rev };
}

export async function declinePlantOffer(client: SupabaseClient, plantId: string, userId: string): Promise<void> {
    const { error } = await client.from('plant_offers').delete().eq('plant_id', plantId).eq('to_id', userId);
    if (error) fail(error);
}

// --- The signed-in user's own profile -----------------------------------------

interface Profile {
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
