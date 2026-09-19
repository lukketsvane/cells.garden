/**
 * Typed and bounded messages used by the website -> extension OAuth bridge.
 */
export const OAUTH_RETURN_KEY = 'cells.garden/oauth-return';
export const OAUTH_RETURN_READY = 'cells-garden-oauth-ready';
export const OAUTH_RETURN_TAKE = 'cells-garden-oauth-take';
export const OAUTH_RETURN_TTL_MS = 10 * 60 * 1000;
export const OAUTH_INTENT_KEY = 'cells.garden/oauth-intent';
export const OAUTH_INTENT_TTL_MS = 15 * 60 * 1000;

export interface OAuthReturnMessage {
    type: 'cells-garden-oauth-return';
    code?: string;
    error?: string;
    errorDescription?: string;
    nonce?: string;
}

export interface StoredOAuthReturn {
    receivedAt: number;
    value: OAuthReturnMessage;
}

export interface OAuthIntent {
    nonce: string;
    createdAt: number;
}

function bounded(value: unknown, max: number): value is string {
    if (typeof value !== 'string' || value.length === 0 || value.length > max) return false;
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code < 0x20 || code === 0x7f) return false;
    }
    return true;
}

function validNonce(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

export function isOAuthReturnMessage(value: unknown): value is OAuthReturnMessage {
    if (!value || typeof value !== 'object') return false;
    const message = value as Partial<OAuthReturnMessage>;
    if (message.type !== 'cells-garden-oauth-return') return false;
    const hasCode = bounded(message.code, 4096);
    const hasError = bounded(message.error, 256);
    if (hasCode === hasError) return false;
    if (message.errorDescription !== undefined && !bounded(message.errorDescription, 1024)) return false;
    if (message.nonce !== undefined && !validNonce(message.nonce)) return false;
    return true;
}

export function isOAuthIntent(value: unknown): value is OAuthIntent {
    if (!value || typeof value !== 'object') return false;
    const intent = value as Partial<OAuthIntent>;
    return validNonce(intent.nonce)
        && typeof intent.createdAt === 'number'
        && Number.isFinite(intent.createdAt);
}

export function isStoredOAuthReturn(value: unknown): value is StoredOAuthReturn {
    if (!value || typeof value !== 'object') return false;
    const stored = value as Partial<StoredOAuthReturn>;
    return typeof stored.receivedAt === 'number'
        && Number.isFinite(stored.receivedAt)
        && isOAuthReturnMessage(stored.value);
}
