import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Garden } from './model';
import { APP_URL, createSpace, inviteTokenFromHash, inviteUrl, plantInviteUrl, plantTokenFromHash, shownAvatar } from './sharing';
import { parseRoute } from './routes';

const TOKEN = '3f2c9a1e-5b7d-4c8e-9f10-2a3b4c5d6e7f';

test('each new garden space is created with its own original 40-cell tutorial', async () => {
    type Row = { owner_id: string; user_id: null; name: string; data: Garden; updated_at: string };
    const inserted: Row[] = [];
    const client = {
        from(table: string) {
            assert.equal(table, 'gardens');
            return {
                insert(row: Row) {
                    inserted.push(row);
                    return {
                        async select(fields: string) {
                            assert.equal(fields, 'id, name');
                            return { data: [{ id: `space-${inserted.length}`, name: row.name }], error: null };
                        },
                    };
                },
            };
        },
    } as unknown as SupabaseClient;
    for (const name of ['Home', 'Shared projects']) {
        assert.equal((await createSpace(client, 'owner', name)).name, name);
    }
    const ids = new Set<string>();
    for (const row of inserted) {
        assert.equal(row.owner_id, 'owner');
        assert.equal(row.user_id, null);
        assert.equal(row.data.updatedAt, row.updated_at);
        assert.equal(row.data.projects.length, 1);
        const plant = row.data.projects[0];
        assert.equal(plant.seed, 'Tutorial plant');
        assert.equal(plant.hue, 304);
        assert(!plant.sharedPlantId);
        const cells = [...plant.flowers, ...plant.stem, ...plant.roots, ...plant.minerals];
        assert.equal(cells.length, 39);
        assert.equal(plant.stem.length, 8);
        assert.equal(plant.flowers.length, 11);
        for (const id of [plant.id, ...cells.map(cell => cell.id)]) {
            assert(!ids.has(id), 'new gardens must not share plant or cell IDs');
            ids.add(id);
        }
        assert(cells.every(cell => cell.imagePath && cell.content && !cell.assignees));
    }
});

test('an invite link round-trips through its route', () => {
    const url = new URL(inviteUrl(TOKEN));
    assert.equal(url.origin + '/', APP_URL);
    assert.deepEqual(parseRoute(url.pathname), { kind: 'invite', target: 'garden', token: TOKEN });
});

test('only a well-formed uuid is taken from the hash', () => {
    assert.equal(inviteTokenFromHash(''), null);
    assert.equal(inviteTokenFromHash('#join='), null);
    assert.equal(inviteTokenFromHash('#join=not-a-token'), null);
    assert.equal(inviteTokenFromHash(`#join=${TOKEN}x`), null);
    assert.equal(inviteTokenFromHash(`#other=1&join=${TOKEN}`), TOKEN);
    assert.equal(inviteTokenFromHash(`#join=${TOKEN.toUpperCase()}`), TOKEN);
    assert.equal(inviteTokenFromHash('#join=%E0%A4%A'), null);
});

test('a plant link is its own kind of link', () => {
    const url = new URL(plantInviteUrl(TOKEN));
    assert.deepEqual(parseRoute(url.pathname), { kind: 'invite', target: 'plant', token: TOKEN });
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
