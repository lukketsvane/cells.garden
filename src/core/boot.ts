/**
 * One entry point for every distribution (web, PWA, extension pages).
 * Mounts the garden on `host`, local-first, and adds sign-in + sync when the
 * build carries Supabase config.
 */
import './shim';
import { GardenApp } from './app';
import { AuthPill } from './auth';
import { LocalStore } from './store';
import { createSupabase, SupabaseStore } from './supabase';

export interface BootOptions {
    /** Where a magic link should land. Defaults to the current page. */
    redirectTo?: string;
}

export async function bootGarden(host: HTMLElement, options: BootOptions = {}): Promise<GardenApp> {
    // Always start local so the garden shows instantly, signed in or not.
    const local = new LocalStore();
    const app = new GardenApp(local);

    try {
        await app.mount(host);
    } catch (e) {
        console.error('GARDEN CELLS CRASH IN MOUNT:', e);
        host.createEl('h2', { text: 'Garden Crashed' });
        host.createEl('p', { text: String(e) });
        return app;
    }

    // M1: when the build has Supabase config, offer sign-in and sync.
    const supabase = createSupabase();
    if (!supabase) return app;

    const pill = new AuthPill(supabase, host, { redirectTo: options.redirectTo });
    app.onSyncState = (state) => pill.setSyncState(state);

    let currentUser: string | null = null;
    supabase.auth.onAuthStateChange((_event, session) => {
        pill.setSession(session);
        const uid = session?.user.id ?? null;
        if (uid === currentUser) return; // token refresh, same user
        currentUser = uid;
        // Supabase asks that other client calls run outside this callback.
        setTimeout(() => {
            const switching = uid
                ? app.useStore(new SupabaseStore(supabase, uid), { mirror: local })
                : app.useStore(local);
            switching.catch((e) => {
                console.error('Garden Cells: could not switch store', e);
                pill.setSyncState('error');
            });
        }, 0);
    });

    return app;
}
