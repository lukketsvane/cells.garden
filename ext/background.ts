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

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (!fromCellsGarden(sender) || !isOAuthReturnMessage(message)) {
        sendResponse({ ok: false });
        return false;
    }

    void chrome.storage.local.set({ [OAUTH_RETURN_KEY]: message }).then(() => {
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
    if (!message || message.type !== OAUTH_RETURN_TAKE) return false;

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
