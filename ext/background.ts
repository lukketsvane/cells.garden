/**
 * MV3 service worker and the short-lived website -> extension OAuth hand-off.
 */
import {
    OAUTH_RETURN_KEY,
    OAUTH_RETURN_READY,
    OAUTH_RETURN_TAKE,
    OAUTH_RETURN_TTL_MS,
    isOAuthReturnMessage,
    isStoredOAuthReturn,
    type StoredOAuthReturn,
} from './auth-bridge';

function popupOwnsActionClick(): Promise<void> {
    if (!chrome.sidePanel?.setPanelBehavior) return Promise.resolve();
    return chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: false })
        .catch((e: unknown) => console.error('cells.garden: could not set the side panel behavior', e));
}

function fromOAuthBridge(sender: chrome.runtime.MessageSender): boolean {
    if (!sender.url) return false;
    try {
        const url = new URL(sender.url);
        return url.origin === 'https://cells.garden'
            && url.pathname === '/privacy/oauth-return.html';
    } catch {
        return false;
    }
}

function isOAuthTakeRequest(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    return (value as Record<string, unknown>).type === OAUTH_RETURN_TAKE;
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    const incoming: unknown = message;
    if (!fromOAuthBridge(sender) || !isOAuthReturnMessage(incoming)) {
        sendResponse({ ok: false });
        return false;
    }

    const stored: StoredOAuthReturn = { receivedAt: Date.now(), value: incoming };
    void chrome.storage.local.set({ [OAUTH_RETURN_KEY]: stored }).then(() => {
        sendResponse({ ok: true });
        void chrome.runtime.sendMessage({ type: OAUTH_RETURN_READY }).catch(() => {});
    }).catch((error: unknown) => {
        sendResponse({ ok: false, error: String(error) });
    });
    return true;
});

let takeQueue: Promise<void> = Promise.resolve();
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const incoming: unknown = message;
    if (!isOAuthTakeRequest(incoming)) return false;

    takeQueue = takeQueue.then(async () => {
        const stored = await chrome.storage.local.get(OAUTH_RETURN_KEY);
        const raw: unknown = stored[OAUTH_RETURN_KEY];
        if (raw !== undefined) await chrome.storage.local.remove(OAUTH_RETURN_KEY);

        let value;
        if (isStoredOAuthReturn(raw)) {
            const age = Date.now() - raw.receivedAt;
            if (age >= 0 && age <= OAUTH_RETURN_TTL_MS) value = raw.value;
        }
        sendResponse({ ok: true, value });
    }).catch((error: unknown) => {
        sendResponse({ ok: false, error: String(error) });
    });
    return true;
});

chrome.runtime.onInstalled.addListener(() => { void popupOwnsActionClick(); });
void popupOwnsActionClick();
