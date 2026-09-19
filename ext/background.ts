/**
 * MV3 module service worker. Besides the toolbar/side-panel behavior, it is the
 * durable hand-off point for Google sign-in: the website callback posts the
 * PKCE result here and the next open extension surface claims it.
 */
import {
    OAUTH_RETURN_KEY,
    OAUTH_RETURN_READY,
    OAUTH_RETURN_TAKE,
    isOAuthReturnMessage,
} from './auth-bridge';

function popupOwnsActionClick(): Promise<void> {
    // Chromium's headless extension runtime can omit the sidePanel namespace.
    // Real supported Chrome versions expose it, but treating absence as a no-op
    // keeps the service worker alive in constrained runtimes and tests.
    if (!chrome.sidePanel?.setPanelBehavior) return Promise.resolve();
    return chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: false })
        .catch((e: unknown) => console.error('cells.garden: could not set the side panel behavior', e));
}

function fromCellsGarden(sender: chrome.runtime.MessageSender): boolean {
    if (!sender.url) return false;
    try {
        return new URL(sender.url).origin === 'https://cells.garden';
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
    if (!fromCellsGarden(sender) || !isOAuthReturnMessage(incoming)) {
        sendResponse({ ok: false });
        return false;
    }

    void chrome.storage.local.set({ [OAUTH_RETURN_KEY]: incoming }).then(() => {
        sendResponse({ ok: true });
        // Wake an already-open side panel/new tab. If none is open, the value
        // stays in storage and is claimed the next time a surface starts.
        void chrome.runtime.sendMessage({ type: OAUTH_RETURN_READY }).catch(() => {});
    }).catch((error: unknown) => {
        sendResponse({ ok: false, error: String(error) });
    });
    return true;
});

// Serialise claims so two open extension surfaces cannot both exchange one code.
let takeQueue: Promise<void> = Promise.resolve();
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const incoming: unknown = message;
    if (!isOAuthTakeRequest(incoming)) return false;

    takeQueue = takeQueue.then(async () => {
        const stored = await chrome.storage.local.get(OAUTH_RETURN_KEY);
        const value = stored[OAUTH_RETURN_KEY];
        if (value !== undefined) await chrome.storage.local.remove(OAUTH_RETURN_KEY);
        sendResponse({ ok: true, value });
    }).catch((error: unknown) => {
        sendResponse({ ok: false, error: String(error) });
    });
    return true;
});

chrome.runtime.onInstalled.addListener(() => { void popupOwnsActionClick(); });
void popupOwnsActionClick();
