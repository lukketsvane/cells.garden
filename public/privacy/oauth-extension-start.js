(() => {
    const INTENT_KEY = 'cells.garden/extension-oauth-intent';
    const params = new URLSearchParams(location.hash.slice(1));
    const extensionId = params.get('extension_id') || '';
    const nonce = params.get('nonce') || '';
    const authorizeRaw = params.get('authorize_url') || '';
    const status = document.getElementById('status');

    history.replaceState(null, '', location.pathname);

    let authorize;
    try {
        authorize = new URL(authorizeRaw);
    } catch {
        status.textContent = 'The Google sign-in address is invalid. Return to the extension and try again.';
        return;
    }

    const redirectTo = authorize.searchParams.get('redirect_to');
    const valid = /^[a-p]{32}$/.test(extensionId)
        && /^[0-9a-f]{32}$/.test(nonce)
        && authorize.protocol === 'https:'
        && authorize.hostname.endsWith('.supabase.co')
        && authorize.pathname === '/auth/v1/authorize'
        && authorize.searchParams.get('provider') === 'google'
        && Boolean(authorize.searchParams.get('code_challenge'))
        && redirectTo === 'https://cells.garden/';

    if (!valid) {
        status.textContent = 'The Google sign-in request is invalid. Return to the extension and try again.';
        return;
    }

    sessionStorage.setItem(INTENT_KEY, JSON.stringify({
        extensionId,
        nonce,
        createdAt: Date.now(),
    }));
    location.replace(authorize.toString());
})();
