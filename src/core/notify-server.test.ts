// The notify Edge Function's own parts (supabase/functions/notify/index.ts),
// run under Node: Web Push encryption against RFC 8291's worked example and
// a decryption written apart from it, the VAPID signature, and what it reads
// from a request and a stored garden.
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, hkdfSync } from 'node:crypto';
import test from 'node:test';
import {
    allowedPushEndpoint,
    assigneesOf,
    cellPath,
    corsHeaders,
    encryptPayload,
    findCell,
    fromBase64Url,
    handle,
    notificationText,
    parseRequest,
    toBase64Url,
    vapidAuthorization,
} from '../../supabase/functions/notify/index';
import { cellTargetFromHash } from './notify-core';

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

// RFC 8291, Appendix A.
const RFC = {
    plaintext: 'When I grow up, I want to be a watermelon',
    serverPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    serverPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    devicePrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    devicePublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    salt: 'DGv6ra1nlYgDCS1FRnbzlw',
    message: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

/** The receiving side of RFC 8291, the way a browser does it, with node:crypto and nothing from the function. */
function decrypt(message: Uint8Array, devicePrivate: string, auth: string): string {
    const salt = message.subarray(0, 16);
    const rs = Buffer.from(message.subarray(16, 20)).readUInt32BE(0);
    const idLength = message[20];
    const serverPublic = message.subarray(21, 21 + idLength);
    const sealed = message.subarray(21 + idLength);
    assert.equal(rs, 4096);
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(devicePrivate, 'base64url'));
    const devicePublic = ecdh.getPublicKey();
    const shared = ecdh.computeSecret(serverPublic);
    const info = (text: string) => Buffer.from(text + '\0', 'latin1');
    const ikm = Buffer.from(hkdfSync('sha256', shared, Buffer.from(auth, 'base64url'), Buffer.concat([info('WebPush: info'), devicePublic, serverPublic]), 32));
    const cek = Buffer.from(hkdfSync('sha256', ikm, salt, info('Content-Encoding: aes128gcm'), 16));
    const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, info('Content-Encoding: nonce'), 12));
    const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
    decipher.setAuthTag(sealed.subarray(sealed.length - 16));
    const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
    assert.equal(plain[plain.length - 1], 2, 'one record, the last');
    return plain.subarray(0, plain.length - 1).toString('utf8');
}

test('Web Push encryption reproduces the worked example of RFC 8291', async () => {
    const message = await encryptPayload(new TextEncoder().encode(RFC.plaintext), RFC.devicePublic, RFC.auth, {
        serverPublic: fromBase64Url(RFC.serverPublic),
        serverPrivate: fromBase64Url(RFC.serverPrivate),
        salt: fromBase64Url(RFC.salt),
    });
    assert.equal(b64(message), RFC.message);
    assert.equal(decrypt(message, RFC.devicePrivate, RFC.auth), RFC.plaintext);
});

test('a real push, with a fresh key and salt, opens on the device it was sealed for', async () => {
    const device = createECDH('prime256v1');
    device.generateKeys();
    const auth = b64(new Uint8Array(16).fill(9));
    const payload = JSON.stringify({ title: 'Ana assigned you', body: 'Water the tomatoes · Tomatoes', url: './#cell=i&project=p' });
    const one = await encryptPayload(new TextEncoder().encode(payload), b64(device.getPublicKey()), auth);
    const two = await encryptPayload(new TextEncoder().encode(payload), b64(device.getPublicKey()), auth);
    assert.notEqual(b64(one), b64(two), 'never the same bytes twice');
    assert.equal(decrypt(one, b64(device.getPrivateKey()), auth), payload);
    await assert.rejects(encryptPayload(new Uint8Array(1), 'AAAA', auth), /bad subscription keys/);
});

test('the VAPID header: a JWT for the push service, signed with the private key, the public key beside it', async () => {
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const publicKey = b64(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)));
    const privateKey = (await crypto.subtle.exportKey('jwk', keys.privateKey)).d ?? '';
    const now = Date.UTC(2026, 8, 23, 12);
    const header = await vapidAuthorization('https://web.push.apple.com/QGuQyavXutnMmpgHcN0nQ', 'mailto:garden@example.com', publicKey, privateKey, now);
    const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
    assert.ok(match, header);
    const [, head, claims, signature, k] = match;
    assert.equal(k, publicKey);
    assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url').toString()), { typ: 'JWT', alg: 'ES256' });
    const body = JSON.parse(Buffer.from(claims, 'base64url').toString()) as { aud: string; exp: number; sub: string };
    assert.equal(body.aud, 'https://web.push.apple.com');
    assert.equal(body.sub, 'mailto:garden@example.com');
    assert.equal(body.exp, now / 1000 + 12 * 3600, 'under the 24 hours push services allow');
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, keys.publicKey,
        Buffer.from(signature, 'base64url'), new TextEncoder().encode(`${head}.${claims}`));
    assert.equal(valid, true);
});

