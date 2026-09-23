import assert from 'node:assert/strict';
import test from 'node:test';
import { badgeText, base64UrlBytes, cellHash, cellTargetFromHash, isIos, pushState, timeAgo, vapidKeyBytes, type PushEnv } from './notify-core';
import { inviteTokenFromHash, plantTokenFromHash } from './sharing';

const GARDEN = '3f2c9a1e-5b7d-4c8e-9f10-2a3b4c5d6e7f';
const PLANT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

test('a cell address round-trips, the garden and the shared plant too', () => {
    const target = { itemId: 'item_1695000000000_0', projectId: 'proj_1695', gardenId: GARDEN, plantId: PLANT };
    const hash = cellHash(target);
    assert.equal(hash, `#cell=item_1695000000000_0&project=proj_1695&garden=${GARDEN}&sharedPlant=${PLANT}`);
    assert.deepEqual(cellTargetFromHash(hash), target);
    assert.deepEqual(cellTargetFromHash('#cell=i&project=p'), { itemId: 'i', projectId: 'p' });
});

test('ids with spaces and symbols (a vault file named them) survive the address', () => {
    const target = { itemId: 'item 1 & 2 #x', projectId: 'unknown_42_ä=b' };
    assert.deepEqual(cellTargetFromHash(cellHash(target)), target);
});

test('a cell address is never taken for an invite link, nor an invite for a cell', () => {
    const hash = cellHash({ itemId: 'i', projectId: 'p', gardenId: GARDEN, plantId: PLANT });
    assert.equal(inviteTokenFromHash(hash), null);
    assert.equal(plantTokenFromHash(hash), null);
    assert.equal(cellTargetFromHash(`#join=${GARDEN}`), null);
    assert.equal(cellTargetFromHash(`#plant=${PLANT}`), null);
});

test('a broken cell address opens nothing', () => {
    for (const hash of ['', '#', '#cell=', '#cell=i', '#project=p&cell=i', '#cell=i&project=p&garden=nope', '#cell=i&project=p&sharedPlant=1',
        `#cell=${'x'.repeat(201)}&project=p`, '#cell=a%00b&project=p']) {
        assert.equal(cellTargetFromHash(hash), null, hash);
    }
});

test('how long ago, shortly', () => {
    const now = new Date('2026-09-23T12:00:00Z');
    const ago = (ms: number) => timeAgo(new Date(now.getTime() - ms), now);
    assert.equal(ago(10_000), 'now');
    assert.equal(ago(5 * 60_000), '5m');
    assert.equal(ago(3 * 3600_000), '3h');
    assert.equal(ago(2 * 86400_000), '2d');
    assert.notEqual(ago(30 * 86400_000), '30d');
    assert.equal(timeAgo(new Date('nonsense'), now), '');
});

test('the badge count', () => {
    assert.equal(badgeText(0), '');
    assert.equal(badgeText(3), '3');
    assert.equal(badgeText(12), '9+');
});

const env = (patch: Partial<PushEnv>): PushEnv => ({ ios: false, standalone: false, supported: true, permission: 'default', subscribed: false, ...patch });

test('the notifications setting on an iPhone: in Safari, add to the Home Screen first; there, turn on', () => {
    // Safari on iOS hides the Push API outside a Home Screen app; either way it says the same.
    assert.equal(pushState(env({ ios: true, supported: false })), 'install');
    assert.equal(pushState(env({ ios: true, supported: true })), 'install');
    assert.equal(pushState(env({ ios: true, standalone: true })), 'off');
    assert.equal(pushState(env({ ios: true, standalone: true, supported: false })), 'update');
    assert.equal(pushState(env({ ios: true, standalone: true, permission: 'granted', subscribed: true })), 'on');
    assert.equal(pushState(env({ ios: true, standalone: true, permission: 'denied' })), 'denied');
});

test('the notifications setting elsewhere', () => {
    assert.equal(pushState(env({ supported: false })), 'unsupported');
    assert.equal(pushState(env({})), 'off');
    assert.equal(pushState(env({ permission: 'granted' })), 'off', 'allowed for the site, not yet for this account');
    assert.equal(pushState(env({ permission: 'granted', subscribed: true })), 'on');
    assert.equal(pushState(env({ permission: 'denied' })), 'denied');
});

test('iPhones and iPads, also the iPad that says it is a Mac', () => {
    assert.equal(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'), true);
    assert.equal(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 5), true);
    assert.equal(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 0), false);
    assert.equal(isIos('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36', 5), false);
});

test('the VAPID public key: 65 bytes, uncompressed; a private key or junk is refused', () => {
    const point = new Uint8Array(65);
    point[0] = 4;
    point.fill(7, 1);
    const text = Buffer.from(point).toString('base64url');
    assert.deepEqual(vapidKeyBytes(text), point);
    assert.equal(vapidKeyBytes(Buffer.from(new Uint8Array(32)).toString('base64url')), null);
    assert.equal(vapidKeyBytes('not base64 !'), null);
    assert.equal(vapidKeyBytes(''), null);
    assert.deepEqual(base64UrlBytes('AQID'), new Uint8Array([1, 2, 3]));
    assert.deepEqual(base64UrlBytes('_-8='), new Uint8Array([255, 239]));
});
