import '../core/shim';
import './app.css';
import '../core/ui.css';
import '../core/styles.css';

import { registerSW } from 'virtual:pwa-register';

import type { GardenApp } from '../core/app';
import { bootGarden } from '../core/boot';

const host = document.getElementById('app');
if (!host) throw new Error('cells.garden: #app element missing');

// Handy in the console while developing.
declare global {
    interface Window { garden: GardenApp | undefined }
}

bootGarden(host).then((app) => {
    window.garden = app;
});

// PWA: register the service worker right away (not on window "load"), so the
// shell is precached from the first visit. The worker is built with
// registerType "prompt" (vite.config.ts): a new build waits until this page
// says so, and the page only reloads when nothing is half-typed. In dev this
// is a no-op.
const updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
        const busy = () => document.querySelector('.modal-container, .is-editing') !== null;
        const apply = () => {
            if (busy()) {
                setTimeout(apply, 2000);
                return;
            }
            void updateServiceWorker(true);
        };
        apply();
    },
});