test('pushes go to the push services browsers use, and nowhere else', () => {
    for (const ok of ['https://fcm.googleapis.com/fcm/send/abc', 'https://web.push.apple.com/QG', 'https://updates.push.services.mozilla.com/wpush/v2/x',
        'https://wns2-by3p.notify.windows.com/w/?token=x']) assert.equal(allowedPushEndpoint(ok), true, ok);
    for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.example/fcm.googleapis.com', 'https://push.apple.com.evil.example/', 'not a url',
        'https://169.254.169.254/latest']) assert.equal(allowedPushEndpoint(bad), false, bad);
});

test('the words: who assigned you, then the cell and its plant', () => {
    assert.deepEqual(notificationText('Ana', '  Water the\ntomatoes ', 'Tomatoes'), { title: 'Ana assigned you', body: 'Water the tomatoes · Tomatoes' });
    assert.deepEqual(notificationText('', 'x', ''), { title: 'Someone assigned you', body: 'x' });
    assert.equal(notificationText('Ana', 'y'.repeat(300), 'P').body.length, 140 + ' · P'.length);
});

test('the address in a push is the one the app opens', () => {
    const garden = '3f2c9a1e-5b7d-4c8e-9f10-2a3b4c5d6e7f';
    const path = cellPath({ itemId: 'item 1', projectId: 'proj_1', gardenId: garden, plantId: null });
    assert.equal(path.startsWith('./#'), true);
    assert.deepEqual(cellTargetFromHash(new URL(path, 'https://cells.garden/').hash), { itemId: 'item 1', projectId: 'proj_1', gardenId: garden });
});

test('a request is checked for shape, whatever it claims', () => {
    const a = '11111111-1111-4111-8111-111111111111';
    const g = '3f2c9a1e-5b7d-4c8e-9f10-2a3b4c5d6e7f';
    assert.deepEqual(parseRequest({ recipients: [a, a.toUpperCase(), 'x'], gardenId: g, projectId: 'p', itemId: 'i', text: 'ignored' }),
        { recipients: [a], gardenId: g, plantId: null, projectId: 'p', itemId: 'i' });
    assert.equal(typeof parseRequest(null), 'string');
    assert.equal(typeof parseRequest({ recipients: [], gardenId: g, projectId: 'p', itemId: 'i' }), 'string');
    assert.equal(typeof parseRequest({ recipients: [a], gardenId: 'nope', projectId: 'p', itemId: 'i' }), 'string');
    assert.equal(typeof parseRequest({ recipients: [a], gardenId: g, plantId: 'nope', projectId: 'p', itemId: 'i' }), 'string');
    assert.equal(typeof parseRequest({ recipients: [a], gardenId: g, projectId: '', itemId: 'i' }), 'string');
    const many = Array.from({ length: 21 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`);
    assert.equal(parseRequest({ recipients: many, gardenId: g, projectId: 'p', itemId: 'i' }), 'too many recipients');
});

test('the cell is found in the garden as saved, with the people it names', () => {
    const projects = [
        { id: 'p1', seed: 'Beans', stem: [{ id: 's1', content: 'x' }] },
        { id: 'p2', seed: 'Tomatoes', flowers: 'junk', minerals: [null, { id: 'm1', content: 'Water', assignees: ['a', 'b', 'a', 3] }] },
    ];
    const found = findCell(projects, 'p2', 'm1');
    assert.ok(found);
    assert.equal(found.project.seed, 'Tomatoes');
    assert.deepEqual(assigneesOf(found.item), ['a', 'b']);
    assert.equal(findCell(projects, 'p1', 'm1'), null, 'the right cell on the wrong plant is not it');
    assert.equal(findCell({}, 'p1', 's1'), null);
});

test('CORS answers the app\'s own origins only', () => {
    assert.equal(corsHeaders('https://cells.garden')['Access-Control-Allow-Origin'], 'https://cells.garden');
    assert.equal(corsHeaders('https://dev.cells.garden')['Access-Control-Allow-Origin'], 'https://dev.cells.garden');
    assert.equal(corsHeaders('http://localhost:5173')['Access-Control-Allow-Origin'], 'http://localhost:5173');
    assert.equal(corsHeaders('chrome-extension://cighiofbnmdgppphnofkgfoneldalbbf')['Access-Control-Allow-Origin'], 'chrome-extension://cighiofbnmdgppphnofkgfoneldalbbf');
    assert.equal(corsHeaders('https://evil.example')['Access-Control-Allow-Origin'], undefined);
    assert.equal(corsHeaders(null)['Access-Control-Allow-Origin'], undefined);
});

test('the handler answers a preflight, refuses other verbs, and says when it is not set up, all before any request goes out', async () => {
    const origin = { Origin: 'https://cells.garden' };
    const pre = await handle(new Request('https://x.supabase.co/functions/v1/notify', { method: 'OPTIONS', headers: origin }), null);
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('Access-Control-Allow-Origin'), 'https://cells.garden');
    assert.equal((await handle(new Request('https://x.supabase.co/functions/v1/notify', { method: 'GET' }), null)).status, 405);
    assert.equal((await handle(new Request('https://x.supabase.co/functions/v1/notify', { method: 'POST', body: '{}' }), null)).status, 500);
});

test('base64url both ways', () => {
    const bytes = new Uint8Array([0, 255, 62, 63, 250]);
    assert.equal(toBase64Url(bytes), Buffer.from(bytes).toString('base64url'));
    assert.deepEqual(fromBase64Url(toBase64Url(bytes)), bytes);
});
