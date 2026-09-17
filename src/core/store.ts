import type { Garden } from './model';
import { emptyGarden } from './model';

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

/** The offline mirror of one account's garden on this device. */
export function userStoreKey(userId: string): string {
    return `${LOCAL_KEY}/user/${userId}`;
}

/** The offline mirror of a garden someone shared with this account. */
export function gardenStoreKey(gardenId: string): string {
    return `${LOCAL_KEY}/garden/${gardenId}`;
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
    try {
        return localStorage.getItem(CLAIM_KEY);
    } catch {
        return null;
    }
}

export function claimAnonymousGarden(userId: string): void {
    try {
        localStorage.setItem(CLAIM_KEY, userId);
    } catch {
        // storage blocked: nothing to remember
    }
}

/** Works without login. One key in localStorage, the whole garden as JSON. */
export class LocalStore implements GardenStore {
    constructor(readonly key: string = LOCAL_KEY) {}

    async load(): Promise<Garden | null> {
        let raw: string | null = null;
        try {
            raw = localStorage.getItem(this.key);
        } catch {
            return null;
        }
        if (!raw) return null;
        return parseGarden(raw);
    }

    async save(garden: Garden): Promise<void> {
        try {
            localStorage.setItem(this.key, JSON.stringify(garden));
        } catch (e) {
            console.error('Garden Cells: could not save to localStorage', e);
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
        const base = emptyGarden();
        return {
            version: 1,
            projects: parsed.projects,
            settings: { ...base.settings, ...(parsed.settings ?? {}) },
            updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : base.updatedAt,
        };
    } catch (e) {
        console.error('Garden Cells: stored garden is not valid JSON', e);
        return null;
    }
}
