(() => {
    const INTENT_KEY = 'cells.garden/extension-oauth-intent';
    const MAX_AGE = 15 * 60 * 1000;
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const error = params.get('error');
    if ((!code && !error) || (code && error)) return;

    let intent;
    try {
        intent = JSON.parse(sessionStorage.getItem(INTENT_KEY) || 'null');
    } catch {
        return;
    }
    if (!intent || typeof intent !== 'object') return;

    const extensionId = intent.extensionId;
    const nonce = intent.nonce;
    const age = Date.now() - intent.createdAt;
    if (
        !/^[a-p]{32}$/.test(extensionId)
        || !/^[0-9a-f]{32}$/.test(nonce)
        || typeof intent.createdAt !== 'number'
        || age < 0
        || age > MAX_AGE
    ) {
        sessionStorage.removeItem(INTENT_KEY);
        return;
    }

    const bounded = (value, max) => {
        if (!value || value.length > max) return '';
        for (let i = 0; i < value.length; i++) {
            const point = value.charCodeAt(i);
            if (point < 0x20 || point === 0x7f) return '';
        }
        return value;
    };
    const safeCode = bounded(code, 4096);
    const safeError = bounded(error, 256);
    const errorDescription = bounded(params.get('error_description'), 1024);
    if ((!safeCode && !safeError) || (safeCode && safeError)) return;

    window.__CELLS_EXTENSION_OAUTH_HANDOFF__ = true;
    sessionStorage.removeItem(INTENT_KEY);
    history.replaceState(null, '', location.pathname);

    const show = (message) => {
        const render = () => {
            const app = document.getElementById('app');
            if (!app) return;
            app.textContent = '';
            const box = document.createElement('main');
            const title = document.createElement('h1');
            const text = document.createElement('p');
            title.textContent = 'cells.garden extension';
            text.textContent = message;
            box.append(title, text);
            app.appendChild(box);
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', render, { once: true });
        } else {
            render();
        }
    };

    const runtime = window.chrome && window.chrome.runtime;
    if (!runtime || typeof runtime.sendMessage !== 'function') {
        show('Chrome could not reach the extension. Reopen the extension and try Google sign-in again.');
        return;
    }

    const message = { type: 'cells-garden-oauth-return', nonce };
    if (safeCode) message.code = safeCode;
    if (safeError) message.error = safeError;
    if (errorDescription) message.errorDescription = errorDescription;

    runtime.sendMessage(extensionId, message, (response) => {
        const failed = runtime.lastError || !response || response.ok !== true;
        show(failed
            ? 'Chrome could not hand sign-in back to the extension. Reopen the extension and try again.'
            : 'Sign-in returned to the extension. Reopen the popup or side panel to finish.');
    });
})();
