import '../core/shim';
import './app.css';
import '../core/chrome.css';
import '../core/ui.css';
import '../core/styles.css';

import { registerSW } from 'virtual:pwa-register';
import { bootGarden } from '../core/boot';

const host = document.getElementById('app');
if (!host) throw new Error('cells.garden: #app element missing');

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
