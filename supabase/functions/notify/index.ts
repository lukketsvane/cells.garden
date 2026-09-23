/**
 * notify: tells people they were assigned a cell (supabase/README.md,
 * Notifications). Deployed as the Edge Function `notify`, one file, no imports.
 *
 * The app calls it with the signed-in user's token after an assignment is
 * saved: { recipients, gardenId, plantId?, projectId, itemId, text, where }.
 * Nothing in that body is trusted. With the service role the function checks
 * that the caller can open the garden, that the cell is in it and names each
 * recipient among its people, and that each recipient can see it too (the
 * garden's owner or members, or the shared plant's). The title and the text
 * come from the saved garden and the caller's profile, not from the body. Then
 * it writes one `notifications` row per recipient (migration 0012) and sends
 * a Web Push to each of their devices: VAPID-signed (RFC 8292), encrypted
 * aes128gcm (RFC 8291), with WebCrypto alone. A device the push service no
 * longer knows (404, 410) is forgotten.
 *
 * Supabase provides SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The function
 * generates its VAPID pair on first use and keeps it in a private database
 * table (0013). Only the public key is returned to signed-in clients.
 *
 * The pure parts are exported for the unit tests (src/core/notify-server.test.ts),
 * which run this file under Node; it only starts serving under Deno.
 */

// --- Limits ----------------------------------------------------------------------

/** Anyone can be told by one call: more than a garden and a plant hold together. */
const MAX_RECIPIENTS = 20;
/** Notifications one person can send in a minute. */
const PER_MINUTE = 30;
/** The same cell from the same person is told once in this long. */
const QUIET_MS = 10 * 60 * 1000;
/** How long a push service keeps trying a device that is off: a day. */
const TTL_SECONDS = 24 * 60 * 60;
/** The one record's size (RFC 8188); a payload here is far smaller. */
const RECORD_SIZE = 4096;

/** Where the app runs: the web app, its dev deploy, both Chrome Web Store listings, Obsidian, and local development. */
const ORIGINS = new Set([
    'https://cells.garden',
    'https://dev.cells.garden',
    'chrome-extension://cighiofbnmdgppphnofkgfoneldalbbf',
    'chrome-extension://flgbihgnkkhjokjblnbcjmmjhdejokfd',
    'app://obsidian.md',
]);
const LOCAL_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;

/**
 * The push services browsers use. A subscription pointing anywhere else is
 * never sent to, so a made-up endpoint cannot turn this function into a way
 * of making requests to other hosts.
 */
