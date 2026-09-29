import assert from 'node:assert/strict';
import test from 'node:test';
import { gardenPath, parseRoute, userPath } from './routes';

const ID = '3f2c9a1e-5b7d-4c8e-9f10-2a3b4c5d6e7f';

test('garden and profile addresses support reloads, trailing slashes, and uppercase UUIDs', () => {
    assert.deepEqual(parseRoute(gardenPath(ID)), { kind: 'garden', id: ID });
    assert.deepEqual(parseRoute(userPath(ID.toUpperCase()) + '/'), { kind: 'user', id: ID });
    assert.deepEqual(parseRoute('/garden/local'), { kind: 'garden', id: 'local' });
    for (const kind of ['about', 'tutorial']) assert.deepEqual(parseRoute(`/${kind}/`), { kind });
});

test('unknown paths and malformed IDs are not interpreted as garden or invite access', () => {
    for (const path of ['/unknown', '/invite/nope', '/user/local', `/garden/${ID}/extra`, '/garden/%E0%A4%A', '/invite/plant', `/invite/garden/${ID}`]) {
        assert.deepEqual(parseRoute(path), { kind: 'missing' }, path);
    }
});
