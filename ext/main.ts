/**
 * Shared entry for the extension pages: newtab.html and sidepanel.html load it,
 * and the popup builds on it. Same core build as the web app; the only
 * difference is where a magic link should land, which has to be one of the
 * extension's own pages.
 */
import '../src/core/shim';
import '../src/web/app.css';
import '../src/core/chrome.css';
import '../src/core/ui.css';
import '../src/core/styles.css';
import './ext.css';

import { bootGarden } from '../src/core/boot';

const host = document.getElementById('app');
if (!host) throw new Error('cells.garden: #app element missing');

/** False when a built page is opened from disk while debugging: no chrome.* APIs. */
export const inExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.id;

// The magic link lands on the New Tab page whichever surface asked for it;
// opened from disk, the pill falls back to its own URL.
export const ready = bootGarden(host, { redirectTo: inExtension ? chrome.runtime.getURL('newtab.html') : undefined });
void ready.then((app) => {
    window.garden = app;
});
