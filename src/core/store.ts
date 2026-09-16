import type { Garden } from './model';
import { emptyGarden } from './model';

/**
 * Where the garden lives. The app only ever talks to this interface, so the
 * same UI runs on localStorage today and on Supabase (M1) tomorrow.
 */
export interface GardenStore {
    load(): Promise<Garden | null>;
    save(garden: Garden): Promise<void>;
    /**
     * Optional: be told when the garden changed somewhere else
     * (another tab, another device). Returns an unsubscribe function.
     */
    subscribe?(listener: (garden: Garden) => void): () => void;
}

const LOCAL_KEY = 'cells.garden/v1';

/** Works without login. One key in localStorage, the whole garden as JSON. */
export class LocalStore implements GardenStore {
    constructor(private readonly key: string = LOCAL_KEY) {}

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
