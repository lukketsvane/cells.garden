import '../core/shim';
import './app.css';
import '../core/ui.css';
import '../core/styles.css';

import { GardenApp } from '../core/app';
import { AuthPill } from '../core/auth';
import { LocalStore } from '../core/store';
import { createSupabase, SupabaseStore } from '../core/supabase';

const host = document.getElementById('app');
if (!host) throw new Error('cells.garden: #app element missing');

// Always start local so the garden shows instantly, signed in or not.
const local = new LocalStore();
const app = new GardenApp(local);

app.mount(host)
    .then(() => {
        // M1: when the build has Supabase config, offer sign-in and sync.
        const supabase = createSupabase();
        if (!supabase) return;

        const pill = new AuthPill(supabase, host);
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
    })
    .catch((e) => {
        console.error('GARDEN CELLS CRASH IN MOUNT:', e);
        host.createEl('h2', { text: 'Garden Crashed' });
        host.createEl('p', { text: String(e) });
    });

// Handy in the console while developing.
declare global {
    interface Window { garden: GardenApp }
}
window.garden = app;
