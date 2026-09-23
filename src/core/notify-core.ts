/**
 * Notifications, the pure half: the address that opens one cell, how old a
 * notification reads, and which state the notifications setting is in. No DOM
 * and no network; covered by notify-core.test.ts. The rest is
 * notifications.ts (the list in the app) and web-push.ts (pushes to a phone).
 */

/** Where a notification leads: one cell, in a garden or on a shared plant. */
export interface CellTarget {
    itemId: string;
    /** The plant as the sender's garden has it. A shared plant is found by `plantId` first. */
    projectId: string;
    /** A shared garden or space; absent for the reader's own garden. */
    gardenId?: string;
    /** The shared plant (a `plants` row), which has another project id in each garden. */
    plantId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ids the garden makes, and those a vault file brings: any short line of text. */
const isId = (value: string | null): value is string => !!value && value.length <= 200 && !/\p{Cc}/u.test(value);

/**
 * `#cell=<item>&project=<plant>`, with `&garden=` and `&sharedPlant=` when
 * there is one. Never `plant=` or `join=`: those are invite links.
 */
export function cellHash(target: CellTarget): string {
    const parts: [string, string][] = [['cell', target.itemId], ['project', target.projectId]];
    if (target.gardenId) parts.push(['garden', target.gardenId]);
    if (target.plantId) parts.push(['sharedPlant', target.plantId]);
    return '#' + parts.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
}

/** The cell an address points at, or null. A garden or plant that is not a uuid spoils it. */
export function cellTargetFromHash(hash: string): CellTarget | null {
    if (!hash.startsWith('#cell=')) return null;
    let params: URLSearchParams;
    try {
        params = new URLSearchParams(hash.slice(1));
    } catch {
        return null;
    }
    const itemId = params.get('cell');
    const projectId = params.get('project');
    const gardenId = params.get('garden');
    const plantId = params.get('sharedPlant');
    if (!isId(itemId) || !isId(projectId)) return null;
    if (gardenId !== null && !UUID.test(gardenId)) return null;
    if (plantId !== null && !UUID.test(plantId)) return null;
    return {
        itemId,
        projectId,
        ...(gardenId ? { gardenId: gardenId.toLowerCase() } : {}),
        ...(plantId ? { plantId: plantId.toLowerCase() } : {}),
    };
}

/** How long ago, shortly: "now", "5m", "3h", "2d", then the date. */
export function timeAgo(then: Date, now: Date = new Date()): string {
    const minutes = Math.floor((now.getTime() - then.getTime()) / 60000);
    if (!Number.isFinite(minutes)) return '';
    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** The count a badge shows: nothing, a number, or "9+". */
export function badgeText(unread: number): string {
    if (!(unread > 0)) return '';
    return unread > 9 ? '9+' : String(Math.floor(unread));
}

// --- The notifications setting (web-push.ts) ------------------------------------

/**
 * - `unsupported`: this browser has no Web Push.
 * - `install`: an iPhone or iPad in Safari. iOS 16.4 and later push only to a
 *   web app opened from the Home Screen.
 * - `update`: opened from the Home Screen on an iOS older than 16.4.
 * - `off`: can be turned on (not asked yet, or asked by another account here).
 * - `on`: this device gets them.
 * - `denied`: turned down; only the system's settings bring it back.
 */
export type PushState = 'unsupported' | 'install' | 'update' | 'off' | 'on' | 'denied';

export interface PushEnv {
    ios: boolean;
    /** Opened as an installed app (Home Screen), not in a browser tab. */
    standalone: boolean;
    /** A service worker, the Push API and notifications are all there. */
    supported: boolean;
    permission: 'default' | 'granted' | 'denied';
    /** This account's subscription is saved for this device. */
    subscribed: boolean;
}

export function pushState(env: PushEnv): PushState {
    if (env.ios && !env.standalone) return 'install';
    if (!env.supported) return env.ios ? 'update' : 'unsupported';
    if (env.permission === 'denied') return 'denied';
    return env.permission === 'granted' && env.subscribed ? 'on' : 'off';
}

/** An iPhone, iPod or iPad, also one whose Safari asks for the desktop site and says it is a Mac. */
export function isIos(userAgent: string, maxTouchPoints = 0): boolean {
    return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/** base64url (padded or not) to bytes; null when it is not base64url. */
export function base64UrlBytes(text: string): Uint8Array<ArrayBuffer> | null {
    const clean = text.trim().replace(/=+$/, '');
    if (!/^[A-Za-z0-9_-]*$/.test(clean) || clean.length % 4 === 1) return null;
    const binary = atob(clean.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (clean.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/** A P-256 public key as browsers take it for Web Push: 65 bytes, uncompressed. Null for anything else. */
export function vapidKeyBytes(text: string): Uint8Array<ArrayBuffer> | null {
    const bytes = base64UrlBytes(text);
    return bytes && bytes.length === 65 && bytes[0] === 4 ? bytes : null;
}
