/**
 * Web Push, in the web app alone (the build sets __CELLS_WEB_PUSH__): the
 * Notifications row in Settings, keeping this device's subscription saved for
 * the account, the badge on the app's icon, and hearing which cell a tapped
 * notification opens. The extension and Obsidian keep the list in the app.
 *
 * iPhone and iPad: iOS 16.4 and later push only to a web app added to the
 * Home Screen and opened from there, never to a Safari tab. The permission is
 * asked in the tap itself, before anything is awaited, or iOS refuses to ask.
 * Every push must show a notification (public/push-sw.js), or iOS takes the
 * subscription away.
 */
import './shim';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cellTargetFromHash, isIos, pushState, vapidKeyBytes, type CellTarget, type PushEnv, type PushState } from './notify-core';
import { LOCAL_KEY, readJson, writeJson } from './store';
import { Setting } from './ui';

declare const __CELLS_WEB_PUSH__: boolean;
export const WEB_PUSH: boolean = typeof __CELLS_WEB_PUSH__ === 'boolean' ? __CELLS_WEB_PUSH__ : false;

/** Only the public half crosses the network. Prepare it before the permission tap. */
let serverKey: Uint8Array<ArrayBuffer> | null = null;
async function publicKey(client: SupabaseClient): Promise<Uint8Array<ArrayBuffer>> {
    if (serverKey) return serverKey;
    const result = await client.functions.invoke<{ publicKey?: unknown }>('notify', { body: { action: 'public-key' } });
    const data = result.data;
    const key = vapidKeyBytes(typeof data?.publicKey === 'string' ? data.publicKey : '');
    if (result.error || !key) throw new Error('Notifications are temporarily unavailable. Try again.');
    serverKey = key;
    return key;
}

/** Which subscription this account turned on here. Another account on the same device must turn on its own. */
const optedKey = (userId: string) => `${LOCAL_KEY}/push/${userId}`;

/** What the push worker posts to an open app when its notification is tapped. */
const OPEN_MESSAGE = 'cells-garden:open';

type BadgeNavigator = Navigator & {
    setAppBadge?: (count?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
    standalone?: boolean;
};

function environment(): Omit<PushEnv, 'subscribed'> {
    const nav = navigator as BadgeNavigator;
    const ios = isIos(nav.userAgent, nav.maxTouchPoints);
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true;
    const supported = 'serviceWorker' in nav && 'PushManager' in window && 'Notification' in window;
    const permission = 'Notification' in window ? Notification.permission : 'default';
    return { ios, standalone, supported, permission };
}

/** The app's service worker, or null when it is not there within a few seconds (a dev server, a blocked worker). */
async function registration(): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) return null;
    const late = new Promise<null>(resolve => window.setTimeout(() => resolve(null), 5000));
    return Promise.race([navigator.serviceWorker.ready, late]);
}

/** Whether a subscription was made with the key this build carries. After a key change it is useless. */
function madeWithOurKey(subscription: PushSubscription): boolean {
    const key = subscription.options?.applicationServerKey;
    if (!key || !serverKey) return false;
    const bytes = new Uint8Array(key);
    return bytes.length === serverKey.length && bytes.every((b, i) => b === serverKey![i]);
}

/** Hand the subscription to the server for this account; it takes it over from any account that had it. */
async function save(client: SupabaseClient, subscription: PushSubscription) {
    const json = subscription.toJSON();
    const { error } = await client.rpc('save_push_subscription', {
        sub_endpoint: subscription.endpoint,
        sub_p256dh: json.keys?.p256dh ?? '',
        sub_auth: json.keys?.auth ?? '',
        sub_user_agent: (navigator as BadgeNavigator).userAgent.slice(0, 400),
    });
    if (error) throw new Error(error.message);
}

async function drop(client: SupabaseClient, endpoint: string) {
    const { error } = await client.from('push_subscriptions').delete().eq('endpoint', endpoint);
    if (error) throw new Error(error.message);
}

/** A subscription for this device with our key: the one there, or a new one. */
async function subscribe(reg: ServiceWorkerRegistration): Promise<PushSubscription> {
    if (!serverKey) throw new Error('Notifications are still loading.');
    let subscription = await reg.pushManager.getSubscription();
    if (subscription && !madeWithOurKey(subscription)) {
        await subscription.unsubscribe().catch(() => false);
        subscription = null;
    }
    return subscription ?? reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey });
}

async function turnOff(client: SupabaseClient, userId: string) {
    const reg = await registration();
    const subscription = await reg?.pushManager.getSubscription();
    const opted = readJson<{ endpoint?: string }>(optedKey(userId));
    // Revoke the browser endpoint even when the server is unreachable.
    if (subscription) await subscription.unsubscribe();
    writeJson(optedKey(userId), null);
    if (opted?.endpoint) await drop(client, opted.endpoint);
}

/** This account turned pushes on here, and the browser still holds that subscription. */
async function subscribed(userId: string): Promise<boolean> {
    const opted = readJson<{ endpoint?: string }>(optedKey(userId));
    if (!opted?.endpoint) return false;
    const reg = await registration();
    const subscription = await reg?.pushManager.getSubscription();
    return !!subscription && subscription.endpoint === opted.endpoint && madeWithOurKey(subscription);
}

/**
 * As the account opens: when it turned pushes on here and may still have
 * them, make sure the server holds this device's subscription as it is now.
 * A browser can renew a subscription by itself, and a key change needs a new one.
 */
