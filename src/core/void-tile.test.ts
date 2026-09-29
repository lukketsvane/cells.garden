import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('the original void tile stays a native 32-square PNG without requiring transparency', () => {
    const png = readFileSync(new URL('../assets/void_tile.png', import.meta.url));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), 32);
    assert.equal(png.readUInt32BE(20), 32);
    assert([0, 2, 3, 4, 6].includes(png[25]), 'opaque and transparent PNG artwork are both valid');
});

test('the void repeats the original colours instead of reducing the artwork to an alpha mask', () => {
    const css = readFileSync(new URL('./void-tile.css', import.meta.url), 'utf8');
    assert.match(css, /background-image:\s*url\(['"]\.\.\/assets\/void_tile\.png['"]\)/);
    assert.match(css, /background-size:\s*32px 32px/);
    assert.match(css, /background-repeat:\s*repeat/);
    assert.doesNotMatch(css, /(?:-webkit-)?mask-image\s*:/);
});
