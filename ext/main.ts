/**
 * Shared entry for the extension pages. Google/email-link auth deliberately
 * returns through https://cells.garden/privacy/oauth-return.html: normal web
 * redirects cannot reliably navigate back to chrome-extension:// pages.
 */
import '../src/core/shim';
import '../src/web/app.css';
import '../src/core/chrome.css';
import '../src/core/ui.css';
import '../src/core/styles.css';
import './ext.css';

import type { SupabaseClient } from '@supabase/supabase-js';
import { bootGarden } from '../src/core/boot';
import {
    OAUTH_RETURN_READY,
    OAUTH_RETURN_TAKE,
    isOAuthReturnMessage,
    type OAuthReturnMessage,
} from './auth-bridge';

const host = document.getElementById('app');
if (!host) throw new Error('cells.garden: #app element missing');
const appHost: HTMLElement = host;

/** False when a built page is opened from disk while debugging: no chrome.* APIs. */
export const inExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.id;

function oauthBridgeUrl(): string {
    const url = new URL('https://cells.garden/privacy/oauth-return.html');
    url.searchParams.set('target', 'extension');
    url.searchParams.set('extension_id', chrome.runtime.id);
    return url.toString();
}

function notice(text: string) {
    appHost.querySelector('.garden-notice')?.remove();
    const el = appHost.createDiv({ cls: 'garden-notice', text, attr: { role: 'status' } });
    window.setTimeout(() => el.remove(), 5000);
}

function takeOAuthReturn(): Promise<OAuthReturnMessage | null> {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: OAUTH_RETURN_TAKE }, (response) => {
            if (chrome.runtime.lastError || !response?.ok || !isOAuthReturnMessage(response.value)) {
                resolve(null);
                return;
            }
            resolve(response.value);
        });
    });
}

let authClient: SupabaseClient | null = null;
let completingOAuth = false;

async function completePendingOAuth() {
    if (!inExtension || !authClient || completingOAuth) return;
    completingOAuth = true;
    try {
        const returned = await takeOAuthReturn();
        if (!returned) return;
        if (returned.error) {
            notice(`Google sign-in did not finish: ${returned.errorDescription ?? returned.error}`);
            return;
        }
        if (!returned.code) return;
        const { error } = await authClient.auth.exchangeCodeForSession(returned.code);
        notice(error ? `Could not sign in: ${error.message}` : 'Signed in.');
    } finally {
        completingOAuth = false;
    }
}

export const ready = bootGarden(appHost, inExtension ? {
    redirectTo: oauthBridgeUrl(),
    // Always keep the extension surface alive while Google runs in a normal tab.
    openOAuth: (url) => void chrome.tabs.create({ url }),
    onClient: (client) => { authClient = client; },
} : {});

if (inExtension) {
    chrome.runtime.onMessage.addListener((message) => {
        if (message?.type === OAUTH_RETURN_READY) void completePendingOAuth();
    });
}

void ready.then((app) => {
    window.garden = app;
    void completePendingOAuth();
});