export async function syncPush(client: SupabaseClient, userId: string): Promise<void> {
    if (!WEB_PUSH) return;
    const env = environment();
    const opted = readJson<{ endpoint?: string }>(optedKey(userId));
    if (!opted?.endpoint || !env.supported || env.permission !== 'granted') return;
    await publicKey(client);
    const reg = await registration();
    if (!reg) return;
    let subscription: PushSubscription;
    try {
        subscription = await subscribe(reg);
    } catch {
        return; // Asked again from Settings.
    }
    const { data, error } = await client.from('push_subscriptions').select('id').eq('endpoint', subscription.endpoint).limit(1);
    if (error) return;
    if ((data ?? []).length === 0 || subscription.endpoint !== opted.endpoint) {
        await save(client, subscription);
        if (opted.endpoint !== subscription.endpoint) await drop(client, opted.endpoint);
        writeJson(optedKey(userId), { endpoint: subscription.endpoint });
    }
}

/** Before signing out: this device stops getting the account's pushes. Turned on again at the next sign-in. */
export async function forgetDevice(client: SupabaseClient, userId: string): Promise<void> {
    if (!WEB_PUSH || !readJson(optedKey(userId))) return;
    await turnOff(client, userId);
}

/** The unread count on the app's icon, where the system shows one (an installed app). */
export function setAppBadge(unread: number) {
    if (!WEB_PUSH) return;
    const nav = navigator as BadgeNavigator;
    const done = unread > 0 ? nav.setAppBadge?.(unread) : nav.clearAppBadge?.();
    done?.catch(() => {});
}

/** A tapped notification, with the app already open: the worker says which cell to open. */
export function listenForOpenedCells(open: (target: CellTarget) => void) {
    if (!WEB_PUSH || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
        const data = e.data as { type?: unknown; url?: unknown } | null;
        if (data?.type !== OPEN_MESSAGE || typeof data.url !== 'string') return;
        let hash = '';
        try {
            const url = new URL(data.url, location.href);
            if (url.origin !== location.origin) return;
            hash = url.hash;
        } catch {
            return;
        }
        const target = cellTargetFromHash(hash);
        if (target) open(target);
    });
}

const COPY: Record<PushState, { desc: string; ios?: string }> = {
    unsupported: { desc: 'This browser cannot show them.' },
    install: { desc: 'Add the garden to your Home Screen first: tap Share, then Add to Home Screen, and open it from there.' },
    update: { desc: 'Needs iOS 16.4 or later.' },
    off: { desc: 'When someone assigns you a cell.' },
    on: { desc: 'On for this device.' },
    denied: {
        desc: 'Blocked. Allow notifications for this site in the browser settings.',
        ios: 'Blocked. Allow them in iOS Settings, under Notifications.',
    },
};

/** The Notifications row in Settings, in whatever state this device is in. */
export function pushSetting(parent: HTMLElement, client: SupabaseClient, userId: string) {
    if (!WEB_PUSH) return;
    const setting = new Setting(parent).setName('Notifications');
    setting.settingEl.addClass('garden-push-setting');

    const draw = async (message?: string) => {
        const env = environment();
        setting.controlEl.empty();
        let reg: ServiceWorkerRegistration | null = null;
        let existing: PushSubscription | null = null;
        if (env.supported && (!env.ios || env.standalone) && env.permission !== 'denied') {
            setting.setDesc('Loading notifications…');
            try {
                await publicKey(client);
                reg = await registration();
                if (!reg) throw new Error('The app is still installing. Try again in a moment.');
                existing = await reg.pushManager.getSubscription();
                if (existing && !madeWithOurKey(existing)) {
                    await existing.unsubscribe();
                    existing = null;
                }
            } catch (e) {
                setting.setDesc((e as Error).message);
                setting.addButton(b => b.setButtonText('Retry').onClick(() => void draw()));
                return;
            }
        }
        const state = pushState({ ...env, subscribed: env.supported && env.permission === 'granted' ? await subscribed(userId) : false });
        setting.settingEl.dataset.state = state;
        setting.controlEl.empty();
        const copy = COPY[state];
        setting.setDesc(message ?? (env.ios && copy.ios ? copy.ios : copy.desc));
        if (state === 'off') {
            setting.addButton((b) => b.setButtonText('Turn on').setCta().onClick(() => {
                // Subscribe directly in the tap: Safari needs user activation.
                // The worker, old subscription and server key are already ready.
                const asked = existing ? Promise.resolve(existing) : reg!.pushManager.subscribe({
                    userVisibleOnly: true, applicationServerKey: serverKey!,
                });
                setting.controlEl.empty();
                setting.setDesc('Turning on…');
                void asked.then(async (subscription) => {
                    try {
                        await save(client, subscription);
                        writeJson(optedKey(userId), { endpoint: subscription.endpoint });
                        await draw();
                    } catch (e) {
                        await draw(`Could not turn them on: ${(e as Error).message}`);
                    }
                }, () => draw('Notifications were not enabled. Allow them to receive assignments.'));
            }));
        } else if (state === 'on') {
            setting.addButton((b) => b.setButtonText('Turn off').onClick(() => {
                setting.setDesc('Turning off…');
                void turnOff(client, userId).then(() => draw(), (e: unknown) => draw(`Could not turn them off: ${(e as Error).message}`));
            }));
        }
    };
    void draw();
}
