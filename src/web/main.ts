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

// A phone short on memory kills the tab without a word. Mark the page as running
// while it is on screen; a mark still there on the next start means the last run
// died, so this one (and the next ones) start light: no clouds, stars or fireflies.
const RUNNING_KEY = 'cells.garden/running';
const LITE_KEY = 'cells.garden/lite';
// The running mark is per tab (sessionStorage survives the reload Safari does
// after a crash, and a second open tab is not mistaken for a dead one); the
// light mode it leads to is remembered for the device.
const storage = (session: boolean) => { try { return session ? sessionStorage : localStorage; } catch { return null; } };
const store = (session: boolean, key: string, value: string | null) => {
    try {
        const s = storage(session);
        if (value === null) s?.removeItem(key);
        else s?.setItem(key, value);
    } catch { /* storage blocked: no crash memory, nothing else changes */ }
};
const stored = (session: boolean, key: string) => { try { return storage(session)?.getItem(key) ?? null; } catch { return null; } };
const nav: Navigator = navigator;
// iPhones and iPads always start light: their tabs have the least memory to spare.
const IOS = isIos(nav.userAgent, nav.maxTouchPoints);
const diedLastTime = stored(true, RUNNING_KEY) === '1';
if (diedLastTime) store(false, LITE_KEY, '1');
if (IOS || stored(false, LITE_KEY) === '1') document.documentElement.dataset.lite = 'true';
store(true, RUNNING_KEY, '1');
document.addEventListener('visibilitychange', () => store(true, RUNNING_KEY, document.visibilityState === 'visible' ? '1' : null));
window.addEventListener('pagehide', () => store(true, RUNNING_KEY, null));

/** What went wrong, on screen, with the system version: a screenshot is enough to report it. */
function showProblem(message: string) {
    if (!IOS && !diedLastTime) return;
    const ios = /OS (\d+)_(\d+)/.exec(nav.userAgent);
    const where = ios ? `iOS ${ios[1]}.${ios[2]}` : nav.userAgent.slice(0, 60);
    let bar = document.querySelector<HTMLElement>('.garden-problem');
    if (!bar) {
        bar = document.body.createDiv('garden-problem');
        bar.onclick = () => bar?.remove();
    }
    bar.textContent = `Something went wrong: ${message} (${where}). Tap to hide.`;
}
if (diedLastTime) window.setTimeout(() => showProblem('the garden closed unexpectedly last time, so it now runs in light mode'), 1500);
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
