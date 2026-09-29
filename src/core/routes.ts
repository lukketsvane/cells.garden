/** Public web addresses. Account and garden access is still checked by the server. */
export type Route =
    | { kind: 'home' | 'about' | 'missing' }
    | { kind: 'garden'; id: string }
    | { kind: 'user'; id: string }
    | { kind: 'invite'; token: string; target: 'garden' | 'plant' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRoute(pathname: string): Route {
    let path: string;
    try { path = decodeURIComponent(pathname).replace(/\/$/, '') || '/'; }
    catch { return { kind: 'missing' }; }
    if (path === '/') return { kind: 'home' };
    if (path === '/about') return { kind: 'about' };
    const parts = path.split('/').slice(1);
    const [kind, id] = parts;
    if (parts.length === 2 && (kind === 'garden' || kind === 'user') && UUID.test(id)) {
        return { kind, id: id.toLowerCase() };
    }
    if (parts.length === 2 && kind === 'garden' && id === 'local') return { kind: 'garden', id };
    if (kind === 'invite') {
        if (parts.length === 2 && UUID.test(id)) return { kind, token: id.toLowerCase(), target: 'garden' };
        if (parts.length === 3 && id === 'plant' && UUID.test(parts[2])) {
            return { kind, token: parts[2].toLowerCase(), target: 'plant' };
        }
    }
    return { kind: 'missing' };
}

export const gardenPath = (id: string) => `/garden/${encodeURIComponent(id)}`;
export const userPath = (id: string) => `/user/${encodeURIComponent(id)}`;
export const invitePath = (token: string, target: 'garden' | 'plant' = 'garden') =>
    `/invite/${target === 'plant' ? 'plant/' : ''}${encodeURIComponent(token)}`;
