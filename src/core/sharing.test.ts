import assert from 'node:assert/strict';
import test from 'node:test';
import { APP_URL, inviteTokenFromHash, inviteUrl, plantInviteUrl, plantTokenFromHash, shownAvatar } from './sharing';

const TOKEN = '3f2c9a1e-5b7d-4c8e-9f10-2a3b4c5d6e7f';

test('an invite link round-trips through the hash', () => {
    const url = new URL(inviteUrl(TOKEN));
    assert.equal(url.origin + url.pathname, APP_URL);
    assert.equal(inviteTokenFromHash(url.hash), TOKEN);
});

test('only a well-formed uuid is taken from the hash', () => {
    assert.equal(inviteTokenFromHash(''), null);
    assert.equal(inviteTokenFromHash('#join='), null);
    assert.equal(inviteTokenFromHash('#join=not-a-token'), null);
    assert.equal(inviteTokenFromHash(`#join=${TOKEN}x`), null);
    assert.equal(inviteTokenFromHash(`#other=1&join=${TOKEN}`), TOKEN);
    assert.equal(inviteTokenFromHash(`#join=${TOKEN.toUpperCase()}`), TOKEN);
});

test('a plant link is its own kind of link', () => {
    const url = new URL(plantInviteUrl(TOKEN));
    assert.equal(plantTokenFromHash(url.hash), TOKEN);
    assert.equal(inviteTokenFromHash(url.hash), null);
    assert.equal(plantTokenFromHash(`#join=${TOKEN}`), null);
});

test('a profile shows its drawing, else its seed, else the fallback', () => {
    const drawing = `d1:3${'0'.repeat(49)}`;
    assert.equal(shownAvatar({ display_name: 'a', avatar_seed: 'seed', avatar_drawing: drawing }, TOKEN), drawing);
    assert.equal(shownAvatar({ display_name: 'a', avatar_seed: 'seed', avatar_drawing: null }, TOKEN), 'seed');
    // Before migration 0011 there is no drawing column at all; before 0009 no seed.
    assert.equal(shownAvatar({ display_name: 'a', avatar_seed: 'seed' }, TOKEN), 'seed');
    assert.equal(shownAvatar({ display_name: 'a' }, TOKEN), TOKEN);
    assert.equal(shownAvatar(null, TOKEN), TOKEN);
    // Something that only looks like a drawing is passed over.
    assert.equal(shownAvatar({ display_name: 'a', avatar_seed: 'seed', avatar_drawing: 'd1:<svg>' }, TOKEN), 'seed');
});