const PUSH_HOSTS = [
    /^fcm\.googleapis\.com$/,
    /^android\.googleapis\.com$/,
    /^(?:[a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
    /^(?:[a-z0-9-]+\.)*push\.apple\.com$/,
    /^(?:[a-z0-9-]+\.)*notify\.windows\.com$/,
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZONES = ['flowers', 'stem', 'roots', 'minerals'] as const;

// --- Bytes -------------------------------------------------------------------------

const encoder = new TextEncoder();
const utf8 = (text: string): Uint8Array => encoder.encode(text);
/** WebCrypto takes these; the cast keeps older and newer TypeScript libs both content. */
const src = (bytes: Uint8Array): BufferSource => bytes as unknown as BufferSource;

function concat(...parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}

export function toBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
    const clean = text.trim().replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

// --- Web Push encryption (RFC 8291, aes128gcm) -------------------------------------

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey('raw', src(ikm), 'HKDF', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: src(salt), info: src(info) }, key, length * 8);
    return new Uint8Array(bits);
}

/** A P-256 key as JWK, from its raw public point (65 bytes) and, for a private key, its 32-byte d. */
function p256Jwk(publicPoint: Uint8Array, d?: Uint8Array): JsonWebKey {
    return {
        kty: 'EC',
        crv: 'P-256',
        x: toBase64Url(publicPoint.slice(1, 33)),
        y: toBase64Url(publicPoint.slice(33, 65)),
        ...(d ? { d: toBase64Url(d) } : {}),
    };
}

/**
 * The body of one push: `payload` encrypted to the device's keys (the
 * subscription's p256dh and auth). A fresh key pair and salt every time;
 * `fixed` pins both, for the RFC's worked example in the tests.
 */
export async function encryptPayload(
    payload: Uint8Array,
    p256dh: string,
    authSecret: string,
    fixed?: { serverPublic: Uint8Array; serverPrivate: Uint8Array; salt: Uint8Array },
): Promise<Uint8Array> {
    const devicePublic = fromBase64Url(p256dh);
    const auth = fromBase64Url(authSecret);
    if (devicePublic.length !== 65 || devicePublic[0] !== 4 || auth.length < 16) throw new Error('bad subscription keys');
    const curve = { name: 'ECDH', namedCurve: 'P-256' };

    let serverPrivate: CryptoKey;
    let serverPublic: Uint8Array;
    if (fixed) {
        serverPrivate = await crypto.subtle.importKey('jwk', p256Jwk(fixed.serverPublic, fixed.serverPrivate), curve, false, ['deriveBits']);
        serverPublic = fixed.serverPublic;
    } else {
        const pair = await crypto.subtle.generateKey(curve, true, ['deriveBits']) as CryptoKeyPair;
        serverPrivate = pair.privateKey;
        serverPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    }
    const device = await crypto.subtle.importKey('raw', src(devicePublic), curve, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: device }, serverPrivate, 256));

    const ikm = await hkdf(auth, shared, concat(utf8('WebPush: info\0'), devicePublic, serverPublic), 32);
    const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
    const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);

    // One record, the last: the payload and the delimiter 0x02, no padding.
    const key = await crypto.subtle.importKey('raw', src(cek), 'AES-GCM', false, ['encrypt']);
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: src(nonce), tagLength: 128 }, key, src(concat(payload, new Uint8Array([2])))));
    if (sealed.length > RECORD_SIZE) throw new Error('payload too large');

    const header = new Uint8Array(16 + 4 + 1 + serverPublic.length);
    header.set(salt, 0);
    new DataView(header.buffer).setUint32(16, RECORD_SIZE);
    header[20] = serverPublic.length;
    header.set(serverPublic, 21);
    return concat(header, sealed);
}

// --- VAPID (RFC 8292) ----------------------------------------------------------------

/**
 * The Authorization header for one push service: a JWT for its origin, signed
 * ES256 with the VAPID private key, and the public key beside it.
 */
export async function vapidAuthorization(
    endpoint: string,
    subject: string,
    publicKey: string,
    privateKey: string,
    now: number = Date.now(),
): Promise<string> {
    const audience = new URL(endpoint).origin;
    const header = toBase64Url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    const claims = toBase64Url(utf8(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 60 * 60, sub: subject })));
    const key = await crypto.subtle.importKey(
        'jwk',
        p256Jwk(fromBase64Url(publicKey), fromBase64Url(privateKey)),
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign'],
    );
    // WebCrypto signs as r || s, 64 bytes: exactly what a JWS wants.
    const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, src(utf8(`${header}.${claims}`))));
    return `vapid t=${header}.${claims}.${toBase64Url(signature)}, k=${publicKey}`;
}

export function allowedPushEndpoint(endpoint: string): boolean {
    try {
        const url = new URL(endpoint);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port
            && PUSH_HOSTS.some(host => host.test(url.hostname));
    } catch {
        return false;
    }
}

// --- What the notification says, and where it leads ---------------------------------

/** One line of at most `limit` characters, cut with an ellipsis. */
export function clip(text: string, limit: number): string {
    const line = text.replace(/\s+/g, ' ').trim();
    return line.length <= limit ? line : line.slice(0, limit - 1).trimEnd() + '…';
}

