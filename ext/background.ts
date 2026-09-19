/**
 * MV3 service worker and the short-lived website -> extension OAuth hand-off.
 */
import {
    OAUTH_INTENT_KEY,
    OAUTH_INTENT_TTL_MS,
    OAUTH_RETURN_KEY,
    OAUTH_RETURN_READY,
    OAUTH_RETURN_TAKE,
    OAUTH_RETURN_TTL_MS,
    isOAuthIntent,
    isOAuthReturnMessage,
    isStoredOAuthReturn,
    type OAuthReturnMessage,
    type StoredOAuthReturn,
} from './auth-bridge';

function popupOwnsActionClick(): Promise<void> {
    if (!chrome.sidePanel?.setPanelBehavior) return Promise.resolve();
    return chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: false })
        .catch((e: unknown) => console.error('cells.garden: could not set the side panel behavior', e));
}

type OAuthBridgeKind = 'dedicated' | 'root';

function oauthBridgeKind(sender: chrome.runtime.MessageSender): OAuthBridgeKind | null {
    if (!sender.url) return null;
    try {
        const url = new URL(sender.url);
        if (url.origin !== 'https://cells.garden') return null;
        if (url.pathname === '/privacy/oauth-return.html') return 'dedicated';
        if (url.pathname === '/' || url.pathname === '/index.html') return 'root';
        return null;
    } catch {
        return null;
    }
}

function isOAuthTakeRequest(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    return (value as Record<string, unknown>).type === OAUTH_RETURN_TAKE;
}

async function acceptRootIntent(message: OAuthReturnMessage): Promise<boolean> {
    if (!message.nonce) return false;
    const stored = await chrome.storage.local.get(OAUTH_INTENT_KEY);
    const intent: unknown = stored[OAUTH_INTENT_KEY];
    if (!isOAuthIntent(intent) || intent.nonce !== message.nonce) return false;
    const age = Date.now() - intent.createdAt;
    if (age < 0 || age > OAUTH_INTENT_TTL_MS) {
        await chrome.storage.local.remove(OAUTH_INTENT_KEY);
        return false;
    }
    await chrome.storage.local.remove(OAUTH_INTENT_KEY);
    return true;
}

async function storeOAuthReturn(message: OAuthReturnMessage): Promise<void> {
    const stored: StoredOAuthReturn = { receivedAt: Date.now(), value: message };
    await chrome.storage.local.set({ [OAUTH_RETURN_KEY]: stored });
    void chrome.runtime.sendMessage({ type: OAUTH_RETURN_READY }).catch(() => {});
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    const incoming: unknown = message;
    const kind = oauthBridgeKind(sender);
    if (!kind || !isOAuthReturnMessage(incoming)) {
        sendResponse({ ok: false });
        return false;
    }

    void (async () => {
        if (kind === 'root' && !(await acceptRootIntent(incoming))) {
            sendResponse({ ok: false });
            return;
        }
        await storeOAuthReturn(incoming);
        sendResponse({ ok: true });
    })().catch((error: unknown) => {
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
