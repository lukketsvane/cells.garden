import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// zone-icons.ts imports these through the bundler; here they are read as files.
const ZONES = ['flowers', 'stem', 'roots', 'minerals'];

function png(zone: string): Buffer {
    return readFileSync(new URL(`../assets/pack/kanban_icons/${zone}_icon.png`, import.meta.url));
}

test('every zone icon is a PNG on the 9-square the board draws it at', () => {
    for (const zone of ZONES) {
        const b = png(zone);
        assert.equal(b.toString('latin1', 1, 4), 'PNG', zone);
        assert.equal(b.readUInt32BE(16), 9, `${zone} width`);
        assert.equal(b.readUInt32BE(20), 9, `${zone} height`);
    }
});

test('every zone icon carries an alpha channel, the only part a mask reads', () => {
    for (const zone of ZONES) {
        // Colour type 6 is RGBA, 4 is grey with alpha.
        assert.ok([4, 6].includes(png(zone)[25]), zone);
    }
});
