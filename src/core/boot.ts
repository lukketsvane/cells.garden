/**
 * One entry point for every distribution (web, PWA, extension pages).
 * Mounts the garden on `host`, local-first, and adds sign-in + sync when the
 * build carries Supabase config. With migrations 0005 and 0006 it also opens
 * gardens shared by link (`#join=<token>`) and lets the user switch between
 * their own garden and shared ones from the pill menu.
 */
import './shim';
import { GardenApp } from './app';
import { AuthPill, type AuthOptions } from './auth';
import type { MenuItem } from './menu';
import { PlantSync } from './plants';
import { GardenQuestionModal, NewSpaceModal, ShareGardenModal } from './share';
import { SharePlantModal } from './share-plant';
import { FriendsModal } from './friends';
import { PetsModal } from './pets';
import { applyScene } from './scene';
import { SettingsModal } from './settings';
import {
    inviteTokenFromHash,
    joinGarden,
    getProfile,
    joinPlant,
    listPlantOffers,
    type SharedPlantRow,
    createSpace,
    deleteSpace,
    listOwnSpaces,
    listSharedGardens,
    ownGardenId,
    plantTokenFromHash,
    removeMember,
    ShareError,
    sharingAvailable,
} from './sharing';
import {
    anonymousGardenClaimedBy,
    claimAnonymousGarden,
    GardenGoneError,
    LOCAL_KEY,
    LocalStore,
    readJson,
    writeJson,
} from './store';
import { createSupabase, SupabaseStore } from './supabase';
import { installTouchAdapter } from './touch';
import { BoardToggleButton, GardenFilesButton, openGardenFiles } from './transfer';

declare global {
    /** The mounted app, handy in the console while developing. */
    interface Window { garden: GardenApp | undefined }
}

interface OpenGarden {
    id: string;
    name: string;
}

const PENDING_JOIN_KEY = `${LOCAL_KEY}/pendingJoin`;
/** An invite waits this long for a sign-in before it is dropped. */
const PENDING_JOIN_TTL = 24 * 60 * 60 * 1000;
const activeKey = (uid: string) => `${LOCAL_KEY}/active/${uid}`;

type InviteKind = 'garden' | 'plant';

/**
 * Read `#join=<token>` from the address, keep it until a sign-in can use it, and
 * take it out of the address so it is not bookmarked or passed on by accident.
 * Kept in localStorage because the emailed sign-in link opens a new tab.
 */
function stashInviteFromUrl() {
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

/** A one-line notice over the garden that goes away by itself. */
function notify(host: HTMLElement, text: string) {
    host.querySelector('.garden-notice')?.remove();
    const el = host.createDiv({ cls: 'garden-notice', text, attr: { role: 'status' } });
    window.setTimeout(() => el.remove(), 5000);
}

/** `options.redirectTo`: where a magic link should land. Defaults to the current page. */
export async function bootGarden(host: HTMLElement, options: AuthOptions = {}): Promise<GardenApp> {
    applyScene();
    // Extension pages never receive a link, so only the web app looks.
    const inExtension = !!(window as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime?.id;
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
        if (peekPendingJoin()) {
            writeJson(PENDING_JOIN_KEY, null);
            notify(host, 'Sharing needs an account. This build has none.');
        }
        return app;
    }

    options.onClient?.(supabase);
    const pill = new AuthPill(supabase, host, options);
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
                await app.useStore(new SupabaseStore(supabase, uid, target.id), {
                    mirror: new LocalStore(`${LOCAL_KEY}/garden/${target.id}`),
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
            mirror: new LocalStore(`${LOCAL_KEY}/user/${uid}`),
            seed,
            onSeedUsed: () => claimAnonymousGarden(uid),
        });
    };

    const fail = (e: unknown) => {
        console.error('Garden Cells: could not switch gardens', e);
        pill.setSyncState('error');
    };

    /** An invite that could not be used: say why when the reason is worded for the user. */
    const linkFailed = (e: unknown, kind: InviteKind) => {
        if (e instanceof ShareError) return notify(host, e.message.replace('garden', kind));
        console.error('Garden Cells: could not use the invite', e);
        notify(host, 'Could not open that link. Try it again.');
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
            linkFailed(e, 'garden');
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
            linkFailed(e, 'plant');
        }
    };

    pill.setMenu(async (): Promise<MenuItem[]> => {
        const uid = currentUser;
        const petCount = [app.settings.petSwan, app.settings.petGnome, app.settings.petPumpkin].filter(Boolean).length;
        const common: MenuItem[] = [
            { label: 'Export or import', onClick: () => openGardenFiles(app) },
            {
                label: 'Pets',
                sub: petCount ? petCount + ' on' : 'Off',
                onClick: () => new PetsModal(app).open(),
            },
            {
                label: 'Settings',
                onClick: () => new SettingsModal(uid ? { client: supabase, userId: uid, onAvatar: (seed) => pill.setAvatar(seed) } : null, app).open(),
            },
        ];
        if (!uid || !(await sharingAvailable(supabase))) return common;
        const [gardens, spaces] = await Promise.all([listSharedGardens(supabase, uid), listOwnSpaces(supabase, uid)]);
        const items: MenuItem[] = [];
        if (gardens.length + spaces.length > 0) {
            items.push({ label: 'Gardens', heading: true });
            items.push({ label: 'My garden', active: !shared, onClick: () => { openGarden(uid, null).catch(fail); } });
            for (const s of spaces) {
                items.push({ label: s.name, active: shared?.id === s.id, onClick: () => { openGarden(uid, s).catch(fail); } });
            }
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
        items.push({
            label: 'New garden space',
            onClick: () => new NewSpaceModal(async (name) => {
                try {
                    await openGarden(uid, await createSpace(supabase, uid, name));
                } catch (e) {
                    notify(host, `Could not make the space: ${(e as Error).message}`);
                }
            }).open(),
        });
        const ownSpace = shared && spaces.find(s => s.id === shared?.id);
        if (ownSpace) {
            items.push({ label: 'Share garden', onClick: () => new ShareGardenModal(supabase, ownSpace.id, ownSpace.name).open() });
            items.push({
                label: 'Delete garden space',
                danger: true,
                onClick: () => new GardenQuestionModal(
                    `Delete ${ownSpace.name}?`,
                    'Its plants go too, for everyone who shares it.',
                    'Delete',
                    async () => {
                        try {
                            // Leave it first, so nothing saves into a row that is going away.
                            await openGarden(uid, null);
                            await deleteSpace(supabase, ownSpace.id);
                            notify(host, `Deleted ${ownSpace.name}.`);
                        } catch (e) {
                            fail(e);
                        }
                    },
                ).open(),
            });
        } else if (!shared) {
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
                    new ShareGardenModal(supabase, own.id, own.name).open();
                },
            });
        } else {
            const leaving = shared;
            items.push({
                label: 'Leave garden',
                danger: true,
                onClick: () => new GardenQuestionModal(`Leave ${leaving.name}?`, 'You can come back with a new link.', 'Leave', async () => {
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
        if (!uid && !askedToSignIn && peekPendingJoin()) {
            askedToSignIn = true;
            window.setTimeout(() => pill.signIn('Sign in to open the garden you were invited to.'), 0);
        }
        if (uid === currentUser) return; // token refresh, same user
        currentUser = uid;
        // Supabase asks that other client calls run outside this callback.
        window.setTimeout(() => {
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
