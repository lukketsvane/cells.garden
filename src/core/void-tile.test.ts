import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('the shared void tile stays a native 32-square PNG with an alpha channel', () => {
    const png = readFileSync(new URL('../assets/void_tile.png', import.meta.url));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), 32);
    assert.equal(png.readUInt32BE(20), 32);
    assert([4, 6].includes(png[25]), 'the CSS mask requires an alpha channel');
});
