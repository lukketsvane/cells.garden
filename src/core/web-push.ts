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

/** The public half of the VAPID pair (.env); null in a build without it, which then offers no pushes. */
const SERVER_KEY = vapidKeyBytes((import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '');

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
    if (!key || !SERVER_KEY) return true;
    const bytes = new Uint8Array(key);
    return bytes.length === SERVER_KEY.length && bytes.every((b, i) => b === SERVER_KEY[i]);
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
    if (error) console.warn('Garden Cells: could not forget this device', error.message);
}

/** A subscription for this device with our key: the one there, or a new one. */
async function subscribe(reg: ServiceWorkerRegistration): Promise<PushSubscription> {
    if (!SERVER_KEY) throw new Error('This build has no key for notifications.');
    let subscription = await reg.pushManager.getSubscription();
    if (subscription && !madeWithOurKey(subscription)) {
        await subscription.unsubscribe().catch(() => false);
        subscription = null;
    }
    return subscription ?? reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: SERVER_KEY });
}

async function turnOn(client: SupabaseClient, userId: string) {
    const reg = await registration();
    if (!reg) throw new Error('The app is still installing. Try again in a moment.');
    const subscription = await subscribe(reg);
    await save(client, subscription);
    writeJson(optedKey(userId), { endpoint: subscription.endpoint });
}

async function turnOff(client: SupabaseClient, userId: string) {
    writeJson(optedKey(userId), null);
    const reg = await registration();
    const subscription = await reg?.pushManager.getSubscription();
    if (!subscription) return;
    await drop(client, subscription.endpoint);
    await subscription.unsubscribe().catch(() => false);
}

/** This account turned pushes on here, and the browser still holds that subscription. */
async function subscribed(userId: string): Promise<boolean> {
    const opted = readJson<{ endpoint?: string }>(optedKey(userId));
    if (!opted?.endpoint) return false;
    const reg = await registration();
    const subscription = await reg?.pushManager.getSubscription();
    return !!subscription && madeWithOurKey(subscription);
}

/**
 * As the account opens: when it turned pushes on here and may still have
 * them, make sure the server holds this device's subscription as it is now.
 * A browser can renew a subscription by itself, and a key change needs a new one.
 */
export async function syncPush(client: SupabaseClient, userId: string): Promise<void> {
    if (!WEB_PUSH || !SERVER_KEY) return;
    const env = environment();
    const opted = readJson<{ endpoint?: string }>(optedKey(userId));
    if (!opted?.endpoint || !env.supported || env.permission !== 'granted') return;
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
        await save(client, subscription).catch((e: unknown) => console.warn('Garden Cells: could not renew notifications', e));
        if (opted.endpoint !== subscription.endpoint) await drop(client, opted.endpoint);
        writeJson(optedKey(userId), { endpoint: subscription.endpoint });
    }
}

/** Before signing out: this device stops getting the account's pushes. Turned on again at the next sign-in. */
export async function forgetDevice(client: SupabaseClient, userId: string): Promise<void> {
    if (!WEB_PUSH || !readJson(optedKey(userId))) return;
    const reg = await registration();
    const subscription = await reg?.pushManager.getSubscription();
    if (subscription) await drop(client, subscription.endpoint);
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
    if (!WEB_PUSH || !SERVER_KEY) return;
    const setting = new Setting(parent).setName('Notifications');
    setting.settingEl.addClass('garden-push-setting');

    const draw = async (message?: string) => {
        const env = environment();
        const state = pushState({ ...env, subscribed: env.supported && env.permission === 'granted' ? await subscribed(userId) : false });
        setting.settingEl.dataset.state = state;
        setting.controlEl.empty();
        const copy = COPY[state];
        setting.setDesc(message ?? (env.ios && copy.ios ? copy.ios : copy.desc));
        if (state === 'off') {
            setting.addButton((b) => b.setButtonText('Turn on').setCta().onClick(() => {
                // Asked in the tap itself, before anything is awaited: iOS asks only then.
                const asked = Notification.requestPermission();
                setting.setDesc('Turning on…');
                void asked.then(async (permission) => {
                    if (permission !== 'granted') return draw();
                    try {
                        await turnOn(client, userId);
                        await draw();
                    } catch (e) {
                        await draw(`Could not turn them on: ${(e as Error).message}`);
                    }
                }, () => draw());
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
