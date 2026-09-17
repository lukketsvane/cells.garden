/**
 * One entry point for every distribution (web, PWA, extension pages).
 * Mounts the garden on `host`, local-first, and adds sign-in + sync when the
 * build carries Supabase config. With migrations 0005 and 0006 it also opens
 * gardens shared by link (`#join=<token>`) and lets the user switch between
 * their own garden and shared ones from the pill menu.
 */
import './shim';
import { GardenApp } from './app';
import { AuthPill, type MenuItem } from './auth';
import { PlantSync } from './plants';
import { LeaveGardenModal, ShareGardenModal } from './share';
import { SharePlantModal } from './share-plant';
import { FriendsModal } from './friends';
import { applyScene } from './scene';
import { SettingsModal } from './settings';
import {
    GardenFullError,
    InvalidInviteError,
    inviteTokenFromHash,
    joinGarden,
    getProfile,
    joinPlant,
    listPlantOffers,
    type SharedPlantRow,
    listSharedGardens,
    ownGardenId,
    plantTokenFromHash,
    removeMember,
    sharingAvailable,
    SharingUnavailableError,
} from './sharing';
import {
    anonymousGardenClaimedBy,
    claimAnonymousGarden,
    gardenStoreKey,
    GardenGoneError,
    LOCAL_KEY,
    LocalStore,
    userStoreKey,
} from './store';
import { createSupabase, SupabaseStore } from './supabase';
import { installTouchAdapter } from './touch';
import { BoardToggleButton, GardenFilesButton, openGardenFiles } from './transfer';

export interface BootOptions {
    /** Where a magic link should land. Defaults to the current page. */
    redirectTo?: string;
}

interface OpenGarden {
    id: string;
    name: string;
}

const PENDING_JOIN_KEY = `${LOCAL_KEY}/pendingJoin`;
/** An invite waits this long for a sign-in before it is dropped. */
const PENDING_JOIN_TTL = 24 * 60 * 60 * 1000;
const activeKey = (uid: string) => `${LOCAL_KEY}/active/${uid}`;

function readJson<T>(key: string): T | null {
    try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch {
        return null;
    }
}

function writeJson(key: string, value: unknown) {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Storage blocked: the choice just does not survive a reload.
    }
}

/**
 * Read `#join=<token>` from the address, keep it until a sign-in can use it, and
 * take it out of the address so it is not bookmarked or passed on by accident.
 * Kept in localStorage because the emailed sign-in link opens a new tab.
 */
type InviteKind = 'garden' | 'plant';

function stashInviteFromUrl() {
    if (typeof location === 'undefined') return;
    const garden = inviteTokenFromHash(location.hash);
    const plant = plantTokenFromHash(location.hash);
    const token = garden ?? plant;
    if (!token) return;
    writeJson(PENDING_JOIN_KEY, { token, kind: garden ? 'garden' : 'plant', at: Date.now() });
    history.replaceState(null, '', location.pathname + location.search);
}

function peekPendingJoin(): { token: string; kind: InviteKind } | null {
    const pending = readJson<{ token?: string; kind?: InviteKind; at?: number }>(PENDING_JOIN_KEY);
    if (!pending?.token || typeof pending.at !== 'number') return null;
    if (Date.now() - pending.at > PENDING_JOIN_TTL) {
        writeJson(PENDING_JOIN_KEY, null);
        return null;
    }
    return { token: pending.token, kind: pending.kind === 'plant' ? 'plant' : 'garden' };
}

function takePendingJoin(): string | null {
    return peekPendingJoin()?.token ?? null;
}

/** A one-line notice over the garden that goes away by itself. */
function notify(host: HTMLElement, text: string) {
    host.querySelector('.garden-notice')?.remove();
    const el = host.createDiv({ cls: 'garden-notice', text, attr: { role: 'status' } });
    setTimeout(() => el.remove(), 5000);
}

