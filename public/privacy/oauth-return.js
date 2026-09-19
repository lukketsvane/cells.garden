(() => {
    const params = new URLSearchParams(location.search);
    const target = params.get('target') || '';
    const status = document.getElementById('status');
    const open = document.getElementById('open');
    const controls = /[\u0000-\u001f\u007f]/;

    const bounded = (name, max) => {
        const value = params.get(name);
        if (!value || value.length > max || controls.test(value)) return '';
        return value;
    };

    const code = bounded('code', 4096);
    const error = bounded('error', 256);
    const errorDescription = bounded('error_description', 1024);
    history.replaceState(null, '', location.pathname);

    if ((!code && !error) || (code && error)) {
        status.textContent = 'This sign-in return is invalid. Start sign-in again.';
        return;
    }

    const result = { type: 'cells-garden-oauth-return' };
    if (code) result.code = code;
    if (error) result.error = error;
    if (errorDescription) result.errorDescription = errorDescription;

    if (target === 'obsidian') {
        const back = new URL('obsidian://cells-garden');
        if (code) back.searchParams.set('code', code);
        if (error) back.searchParams.set('error', error);
        if (errorDescription) back.searchParams.set('error_description', errorDescription);
        const go = () => { location.href = back.toString(); };
        status.textContent = 'Opening cells.garden in Obsidian…';
        open.hidden = false;
        open.textContent = 'Open Obsidian';
        open.addEventListener('click', go);
        window.setTimeout(go, 250);
        return;
    }

    if (target === 'extension') {
        const extensionId = bounded('extension_id', 32);
        if (!/^[a-p]{32}$/.test(extensionId)) {
            status.textContent = 'The extension return address is invalid. Start sign-in again from the extension.';
            return;
        }
        const runtime = window.chrome && window.chrome.runtime;
        if (!runtime || !runtime.sendMessage) {
            status.textContent = 'Chrome could not reach the cells.garden extension. Make sure the extension is enabled, then try again.';
            return;
        }
        runtime.sendMessage(extensionId, result, (response) => {
            const failed = runtime.lastError || !response || response.ok !== true;
            if (failed) {
                status.textContent = 'Chrome could not hand sign-in back to the extension. Reopen the side panel and try again.';
                return;
            }
            status.textContent = 'Signed in to the extension. Return to cells.garden.';
            open.hidden = false;
            open.textContent = 'Close this tab';
            open.addEventListener('click', () => window.close());
        });
        return;
    }

    status.textContent = 'Unknown sign-in destination. Start sign-in again.';
})();
