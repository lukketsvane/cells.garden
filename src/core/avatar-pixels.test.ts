import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
    avatarSvg,
    decodeDrawing,
    DRAWING_FORMAT,
    DRAWING_LENGTH,
    encodeDrawing,
    DRAWING_FORMAT_12,
    DRAWING_LENGTH_12,
    fromSeed,
    GRID,
    GRID_12,
    isDrawing,
    isMirrored,
    PALETTE,
    PALETTE_12,
    PICTURE_GRID,
    toTwelve,
    type Drawing,
} from './avatar-pixels';

/** A small deterministic generator, so a failure names a drawing that can be rebuilt. */
function random(seed: number) {
    let a = seed;
    return (n: number) => {
        a = (Math.imul(a, 1103515245) + 12345) >>> 0;
        return a % n;
    };
}

function randomDrawing(pick: (n: number) => number): Drawing {
    return { bg: 1 + pick(15), cells: Array.from({ length: GRID * GRID }, () => pick(16)) };
}

/** The pixels of an avatar SVG: the background and every 1 by 1 rect, as "x,y" to fill. */
function pixelsOf(svg: string): { bg: string; pixels: Map<string, string> } {
    const bg = /<rect width="9" height="9" fill="([^"]+)"\/>/.exec(svg)?.[1] ?? '';
    const pixels = new Map<string, string>();
    for (const m of svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="1" height="1" fill="([^"]+)"\/>/g)) {
        pixels.set(`${Number(m[1]) - 1},${Number(m[2]) - 1}`, m[3]);
    }
    return { bg, pixels };
}

