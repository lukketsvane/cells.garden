/**
 * Shared entry for both extension pages (newtab.html and sidepanel.html).
 * Same core build as the web app; the only difference is where a magic link
 * should land, which has to be one of the extension's own pages.
 */
import '../src/core/shim';
import '../src/web/app.css';
import '../src/core/chrome.css';
import '../src/core/ui.css';
import '../src/core/styles.css';
import './ext.css';

import type { GardenApp } from '../src/core/app';
import { bootGarden } from '../src/core/boot';

const host = document.getElementById('app');
if (!host) throw new Error('cells.garden: #app element missing');

// Handy in the console while developing (same global as the web app).
declare global {
    interface Window { garden: GardenApp | undefined }
}

// The magic link lands on the New Tab page whichever surface asked for it.
// `chrome.runtime.id` is only set inside an extension context; when the built
// page is opened from disk while debugging, the pill falls back to its own URL.
const redirectTo = typeof chrome !== 'undefined' && chrome.runtime?.id
    ? chrome.runtime.getURL('newtab.html')
    : undefined;

bootGarden(host, { redirectTo }).then((app) => {
    window.garden = app;
});
