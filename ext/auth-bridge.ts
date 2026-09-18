/**
 * The web OAuth callback cannot navigate directly back into an extension
 * reliably. cells.garden hands the PKCE code to the extension service worker,
 * which holds it until any extension surface is ready to exchange it.
 */
export const OAUTH_RETURN_KEY = 'cells.garden/oauth-return';
export const OAUTH_RETURN_READY = 'cells-garden-oauth-ready';
export const OAUTH_RETURN_TAKE = 'cells-garden-oauth-take';

export interface OAuthReturnMessage {
    type: 'cells-garden-oauth-return';
    code?: string;
    error?: string;
    errorDescription?: string;
}

export function isOAuthReturnMessage(value: unknown): value is OAuthReturnMessage {
    if (!value || typeof value !== 'object') return false;
    const message = value as Partial<OAuthReturnMessage>;
    return message.type === 'cells-garden-oauth-return'
        && (typeof message.code === 'string' || typeof message.error === 'string');
}
