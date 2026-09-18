import type { Garden } from './model';
import { emptyGarden, settingsFrom } from './model';
import { local } from './local';

/**
 * Where the garden lives. The app only ever talks to this interface, so the
 * same UI runs on localStorage and on Supabase.
 */
export interface GardenStore {
    load(): Promise<Garden | null>;
    /**
     * Write the garden. A store that found newer work on the server merges it in
     * and returns what it wrote, so the app can adopt it; otherwise nothing.
     */
    save(garden: Garden): Promise<Garden | void>;
    /**
     * Optional: combine an offline copy with what the server holds now, using the
     * last version this device synced as the common base. Nothing is written.
     */
    mergeOffline?(local: Garden): Promise<Garden>;
    /**
     * Optional: be told when the garden changed somewhere else
     * (another tab, another device). Returns an unsubscribe function.
     */
    subscribe?(listener: (garden: Garden) => void): () => void;
}

/** The anonymous garden of this device (no account). */
export const LOCAL_KEY = 'cells.garden/v1';

/** A JSON value kept on this device; null when missing, unreadable or blocked. */
export function readJson<T>(key: string): T | null {
    try {
        const raw = local.get(key);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch {
        return null;
    }
}

/** Keep a JSON value on this device (null removes it). Blocked or full: it just does not survive a reload. */
export function writeJson(key: string, value: unknown) {
    if (value === null) local.remove(key);
    else local.set(key, JSON.stringify(value));
}

/** A stored or fetched garden with every field filled in. */
export function gardenFrom(data: Partial<Garden>, updatedAt: string): Garden {
    return {
        version: 1,
        projects: Array.isArray(data.projects) ? data.projects : [],
        settings: settingsFrom(data.settings),
        updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : updatedAt,
    };
}

/** A deep copy that shares nothing with the live data the view edits in place. */
export function snapshot<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

/** The garden is gone for this account: deleted, or the owner removed them. */
export class GardenGoneError extends Error {
    constructor() {
        super('This garden is no longer available.');
        this.name = 'GardenGoneError';
    }
}

const CLAIM_KEY = `${LOCAL_KEY}/claimedBy`;

/**
 * Which account the anonymous garden was uploaded to. It is only ever offered
 * to a fresh account once, so signing in with a second account on the same
 * device never receives the first account's plants.
 */
export function anonymousGardenClaimedBy(): string | null {
    return local.get(CLAIM_KEY);
}

export function claimAnonymousGarden(userId: string): void {
    local.set(CLAIM_KEY, userId);
}

/** Works without login. One key on this device, the whole garden as JSON. */
export class LocalStore implements GardenStore {
    constructor(readonly key: string = LOCAL_KEY) {}

    async load(): Promise<Garden | null> {
        const raw = local.get(this.key);
        if (!raw) return null;
        return parseGarden(raw);
    }

    async save(garden: Garden): Promise<void> {
        if (!local.set(this.key, JSON.stringify(garden))) {
            console.error('Garden Cells: could not save the garden on this device');
        }
    }

    subscribe(listener: (garden: Garden) => void): () => void {
        const onStorage = (e: StorageEvent) => {
            if (e.key !== this.key || !e.newValue) return;
            const garden = parseGarden(e.newValue);
            if (garden) listener(garden);
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }
}

function parseGarden(raw: string): Garden | null {
    try {
        const parsed = JSON.parse(raw) as Partial<Garden>;
        if (!parsed || !Array.isArray(parsed.projects)) return null;
        return gardenFrom(parsed, emptyGarden().updatedAt);
    } catch (e) {
        console.error('Garden Cells: stored garden is not valid JSON', e);
        return null;
    }
}
