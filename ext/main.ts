/**
 * Shared entry for the extension pages. Google auth deliberately returns to
 * https://cells.garden/ because that Site URL is always accepted by Supabase.
 * A same-tab website bridge forwards the PKCE code back to this extension.
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
    OAUTH_INTENT_KEY,
    OAUTH_RETURN_READY,
    OAUTH_RETURN_TAKE,
    isOAuthReturnMessage,
    type OAuthIntent,
    type OAuthReturnMessage,
} from './auth-bridge';

const host = document.getElementById('app');
if (!host) throw new Error('cells.garden: #app element missing');
const appHost: HTMLElement = host;

export const inExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.id;

interface OAuthTakeResponse {
    ok: boolean;
    value?: unknown;
}

function isOAuthTakeResponse(value: unknown): value is OAuthTakeResponse {
    if (!value || typeof value !== 'object') return false;
    return typeof (value as Record<string, unknown>).ok === 'boolean';
}

function hasMessageType(value: unknown, type: string): boolean {
    if (!value || typeof value !== 'object') return false;
    return (value as Record<string, unknown>).type === type;
}

function oauthBridgeUrl(): string {
    const url = new URL('https://cells.garden/privacy/oauth-return.html');
    url.searchParams.set('target', 'extension');
    url.searchParams.set('extension_id', chrome.runtime.id);
    return url.toString();
}

function nonce(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function oauthStartUrl(authorizeUrl: string, intent: OAuthIntent): string {
    const start = new URL('https://cells.garden/privacy/oauth-extension-start.html');
    start.hash = new URLSearchParams({
        extension_id: chrome.runtime.id,
        nonce: intent.nonce,
        authorize_url: authorizeUrl,
    }).toString();
    return start.toString();
}

async function openExtensionOAuth(authorizeUrl: string): Promise<void> {
    const intent: OAuthIntent = { nonce: nonce(), createdAt: Date.now() };
    await chrome.storage.local.set({ [OAUTH_INTENT_KEY]: intent });
    await chrome.tabs.create({ url: oauthStartUrl(authorizeUrl, intent) });
}

function notice(text: string) {
    appHost.querySelector('.garden-notice')?.remove();
    const el = appHost.createDiv({ cls: 'garden-notice', text, attr: { role: 'status' } });
    window.setTimeout(() => el.remove(), 5000);
}

function takeOAuthReturn(): Promise<OAuthReturnMessage | null> {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: OAUTH_RETURN_TAKE }, (response) => {
            const result: unknown = response;
            if (
                chrome.runtime.lastError
                || !isOAuthTakeResponse(result)
                || !result.ok
                || !isOAuthReturnMessage(result.value)
            ) {
                resolve(null);
                return;
            }
            resolve(result.value);
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
    oauthRedirectTo: 'https://cells.garden/',
    openOAuth: (url) => {
        void openExtensionOAuth(url).catch((error: unknown) => {
            notice(`Could not open Google sign-in: ${String(error)}`);
        });
    },
    onClient: (client) => { authClient = client; },
} : {});

if (inExtension) {
    chrome.runtime.onMessage.addListener((message) => {
        const incoming: unknown = message;
        if (hasMessageType(incoming, OAUTH_RETURN_READY)) void completePendingOAuth();
    });
}

void ready.then((app) => {
    window.garden = app;
    void completePendingOAuth();
});
