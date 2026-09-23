import '../core/shim';
import './app.css';
import '../core/chrome.css';
import '../core/ui.css';
import '../core/styles.css';

import { registerSW } from 'virtual:pwa-register';
import { bootGarden } from '../core/boot';
import { isIos } from '../core/notify-core';

const host = document.getElementById('app');
if (!host) throw new Error('cells.garden: #app element missing');

// iPhones and iPads start light (styles.css, data-lite): no moving clouds, stars
// or fireflies, which cost a phone's small tabs the most memory.
const nav: Navigator = navigator;
const IOS = isIos(nav.userAgent, nav.maxTouchPoints);
if (IOS) document.documentElement.dataset.lite = 'true';

/** What went wrong, on screen, with the system version: a screenshot is enough to report it. */
function showProblem(message: string) {
    if (!IOS) return;
    const ios = /OS (\d+)_(\d+)/.exec(nav.userAgent);
    const where = ios ? `iOS ${ios[1]}.${ios[2]}` : nav.userAgent.slice(0, 60);
    let bar = document.querySelector<HTMLElement>('.garden-problem');
    if (!bar) {
        bar = document.body.createDiv('garden-problem');
        bar.onclick = () => bar?.remove();
    }
    bar.textContent = `Something went wrong: ${message} (${where}). Tap to hide.`;
}
window.addEventListener('error', (e) => showProblem(e.message || String(e.error)));
window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason as { message?: string } | undefined;
    // Network hiccups to the backend are handled by the app; only real faults show.
    const text = reason?.message ?? String(e.reason);
    if (!/fetch|network|load failed/i.test(text)) showProblem(text);
});

// Safari zooms the whole page on a pinch whatever the viewport says. Only the
// garden canvas zooms, and it reads the touches itself, so the page gesture goes.
for (const type of ['gesturestart', 'gesturechange']) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

const extensionOAuthHandoff = Boolean(
    (window as Window & { __CELLS_EXTENSION_OAUTH_HANDOFF__?: boolean })
        .__CELLS_EXTENSION_OAUTH_HANDOFF__
);

if (!extensionOAuthHandoff) {
    // Replace the readable loading/no-JavaScript introduction with the app.
    document.getElementById('garden-intro')?.remove();
    void bootGarden(host).then((app) => {
        window.garden = app;
    });

    const updateServiceWorker = registerSW({
        immediate: true,
        // Safari/PWA can otherwise keep an older worker for a surprisingly long
        // time. Explicitly ask for an update on every app boot.
        onRegisteredSW(_swUrl, registration) {
            void registration?.update();
        },
        onNeedRefresh() {
            const busy = () => document.querySelector('.modal-container, .is-editing') !== null;
            const apply = () => {
                if (busy()) {
                    window.setTimeout(apply, 1200);
                    return;
                }
                void updateServiceWorker(true);
            };
            apply();
        },
    });
}