export async function bootGarden(host: HTMLElement, options: BootOptions = {}): Promise<GardenApp> {
    applyScene();
    // Extension pages never receive a link, so only the web app looks.
    const inExtension = !!(globalThis as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime?.id;
    if (!inExtension) stashInviteFromUrl();

    // Always start local so the garden shows instantly, signed in or not.
    const anonymous = new LocalStore();
    const app = new GardenApp(anonymous);

    try {
        await app.mount(host);
    } catch (e) {
        console.error('GARDEN CELLS CRASH IN MOUNT:', e);
        host.createEl('h2', { text: 'Garden Crashed' });
        host.createEl('p', { text: String(e) });
        return app;
    }

    // Fingers: the view speaks mouse; the adapter translates taps, holds and the divider drag.
    installTouchAdapter(host);

    // The corner button shows or hides the board. On the host, not in the view,
    // which rebuilds itself.
    new BoardToggleButton(host);

    // M1: when the build has Supabase config, offer sign-in and sync.
    const supabase = createSupabase();
    if (!supabase) {
        // No pill menu to hold export and import, so they keep a button.
        new GardenFilesButton(app, host);
        if (takePendingJoin()) {
            writeJson(PENDING_JOIN_KEY, null);
            notify(host, 'Sharing needs an account. This build has none.');
        }
        return app;
    }

    const pill = new AuthPill(supabase, host, { redirectTo: options.redirectTo });
    app.onSyncState = (state) => pill.setSyncState(state);

    let currentUser: string | null = null;
    /** The shared garden on screen, or null for the user's own. */
    let shared: OpenGarden | null = null;
    /** Keeps collaborative plants in step while someone is signed in. */
    let plants: PlantSync | null = null;

    const openGarden = async (uid: string, target: OpenGarden | null): Promise<void> => {
        shared = target;
        writeJson(activeKey(uid), target);
        pill.setLabel(target?.name ?? null);
        if (target) {
            try {
                await app.useStore(new SupabaseStore(supabase, uid, { gardenId: target.id }), {
                    mirror: new LocalStore(gardenStoreKey(target.id)),
                });
            } catch (e) {
                if (!(e instanceof GardenGoneError)) throw e;
                notify(host, `You no longer have access to ${target.name}. Showing your garden.`);
                await openGarden(uid, null);
            }
            return;
        }
        // The anonymous garden of this device is offered to an account that has
        // nothing yet, and only once, so a second account never inherits it.
        const claimedBy = anonymousGardenClaimedBy();
        const seed = app.store === anonymous && (!claimedBy || claimedBy === uid) ? app.toGarden() : null;
        await app.useStore(new SupabaseStore(supabase, uid), {
            mirror: new LocalStore(userStoreKey(uid)),
            seed,
            onSeedUsed: () => claimAnonymousGarden(uid),
        });
    };

    const fail = (e: unknown) => {
        console.error('Garden Cells: could not switch gardens', e);
        pill.setSyncState('error');
    };

    app.onGone = () => {
        const uid = currentUser;
        if (!uid || !shared) return;
        notify(host, `You no longer have access to ${shared.name}. Showing your garden.`);
        openGarden(uid, null).catch(fail);
    };

    /** Use a waiting invite, if there is one. Returns the garden it opened. */
    const joinPending = async (uid: string): Promise<OpenGarden | null> => {
        const pending = peekPendingJoin();
        if (!pending || pending.kind !== 'garden') return null;
        const token = pending.token;
        writeJson(PENDING_JOIN_KEY, null);
        try {
            const garden = await joinGarden(supabase, token);
            const own = await ownGardenId(supabase, uid).catch(() => null);
            if (own && own.id === garden.id) {
                notify(host, 'This is your garden.');
                return null;
            }
            notify(host, `Opened ${garden.name}.`);
            return garden;
        } catch (e) {
            if (e instanceof InvalidInviteError || e instanceof GardenFullError || e instanceof SharingUnavailableError) {
                notify(host, e.message);
            } else {
                console.error('Garden Cells: could not use the invite', e);
                notify(host, 'Could not open that link. Try it again.');
            }
            return null;
        }
    };

    /**
     * Put a plant someone shared into the user's own garden. Returns false when
     * it is already there. A plant whose id is taken here is given a new one, so
     * two people's gardens never collide over it.
     */
    const plantShared = async (row: SharedPlantRow, sync: PlantSync): Promise<boolean> => {
        if (app.gardenData.some(p => p.sharedPlantId === row.id)) return false;
        const taken = app.gardenData.some(p => p.id === row.data.id);
        sync.adopt(row);
        await app.addProject({
            ...row.data,
            id: taken ? `proj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` : row.data.id,
            order: app.gardenData.length,
            sharedPlantId: row.id,
        });
        return true;
    };

    const plantOffered = async (row: SharedPlantRow) => {
        const uid = currentUser;
        if (!uid || !plants) return;
        if (shared) await openGarden(uid, null);
        await plantShared(row, plants);
    };

    // The share icon on a plant's card.
    app.onSharePlant = (projectId: string) => {
        const uid = currentUser;
        if (!uid || !plants) {
            pill.signIn('Sign in to share a plant.');
            return;
        }
        if (shared) {
            notify(host, 'Open your own garden to share its plants.');
            return;
        }
        new SharePlantModal(supabase, uid, app, plants, projectId).open();
    };
    app.view?.scheduleRender();

    /** Use a waiting plant invite: the plant is added to the user's own garden. */
    const joinPendingPlant = async (uid: string, sync: PlantSync) => {
        const pending = peekPendingJoin();
        if (!pending || pending.kind !== 'plant') return;
        writeJson(PENDING_JOIN_KEY, null);
        try {
            if (shared) await openGarden(uid, null);
            const row = await joinPlant(supabase, pending.token);
            const planted = await plantShared(row, sync);
            notify(host, planted ? `Planted ${row.data.seed || row.data.name}.` : 'That plant is already in your garden.');
        } catch (e) {
            if (e instanceof InvalidInviteError || e instanceof GardenFullError || e instanceof SharingUnavailableError) {
                notify(host, e.message.replace('garden', 'plant'));
            } else {
                console.error('Garden Cells: could not use the plant link', e);
                notify(host, 'Could not open that link. Try it again.');
            }
        }
    };

    pill.setMenu(async (): Promise<MenuItem[]> => {
        const uid = currentUser;
        const common: MenuItem[] = [
            { label: 'Export or import', onClick: () => openGardenFiles(app) },
            {
                label: 'Settings',
                onClick: () => new SettingsModal(uid ? { client: supabase, userId: uid, onAvatar: (seed) => pill.setAvatar(seed) } : null).open(),
            },
        ];
        if (!uid || !(await sharingAvailable(supabase))) return common;
        const gardens = await listSharedGardens(supabase, uid);
        const items: MenuItem[] = [];
        if (gardens.length > 0) {
            items.push({ label: 'Gardens', heading: true });
            items.push({ label: 'My garden', active: !shared, onClick: () => { openGarden(uid, null).catch(fail); } });
            for (const g of gardens) {
                items.push({
                    label: g.name,
                    sub: `by ${g.ownerName}`,
                    active: shared?.id === g.id,
                    onClick: () => { openGarden(uid, { id: g.id, name: g.name }).catch(fail); },
                });
            }
        }
        const offers = await listPlantOffers(supabase).catch(() => []);
        items.push({
            label: 'Friends',
            sub: offers.length ? `${offers.length} new` : undefined,
            onClick: () => new FriendsModal(supabase, uid, plantOffered).open(),
        });
        if (!shared) {
            items.push({
                label: 'Share garden',
                onClick: async () => {
                    let own = await ownGardenId(supabase, uid);
                    if (!own) {
                        // A fresh account has no row until its first save.
                        await app.saveGardenData();
                        own = await ownGardenId(supabase, uid);
                    }
                    if (!own) {
                        notify(host, 'Could not share yet. Try again in a moment.');
                        return;
                    }
                    new ShareGardenModal(supabase, own.id, own.name, () => {}).open();
                },
            });
        } else {
            const leaving = shared;
            items.push({
                label: 'Leave garden',
                danger: true,
                onClick: () => new LeaveGardenModal(leaving.name, async () => {
                    try {
                        await removeMember(supabase, leaving.id, uid);
                        notify(host, `Left ${leaving.name}.`);
                        await openGarden(uid, null);
                    } catch (e) {
                        fail(e);
                    }
                }).open(),
            });
        }
        return [...items, ...common];
    });

    let askedToSignIn = false;
    supabase.auth.onAuthStateChange((_event, session) => {
        pill.setSession(session);
        const uid = session?.user.id ?? null;
        // An invite is waiting and nobody is signed in: ask once, on the first answer.
        if (!uid && !askedToSignIn && takePendingJoin()) {
            askedToSignIn = true;
            setTimeout(() => pill.signIn('Sign in to open the garden you were invited to.'), 0);
        }
        if (uid === currentUser) return; // token refresh, same user
        currentUser = uid;
        // Supabase asks that other client calls run outside this callback.
        setTimeout(() => {
            plants?.stop();
            plants = null;
            if (uid) {
                const sync = new PlantSync(supabase, uid, app);
                plants = sync;
                void (async () => {
                    const joined = await joinPending(uid);
                    const remembered = joined ?? readJson<OpenGarden>(activeKey(uid));
                    await openGarden(uid, remembered && remembered.id ? remembered : null);
                    sync.start();
                    await joinPendingPlant(uid, sync);
                    getProfile(supabase, uid).then((p) => pill.setAvatar(p.avatar)).catch(() => {});
                    const offers = await listPlantOffers(supabase).catch(() => []);
                    if (offers.length === 1) notify(host, `${offers[0].fromName} sent you ${offers[0].seed}. Open Friends to plant it.`);
                    else if (offers.length > 1) notify(host, `${offers.length} plants are waiting for you in Friends.`);
                })().catch(fail);
            } else {
                shared = null;
                pill.setLabel(null);
                pill.setAvatar(null);
                // Sign-out: show the anonymous garden again, never write the account's data into it.
                app.useStore(anonymous, { reconcile: false }).catch(fail);
            }
        }, 0);
    });

    return app;
}
