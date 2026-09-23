import assert from 'node:assert/strict';
import test from 'node:test';
import { ZONE_ICONS } from './icons';

test('every zone icon is crisp pixel art on the same 12-square', () => {
    for (const [zone, svg] of Object.entries(ZONE_ICONS)) {
        assert.match(svg, /viewBox="0 0 12 12"/, zone);
        assert.match(svg, /shape-rendering="crispEdges"/, zone);
        assert.match(svg, /fill="currentColor"/, zone);
        assert.doesNotMatch(svg, /stroke/, zone);
    }
});

test('every pixel of a zone icon is a whole square inside its grid', () => {
    for (const [zone, svg] of Object.entries(ZONE_ICONS)) {
        const d = /<path d="([^"]+)"/.exec(svg)?.[1] ?? '';
        const runs = [...d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)];
        assert.ok(runs.length > 0, `${zone} draws nothing`);
        assert.equal(runs.map((r) => r[0]).join(''), d, `${zone} has path commands that are not pixel runs`);
        for (const [, x, y, w, back] of runs) {
            assert.equal(w, back, zone);
            assert.ok(Number(x) + Number(w) <= 12 && Number(y) < 12, `${zone} spills out of its grid at ${x},${y}`);
        }
    }
});
