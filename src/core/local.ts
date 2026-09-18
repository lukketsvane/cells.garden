/**
 * Strings kept on this device (garden cache, camera, scene). The browser's
 * localStorage by default; a host such as Obsidian can swap in its own storage
 * before the garden boots. Blocked or full storage never throws.
 */
export interface LocalBackend {
    get(key: string): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
}

/** Every key the app keeps on the device starts with this. */
export const LOCAL_PREFIX = 'cells.garden/';

let backend: LocalBackend = {
    get: (key) => window.localStorage.getItem(key),
    set: (key, value) => window.localStorage.setItem(key, value),
    remove: (key) => window.localStorage.removeItem(key),
};

export function setLocalBackend(next: LocalBackend) {
    backend = next;
}

export const local = {
    get(key: string): string | null {
        try {
            return backend.get(key);
        } catch {
            return null;
        }
    },
    /** False when the value could not be kept. */
    set(key: string, value: string): boolean {
        try {
            backend.set(key, value);
            return true;
        } catch {
            return false;
        }
    },
    remove(key: string) {
        try {
            backend.remove(key);
        } catch {
            // Blocked storage: nothing to remove.
        }
    },
};
