import '../core/shim';
import './app.css';
import '../core/ui.css';
import '../core/styles.css';

import { GardenApp } from '../core/app';
import { LocalStore } from '../core/store';

const host = document.getElementById('app');
if (!host) throw new Error('cells.garden: #app element missing');

// M0: localStorage. M1 swaps in a SupabaseStore when the user is signed in.
const app = new GardenApp(new LocalStore());
app.mount(host).catch((e) => {
    console.error('GARDEN CELLS CRASH IN MOUNT:', e);
    host.createEl('h2', { text: 'Garden Crashed' });
    host.createEl('p', { text: String(e) });
});

// Handy in the console while developing.
declare global {
    interface Window { garden: GardenApp }
}
window.garden = app;