/** "Ana assigned you", then the cell's text and the plant's name. */
export function notificationText(actor: string, cellText: string, where: string): { title: string; body: string } {
    const title = `${clip(actor, 60) || 'Someone'} assigned you`;
    const text = clip(cellText, 140);
    const place = clip(where, 60);
    return { title, body: [text, place].filter(Boolean).join(' · ') };
}

/** The app's address for one cell, as src/core/notify-core.ts reads it. Relative: each device's app resolves it. */
export function cellPath(target: { itemId: string; projectId: string; gardenId?: string | null; plantId?: string | null }): string {
    const parts: [string, string][] = [['cell', target.itemId], ['project', target.projectId]];
    if (target.gardenId) parts.push(['garden', target.gardenId]);
    if (target.plantId) parts.push(['sharedPlant', target.plantId]);
    return './#' + parts.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

export interface NotifyRequest {
    recipients: string[];
    gardenId: string;
    plantId: string | null;
    projectId: string;
    itemId: string;
}

const shortText = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;

/** The request, checked for shape (what it claims is checked against the database later), or what is wrong with it. */
export function parseRequest(body: unknown): NotifyRequest | string {
    if (!body || typeof body !== 'object') return 'expected a JSON object';
    const b = body as Record<string, unknown>;
    if (!Array.isArray(b.recipients)) return 'recipients must be a list';
    const recipients = [...new Set((b.recipients as unknown[]).filter((r): r is string => typeof r === 'string' && UUID.test(r)).map(r => r.toLowerCase()))];
    if (recipients.length === 0) return 'no recipients';
    if (recipients.length > MAX_RECIPIENTS) return 'too many recipients';
    if (typeof b.gardenId !== 'string' || !UUID.test(b.gardenId)) return 'gardenId must be a garden id';
    if (b.plantId !== undefined && b.plantId !== null && (typeof b.plantId !== 'string' || !UUID.test(b.plantId))) return 'plantId must be a plant id';
    if (!shortText(b.projectId) || !shortText(b.itemId)) return 'projectId and itemId are required';
    return {
        recipients,
        gardenId: b.gardenId.toLowerCase(),
        plantId: typeof b.plantId === 'string' ? b.plantId.toLowerCase() : null,
        projectId: b.projectId,
        itemId: b.itemId,
    };
}

interface StoredItem { id?: unknown; content?: unknown; assignees?: unknown }
interface StoredProject { id?: unknown; seed?: unknown; name?: unknown; sharedPlantId?: unknown; [zone: string]: unknown }

/** The cell in a stored garden's plants, with its plant, or null. */
export function findCell(projects: unknown, projectId: string, itemId: string): { project: StoredProject; item: StoredItem } | null {
    if (!Array.isArray(projects)) return null;
    for (const project of projects as StoredProject[]) {
        if (!project || typeof project !== 'object' || project.id !== projectId) continue;
        for (const zone of ZONES) {
            const items = project[zone];
            if (!Array.isArray(items)) continue;
            const item = (items as StoredItem[]).find(i => i && typeof i === 'object' && i.id === itemId);
            if (item) return { project, item };
        }
    }
    return null;
}

/** The account ids a stored cell names, as the app reads them (src/core/assign.ts). */
export function assigneesOf(item: StoredItem): string[] {
    return Array.isArray(item.assignees) ? [...new Set((item.assignees as unknown[]).filter((a): a is string => typeof a === 'string'))] : [];
}

export function corsHeaders(origin: string | null): Record<string, string> {
    const headers: Record<string, string> = {
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
    };
    if (origin && (ORIGINS.has(origin) || LOCAL_ORIGIN.test(origin))) headers['Access-Control-Allow-Origin'] = origin;
    return headers;
}

// --- The server ------------------------------------------------------------------------

interface Env {
    url: string;
    key: string;
    anonKey: string;
    vapid: { publicKey: string; privateKey: string; subject: string } | null;
}

type DenoLike = {
    serve: (handler: (req: Request) => Response | Promise<Response>) => unknown;
    env: { get(name: string): string | undefined };
};

function readEnv(get: (name: string) => string | undefined): Env | null {
    const url = get('SUPABASE_URL');
    const key = get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return null;
    return {
        url: url.replace(/\/+$/, ''),
        key,
        anonKey: get('SUPABASE_ANON_KEY') || key,
        vapid: null,
    };
}

/** A PostgREST request as the service role: it reads past row level security, so every check here is the function's own. */
function rest(env: Env, path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<Response> {
    const headers: Record<string, string> = { apikey: env.key, 'Content-Type': 'application/json' };
    // A legacy service key is a JWT and goes in Authorization too; a new secret key does not.
    if (env.key.startsWith('eyJ')) headers.Authorization = `Bearer ${env.key}`;
    if (init.prefer) headers.Prefer = init.prefer;
    return fetch(`${env.url}/rest/v1/${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
}

async function rows<T>(env: Env, path: string): Promise<T[]> {
    const res = await rest(env, path);
    if (!res.ok) throw new Error(`${path.split('?')[0]}: HTTP ${res.status} ${await res.text()}`);
    return (await res.json()) as T[];
}

/** Fetch the persistent pair; create it atomically if this is the first use. */
async function pushKeys(env: Env): Promise<NonNullable<Env['vapid']>> {
    if (env.vapid) return env.vapid;
    const read = async (candidate: Env['vapid']) => {
        const res = await rest(env, 'rpc/service_push_keys', { method: 'POST', body: { candidate } });
        if (!res.ok) throw new Error(`push keys: HTTP ${res.status}`);
        return await res.json() as Env['vapid'];
    };
    let keys = await read(null);
    if (!keys) {
        const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
        keys = await read({
            publicKey: toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
            privateKey: (await crypto.subtle.exportKey('jwk', pair.privateKey)).d!,
            subject: 'https://cells.garden',
        });
    }
    if (!keys?.publicKey || !keys.privateKey) throw new Error('push keys unavailable');
    env.vapid = keys;
    return keys;
}

/** How many rows match, from PostgREST's Content-Range. */
async function count(env: Env, path: string): Promise<number> {
    const res = await rest(env, `${path}&select=id&limit=1`, { prefer: 'count=exact' });
    if (!res.ok) throw new Error(`count: HTTP ${res.status}`);
    const total = /\/(\d+)$/.exec(res.headers.get('Content-Range') ?? '')?.[1];
    return total ? Number(total) : 0;
}

const q = encodeURIComponent;

/** The caller, from their own token, as the auth server sees it. */
async function caller(env: Env, req: Request): Promise<string | null> {
    const token = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1];
    if (!token) return null;
    const res = await fetch(`${env.url}/auth/v1/user`, { headers: { apikey: env.anonKey, Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const user = (await res.json()) as { id?: unknown };
    return typeof user.id === 'string' && UUID.test(user.id) ? user.id.toLowerCase() : null;
}

/** An owner (a garden's user_id or owner_id, a plant's owner_id) and every member. */
async function peopleOf(env: Env, kind: 'garden' | 'plant', id: string): Promise<Set<string>> {
    const [owners, members] = await Promise.all([
        kind === 'garden'
            ? rows<{ user_id: string | null; owner_id: string | null }>(env, `gardens?id=eq.${q(id)}&select=user_id,owner_id`)
            : rows<{ owner_id: string | null }>(env, `plants?id=eq.${q(id)}&select=owner_id`),
        rows<{ user_id: string }>(env, `${kind}_members?${kind}_id=eq.${q(id)}&select=user_id`),
    ]);
    const people = new Set(members.map(m => m.user_id));
    for (const o of owners as { user_id?: string | null; owner_id?: string | null }[]) {
        const owner = o.user_id ?? o.owner_id;
        if (owner) people.add(owner);
    }
    return people;
}

interface Subscription { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }

/** Send one push. The status says what became of it: 2xx sent, 404 and 410 gone for good. */
async function push(env: Env, sub: Subscription, payload: unknown): Promise<number> {
    if (!env.vapid || !allowedPushEndpoint(sub.endpoint)) return 0;
    const body = await encryptPayload(utf8(JSON.stringify(payload)), sub.p256dh, sub.auth);
    const res = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
            Authorization: await vapidAuthorization(sub.endpoint, env.vapid.subject, env.vapid.publicKey, env.vapid.privateKey),
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            TTL: String(TTL_SECONDS),
            Urgency: 'normal',
        },
        body: src(body),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.warn('notify: push refused', res.status, new URL(sub.endpoint).host, (await res.text()).slice(0, 200));
    return res.status;
}

function reply(status: number, body: unknown, cors: Record<string, string>): Response {
    return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

export async function handle(req: Request, env: Env | null): Promise<Response> {
    const cors = corsHeaders(req.headers.get('Origin'));
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return reply(405, { error: 'POST only' }, cors);
    if (!env) return reply(500, { error: 'not configured' }, cors);

    const me = await caller(env, req);
    if (!me) return reply(401, { error: 'sign in first' }, cors);

    let parsed: NotifyRequest | string;
    try {
        const body = await req.json() as unknown;
        if (body && typeof body === 'object' && (body as { action?: unknown }).action === 'public-key') {
            const keys = await pushKeys(env);
            return reply(200, { publicKey: keys.publicKey }, cors);
        }
        parsed = parseRequest(body);
    } catch {
        parsed = 'expected JSON';
    }
    if (typeof parsed === 'string') return reply(400, { error: parsed }, cors);
    const ask = parsed;

    try {
        const since = new Date(Date.now() - 60_000).toISOString();
        const sent = await count(env, `notifications?actor_id=eq.${me}&created_at=gte.${q(since)}`);
        if (sent + ask.recipients.length > PER_MINUTE) return reply(429, { error: 'too many notifications, try again in a minute' }, cors);

        // The garden, its people, and the cell as it was saved.
        const [gardens, gardenPeople] = await Promise.all([
            rows<{ name: string | null; projects: unknown }>(env, `gardens?id=eq.${q(ask.gardenId)}&select=name,projects:data->projects`),
            peopleOf(env, 'garden', ask.gardenId),
        ]);
        if (gardens.length === 0) return reply(404, { error: 'no such garden' }, cors);
        if (!gardenPeople.has(me)) return reply(403, { error: 'not your garden' }, cors);
        const cell = findCell(gardens[0].projects, ask.projectId, ask.itemId);
        if (!cell) return reply(404, { error: 'no such cell' }, cors);

        // A shared plant's people see the cell too, when it is on that plant and the caller has it.
        const onPlant = ask.plantId && cell.project.sharedPlantId === ask.plantId ? ask.plantId : null;
        const plantPeople = onPlant ? await peopleOf(env, 'plant', onPlant) : new Set<string>();
        const viaPlant = onPlant !== null && plantPeople.has(me);

        // A garden copy can be stale or forged. Only the shared row authorizes
        // telling someone who can see the plant but cannot see this garden.
        const sharedRows = viaPlant ? await rows<{ data: Record<string, unknown> }>(env,
            `plants?id=eq.${q(onPlant!)}&select=data`) : [];
        const sharedCell = sharedRows[0]?.data
            ? findCell([{ ...sharedRows[0].data, id: ask.projectId }], ask.projectId, ask.itemId) : null;
        const sharedAssigned = new Set(sharedCell ? assigneesOf(sharedCell.item) : []);

        const assigned = new Set(assigneesOf(cell.item));
        const quietSince = new Date(Date.now() - QUIET_MS).toISOString();
        const recent = await rows<{ user_id: string }>(env,
            `notifications?actor_id=eq.${me}&item_id=eq.${q(ask.itemId)}&project_id=eq.${q(ask.projectId)}&${onPlant ? `plant_id=eq.${q(onPlant)}` : `garden_id=eq.${q(ask.gardenId)}`}&created_at=gte.${q(quietSince)}&select=user_id`);
        const toldAlready = new Set(recent.map(r => r.user_id));
        const recipients = ask.recipients.filter(r =>
            r !== me && assigned.has(r) && !toldAlready.has(r) && (gardenPeople.has(r) || (viaPlant && plantPeople.has(r) && sharedAssigned.has(r))));
        if (recipients.length === 0) return reply(200, { notified: 0, pushed: 0 }, cors);

        const profiles = await rows<{ display_name: string | null }>(env, `profiles?id=eq.${me}&select=display_name`);
        const where = typeof cell.project.seed === 'string' && cell.project.seed ? cell.project.seed
            : typeof cell.project.name === 'string' ? cell.project.name : '';
        const { title, body } = notificationText(profiles[0]?.display_name ?? '', typeof cell.item.content === 'string' ? cell.item.content : '', where);

        // Someone in the garden opens it there; someone who has only the plant opens their own garden, where it grows.
        const drafts = recipients.map((r) => {
            const inGarden = gardenPeople.has(r);
            return {
                user_id: r,
                actor_id: me,
                kind: 'assigned',
                garden_id: inGarden ? ask.gardenId : null,
                plant_id: onPlant,
                project_id: ask.projectId,
                item_id: ask.itemId,
                title,
                body,
            };
        });
        const inserted = await rest(env, 'notifications', { method: 'POST', body: drafts, prefer: 'return=representation' });
        if (!inserted.ok) throw new Error(`insert: HTTP ${inserted.status} ${await inserted.text()}`);
        const written = (await inserted.json()) as { id: string; user_id: string; garden_id: string | null }[];

        const subscriptions = await rows<Subscription>(env,
            `push_subscriptions?user_id=in.(${recipients.join(',')})&select=id,user_id,endpoint,p256dh,auth`);
        if (subscriptions.length) await pushKeys(env);
        const unread = new Map<string, number>();
        await Promise.all([...new Set(subscriptions.map(s => s.user_id))].map(async (r) => {
            unread.set(r, await count(env, `notifications?user_id=eq.${r}&read_at=is.null`).catch(() => 0));
        }));

        const gone: string[] = [];
        const used: string[] = [];
        await Promise.all(subscriptions.map(async (sub) => {
            const row = written.find(w => w.user_id === sub.user_id);
            if (!row) return;
            const payload = {
                title,
                body,
                url: cellPath({ itemId: ask.itemId, projectId: ask.projectId, gardenId: row.garden_id, plantId: onPlant }),
                tag: `cell:${ask.itemId}`.slice(0, 100),
                badge: unread.get(sub.user_id) ?? 1,
                id: row.id,
            };
            try {
                const status = await push(env, sub, payload);
                if (status === 404 || status === 410) gone.push(sub.id);
                else if (status >= 200 && status < 300) used.push(sub.id);
            } catch (e) {
                console.warn('notify: push failed', (e as Error).message);
            }
        }));
        if (gone.length) await rest(env, `push_subscriptions?id=in.(${gone.join(',')})`, { method: 'DELETE' });
        if (used.length) {
            await rest(env, `push_subscriptions?id=in.(${used.join(',')})`, { method: 'PATCH', body: { last_used_at: new Date().toISOString() } });
        }
        return reply(200, { notified: written.length, pushed: used.length }, cors);
    } catch (e) {
        console.error('notify:', (e as Error).message);
        return reply(500, { error: 'could not notify' }, cors);
    }
}

const deno = (globalThis as { Deno?: DenoLike }).Deno;
if (deno) {
    const env = readEnv((name) => deno.env.get(name));
    deno.serve((req) => handle(req, env));
}