/** Every attribute value in the SVG is one the code writes: numbers, palette or hsl colours, fixed words. */
function onlyOwnMarkup(svg: string) {
    const stripped = svg
        .replace(/<rect x="\d+" y="\d+" width="1" height="1" fill="(?:#[0-9a-f]{6}|hsl\(\d+ \d+% \d+%\))"\/>/g, '')
        .replace(/<rect width="9" height="9" fill="(?:#[0-9a-f]{6}|hsl\(\d+ \d+% \d+%\))"\/>/g, '');
    assert.match(stripped, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 9 9" width="\d+" height="\d+" shape-rendering="crispEdges" aria-hidden="true"><clipPath id="a"><circle cx="4\.5" cy="4\.5" r="4\.5"\/><\/clipPath><g clip-path="url\(#a\)"><\/g><\/svg>$/);
}

test('the palette has an empty slot and fifteen distinct colours', () => {
    assert.equal(PALETTE.length, 16);
    assert.equal(PALETTE[0].hex, '');
    const colours = PALETTE.slice(1).map(c => c.hex);
    for (const hex of colours) assert.match(hex, /^#[0-9a-f]{6}$/);
    assert.equal(new Set(colours).size, 15);
});

test('a drawing round-trips through its string', () => {
    const pick = random(7);
    for (let n = 0; n < 500; n++) {
        const drawing = randomDrawing(pick);
        const text = encodeDrawing(drawing);
        assert.equal(text.length, DRAWING_LENGTH);
        assert.match(text, DRAWING_FORMAT);
        assert.deepEqual(decodeDrawing(text), drawing);
        assert.equal(encodeDrawing(decodeDrawing(text) as Drawing), text);
    }
});

test('encoding refuses what is not a drawing', () => {
    const cells = new Array<number>(GRID * GRID).fill(0);
    assert.throws(() => encodeDrawing({ bg: 0, cells }), RangeError);
    assert.throws(() => encodeDrawing({ bg: 16, cells }), RangeError);
    assert.throws(() => encodeDrawing({ bg: 1.5, cells }), RangeError);
    assert.throws(() => encodeDrawing({ bg: 1, cells: cells.slice(1) }), RangeError);
    assert.throws(() => encodeDrawing({ bg: 1, cells: [...cells.slice(1), 16] }), RangeError);
    assert.throws(() => encodeDrawing({ bg: 1, cells: [...cells.slice(1), -1] }), RangeError);
});

test('decoding is strict: only the exact format is a drawing', () => {
    const good = encodeDrawing({ bg: 3, cells: Array.from({ length: GRID * GRID }, (_, i) => i % 16) });
    assert.ok(isDrawing(good));
    const bad: unknown[] = [
        '',
        'd1:',
        good.slice(0, -1), // one pixel short
        `${good}0`, // one too many
        good.replace('d1:', 'd2:'), // another version
        good.replace('d1:', 'D1:'),
        good.replace('d1:', 'd1'),
        `d1:0${good.slice(4)}`, // no background
        good.toUpperCase(),
        `${good.slice(0, -1)}g`, // not hex
        `${good.slice(0, -1)}\n`,
        ` ${good.slice(1)}`,
        `${good.slice(0, 20)}"/><script>alert(1)</script>`.padEnd(DRAWING_LENGTH, '0').slice(0, DRAWING_LENGTH),
        `d1:1<rect fill="url(javascript:alert(1))"/>`.padEnd(DRAWING_LENGTH, 'a'),
        `d1:${'f'.repeat(1_000_000)}`,
        'x'.repeat(1_000_000),
        '3f2c9a1e5b7d4c8e',
        null,
        undefined,
        53,
        { toString: () => good },
        [good],
    ];
    for (const text of bad) {
        assert.equal(isDrawing(text), false, `accepted ${String(text).slice(0, 60)}`);
        assert.equal(decodeDrawing(text), null);
    }
});

test('the generated pictures are the same as before drawings existed', () => {
    // Captured from avatar.ts before it learned to draw. A change here is a
    // change of everyone's picture.
    assert.equal(
        avatarSvg('garden', 24),
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9" width="24" height="24" shape-rendering="crispEdges" aria-hidden="true"><clipPath id="a"><circle cx="4.5" cy="4.5" r="4.5"/></clipPath><g clip-path="url(#a)"><rect width="9" height="9" fill="hsl(337 35% 22%)"/><rect x="4" y="1" width="1" height="1" fill="hsl(83 70% 72%)"/><rect x="1" y="2" width="1" height="1" fill="hsl(337 55% 62%)"/><rect x="7" y="2" width="1" height="1" fill="hsl(337 55% 62%)"/><rect x="3" y="2" width="1" height="1" fill="hsl(337 55% 62%)"/><rect x="5" y="2" width="1" height="1" fill="hsl(337 55% 62%)"/><rect x="4" y="2" width="1" height="1" fill="hsl(337 55% 62%)"/><rect x="2" y="3" width="1" height="1" fill="hsl(337 55% 62%)"/><rect x="6" y="3" width="1" height="1" fill="hsl(337 55% 62%)"/><rect x="3" y="3" width="1" height="1" fill="hsl(83 70% 72%)"/><rect x="5" y="3" width="1" height="1" fill="hsl(83 70% 72%)"/><rect x="1" y="5" width="1" height="1" fill="hsl(337 55% 62%)"/><rect x="7" y="5" width="1" height="1" fill="hsl(337 55% 62%)"/><rect x="2" y="5" width="1" height="1" fill="hsl(337 55% 62%)"/><rect x="6" y="5" width="1" height="1" fill="hsl(337 55% 62%)"/><rect x="2" y="6" width="1" height="1" fill="hsl(337 55% 62%)"/><rect x="6" y="6" width="1" height="1" fill="hsl(337 55% 62%)"/><rect x="4" y="6" width="1" height="1" fill="hsl(337 55% 62%)"/><rect x="1" y="7" width="1" height="1" fill="hsl(337 55% 62%)"/><rect x="7" y="7" width="1" height="1" fill="hsl(337 55% 62%)"/><rect x="2" y="7" width="1" height="1" fill="hsl(337 55% 62%)"/><rect x="6" y="7" width="1" height="1" fill="hsl(337 55% 62%)"/></g></svg>',
    );
    const all: string[] = [];
    for (let i = 0; i < 200; i++) all.push(avatarSvg(`seed-${i}`, 24));
    all.push(avatarSvg('', 48));
    all.push(avatarSvg('3f2c9a1e-5b7d-4c8e-9f10-2a3b4c5d6e7f', 18));
    assert.equal(createHash('sha256').update(all.join('\n')).digest('hex'), 'd3e3d53401dbf73a4dfe9f6166b432ecb386593ddd7ed0912822588b3019bee0');
});

test('fromSeed is the generated picture, pixel for pixel, in palette colours', () => {
    for (let i = 0; i < 300; i++) {
        const seed = `seed-${i}`;
        const generated = pixelsOf(avatarSvg(seed));
        const drawing = fromSeed(seed);
        assert.ok(isDrawing(encodeDrawing(drawing)));

        const drawn = new Map<string, number>();
        drawing.cells.forEach((c, j) => { if (c) drawn.set(`${j % GRID},${Math.floor(j / GRID)}`, c); });
        assert.deepEqual([...drawn.keys()].sort(), [...generated.pixels.keys()].sort(), seed);

        // Pixels of one colour stay one colour, two colours stay two, and none turns into the background.
        const byFill = new Map<string, number>();
        for (const [at, fill] of generated.pixels) {
            const index = drawn.get(at) as number;
            assert.notEqual(index, drawing.bg, seed);
            if (!byFill.has(fill)) byFill.set(fill, index);
            assert.equal(byFill.get(fill), index, seed);
        }
        assert.equal(new Set(byFill.values()).size, byFill.size, seed);
        assert.ok(isMirrored(drawing.cells), seed);
    }
});

test('a drawing is drawn in palette colours only', () => {
    const pick = random(11);
    for (let n = 0; n < 100; n++) {
        const drawing = randomDrawing(pick);
        const svg = avatarSvg(encodeDrawing(drawing), 48);
        onlyOwnMarkup(svg);
        const { bg, pixels } = pixelsOf(svg);
        assert.equal(bg, PALETTE[drawing.bg].hex);
        assert.equal(pixels.size, drawing.cells.filter(Boolean).length);
        drawing.cells.forEach((c, j) => {
            const fill = pixels.get(`${j % GRID},${Math.floor(j / GRID)}`);
            assert.equal(fill, c ? PALETTE[c].hex : undefined);
        });
    }
});

test('the SVG never carries the text it was given', () => {
    const hostile = [
        '"/><script>alert(1)</script>',
        "'><img src=x onerror=alert(1)>",
        '<svg onload=alert(1)>',
        'd1:1<rect fill="url(javascript:alert(1))"/>',
        `d1:g${'0'.repeat(49)}`,
        ']]><!--',
        '&lt;&amp;',
        'x'.repeat(100_000),
        '',
    ];
    for (const text of hostile) {
        const svg = avatarSvg(text, 24);
        onlyOwnMarkup(svg);
        if (text.length > 2) assert.ok(!svg.includes(text), text.slice(0, 40));
    }
    // A size that is not a number never reaches the markup either.
    onlyOwnMarkup(avatarSvg('garden', Number.NaN));
    onlyOwnMarkup(avatarSvg('garden', 20.4));
});

test('mirroring is read row by row', () => {
    const cells = new Array<number>(GRID * GRID).fill(0);
    assert.ok(isMirrored(cells));
    cells[0] = 5;
    assert.ok(!isMirrored(cells));
    cells[GRID - 1] = 5;
    assert.ok(isMirrored(cells));
    cells[3] = 9; // the middle column mirrors onto itself
    assert.ok(isMirrored(cells));
});

// --- The 12 by 12 pictures being tried out --------------------------------------

/** The markup of a 12 by 12 picture: as onlyOwnMarkup, on its 14-square. */
function onlyOwnMarkup12(svg: string) {
    const stripped = svg
        .replace(/<rect x="\d+" y="\d+" width="1" height="1" fill="#[0-9a-f]{6}"\/>/g, '')
        .replace(/<rect width="14" height="14" fill="#[0-9a-f]{6}"\/>/g, '');
    assert.match(stripped, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 14 14" width="\d+" height="\d+" shape-rendering="crispEdges" aria-hidden="true"><clipPath id="a"><circle cx="7" cy="7" r="7"\/><\/clipPath><g clip-path="url\(#a\)"><\/g><\/svg>$/);
}

test('only a build trying them out makes pictures 12 by 12; releases stay 7 by 7', () => {
    assert.equal(PICTURE_GRID, GRID);
    assert.equal(fromSeed('garden').cells.length, GRID * GRID);
});

test('the palette being tried has an empty slot and fifteen distinct colours of its own', () => {
    assert.equal(PALETTE_12.length, 16);
    assert.equal(PALETTE_12[0].hex, '');
    const colours = PALETTE_12.slice(1).map(c => c.hex);
    for (const hex of colours) assert.match(hex, /^#[0-9a-f]{6}$/);
    assert.equal(new Set(colours).size, 15);
});

test('a 12 by 12 drawing round-trips through its string, and only its exact format is one', () => {
    const pick = random(12);
    for (let n = 0; n < 200; n++) {
        const drawing = { bg: 1 + pick(15), cells: Array.from({ length: GRID_12 * GRID_12 }, () => pick(16)) };
        const text = encodeDrawing(drawing);
        assert.equal(text.length, DRAWING_LENGTH_12);
        assert.match(text, DRAWING_FORMAT_12);
        assert.deepEqual(decodeDrawing(text), drawing);
    }
    const good = encodeDrawing({ bg: 2, cells: Array.from({ length: GRID_12 * GRID_12 }, (_, i) => i % 16) });
    for (const text of [good.slice(0, -1), `${good}0`, good.replace('d2:', 'd1:'), `d2:0${good.slice(4)}`, good.toUpperCase(), `${good.slice(0, -1)}g`]) {
        assert.equal(isDrawing(text), false, text.slice(0, 12));
        assert.equal(decodeDrawing(text), null);
    }
    assert.throws(() => encodeDrawing({ bg: 1, cells: new Array<number>(100).fill(0) }), RangeError);
});

test('a seed\'s 12 by 12 picture is mirrored, in the new palette, and never shows its own markup', () => {
    for (let i = 0; i < 100; i++) {
        const drawing = fromSeed(`seed-${i}`, GRID_12);
        assert.equal(drawing.cells.length, GRID_12 * GRID_12);
        assert.ok(isMirrored(drawing.cells));
        assert.ok(drawing.cells.some(Boolean), 'a picture with nothing in it');
        assert.ok(drawing.cells.every(c => c !== drawing.bg), 'a pixel in the background colour');
        const svg = avatarSvg(`seed-${i}`, 24, GRID_12);
        onlyOwnMarkup12(svg);
        assert.ok(svg.includes(`fill="${PALETTE_12[drawing.bg].hex}"`));
    }
    onlyOwnMarkup12(avatarSvg('"/><script>alert(1)</script>', 24, GRID_12));
});

test('a 7 by 7 drawing is drawn in its own palette wherever it turns up, and a 12 by 12 in the new one', () => {
    const seven = encodeDrawing(fromSeed('garden', GRID));
    assert.match(avatarSvg(seven, 24, GRID_12), /viewBox="0 0 9 9"/);
    const twelve = encodeDrawing(fromSeed('garden', GRID_12));
    const svg = avatarSvg(twelve, 24, GRID);
    onlyOwnMarkup12(svg);
});

test('a 7 by 7 drawing grows to 12 by 12 with its pixels where they were, still mirrored', () => {
    for (let i = 0; i < 100; i++) {
        const seven = fromSeed(`seed-${i}`, GRID);
        const twelve = toTwelve(seven);
        assert.equal(twelve.cells.length, GRID_12 * GRID_12);
        assert.ok(isMirrored(twelve.cells));
        assert.ok(twelve.cells.every(c => c !== twelve.bg));
        // Every pixel of the seven is there, and nothing that was empty is filled.
        const map = [0, 0, 1, 1, 2, 3, 3, 4, 5, 5, 6, 6];
        twelve.cells.forEach((c, j) => {
            const from = seven.cells[map[Math.floor(j / GRID_12)] * GRID + map[j % GRID_12]];
            assert.equal(!!c, !!from);
        });
        assert.ok(isDrawing(encodeDrawing(twelve)));
    }
    const already = fromSeed('garden', GRID_12);
    assert.equal(toTwelve(already), already);
});
