/**
 * Profile pictures as pixels, with no DOM, so the tests can run them. A picture
 * is either generated from a seed (every account has one) or drawn by its owner
 * in the editor (avatar-editor.ts). Both are 7 by 7 pixels inside a circle 9
 * pixels across, so a generated picture can be turned into a drawing to start
 * from, and drawn and generated pictures sit side by side at the same scale.
 *
 * A drawing travels as a short string, "d1:" and 50 hex digits: the background,
 * then the 49 pixels row by row. Each digit picks a colour from PALETTE below,
 * never a colour of its own, so nothing a person saves ever reaches the SVG
 * markup; anything that is not exactly this shape is treated as a seed.
 */

/** The size of the picture in pixels, inside a one-pixel ring of background. */
export const GRID = 7;
const CELLS = GRID * GRID;
const VIEW = GRID + 2;

/**
 * The only shape a drawing may have. Shared with the check constraint in
 * supabase/migrations/0011_avatar_drawing.sql, which must say exactly this
 * (scripts/test-security.mjs compares them): version 1, a background from 1 to
 * f, then 49 pixels from 0 (empty, the background shows) to f.
 */
export const DRAWING_FORMAT = /^d1:[1-9a-f][0-9a-f]{49}$/;
export const DRAWING_LENGTH = 53;

/**
 * The drawing palette, in the garden's colours: four darks for backgrounds and
 * outlines, six mid tones and five lights, spread round the colour wheel so a
 * generated picture of any hue converts to something close. A drawing stores
 * indices into this list, so an entry may be retuned but never moved.
 * Index 0 is no colour: an empty pixel.
 */
export const PALETTE: readonly { name: string; hex: string }[] = [
    { name: 'Empty', hex: '' },
    { name: 'Soil', hex: '#4b2d27' },
    { name: 'Moss', hex: '#2a4722' },
    { name: 'Deep', hex: '#173746' },
    { name: 'Dusk', hex: '#3a2552' },
    { name: 'Rose', hex: '#c4616e' },
    { name: 'Wheat', hex: '#bfa655' },
    { name: 'Leaf', hex: '#86b04a' },
    { name: 'Pond', hex: '#52a3a8' },
    { name: 'Cornflower', hex: '#3b77dc' },
    { name: 'Heather', hex: '#ad78bd' },
    { name: 'Peach', hex: '#e6b097' },
    { name: 'Sun', hex: '#e8d36c' },
    { name: 'Mint', hex: '#6ee39a' },
    { name: 'Sky', hex: '#8ccbe0' },
    { name: 'Petal', hex: '#f5f1e3' },
];

/** A drawing: the background colour (1 to 15) and 49 pixels, row by row (0 is empty). */
export interface Drawing {
    bg: number;
    cells: number[];
}

const isIndex = (n: unknown, min: number): n is number => Number.isInteger(n) && (n as number) >= min && (n as number) < PALETTE.length;

/** The drawing as its stored string. Throws on anything that is not a drawing, rather than saving a wrong one. */
export function encodeDrawing(drawing: Drawing): string {
    const { bg, cells } = drawing;
    if (!isIndex(bg, 1) || cells.length !== CELLS || !cells.every(c => isIndex(c, 0))) {
        throw new RangeError('Not a drawing');
    }
    return `d1:${bg.toString(16)}${cells.map(c => c.toString(16)).join('')}`;
}

/** True when `text` is a drawing in exactly the stored format. */
export function isDrawing(text: unknown): text is string {
    return typeof text === 'string' && text.length === DRAWING_LENGTH && DRAWING_FORMAT.test(text);
}

/** The drawing a stored string holds, or null for anything else (a seed, or junk). */
export function decodeDrawing(text: unknown): Drawing | null {
    if (!isDrawing(text)) return null;
    const digits = Array.from(text.slice(3), d => parseInt(d, 16));
    return { bg: digits[0], cells: digits.slice(1) };
}

/** True when every row reads the same from either side, as generated pictures do. */
export function isMirrored(cells: readonly number[]): boolean {
    for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID / 2; x++) {
            if (cells[y * GRID + x] !== cells[y * GRID + GRID - 1 - x]) return false;
        }
    }
    return true;
}

// --- Generated pictures --------------------------------------------------------

/** A string to a 32-bit seed (FNV-1a). */
function hash(text: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** A small deterministic generator (mulberry32). */
function generator(seed: number) {
    let a = seed;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A generated picture: two hues and its pixels, in the order they were drawn. */
interface Generated {
    hue: number;
    accent: number;
    /** 1 is the body colour, 2 the highlight. */
    pixels: { x: number; y: number; tone: 1 | 2 }[];
}

/**
 * The picture a seed makes. The draws from the generator happen in the same
 * order as they always have, so nobody's picture changes.
 */
function generate(seed: string): Generated {
    const rand = generator(hash(seed || 'someone'));
    const hue = Math.floor(rand() * 360);
    const accent = (hue + 40 + Math.floor(rand() * 80)) % 360;

    const pixels: Generated['pixels'] = [];
    const half = Math.ceil(GRID / 2);
    for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < half; x++) {
            const r = rand();
            // Denser toward the middle, so the shape reads as one thing in a circle.
            const centre = 1 - (Math.abs(x - (half - 1)) + Math.abs(y - (GRID - 1) / 2)) / GRID;
            if (r > 0.25 + (1 - centre) * 0.55) continue;
            const tone = rand() < 0.18 ? 2 : 1;
            for (const cx of x === GRID - 1 - x ? [x] : [x, GRID - 1 - x]) pixels.push({ x: cx, y, tone });
        }
    }
    return { hue, accent, pixels };
}

type Hsl = [number, number, number];

/** The three colours of a generated picture, as hue, saturation and lightness. */
function tones(g: Generated): { bg: Hsl; body: Hsl; highlight: Hsl } {
    return { bg: [g.hue, 35, 22], body: [g.hue, 55, 62], highlight: [g.accent, 70, 72] };
}

// --- From a seed to a drawing ----------------------------------------------------

type Rgb = [number, number, number];

function hslToRgb([h, s, l]: Hsl): Rgb {
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const f = (n: number) => {
        const k = (n + h / 30) % 12;
        return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [f(0), f(8), f(4)];
}

const hexToRgb = (hex: string): Rgb => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as Rgb;

/** How far apart two colours look, roughly ("redmean"). */
function distance(a: Rgb, b: Rgb): number {
    const r = (a[0] + b[0]) / 2;
    const [dr, dg, db] = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    return (2 + r / 256) * dr * dr + 4 * dg * dg + (2 + (255 - r) / 256) * db * db;
}

/** The palette colour closest to `rgb`, other than the ones already taken. */
function nearest(rgb: Rgb, taken: number[] = []): number {
    let best = 1;
    let bestDistance = Infinity;
    for (let i = 1; i < PALETTE.length; i++) {
        if (taken.includes(i)) continue;
        const d = distance(rgb, hexToRgb(PALETTE[i].hex));
        if (d < bestDistance) [best, bestDistance] = [i, d];
    }
    return best;
}

/**
 * The generated picture of `seed` as a drawing, to start the editor from: the
 * same pixels, each of its three colours moved to the nearest one in the
 * palette, and never two of them onto the same one.
 */
export function fromSeed(seed: string): Drawing {
    const g = generate(seed);
    const t = tones(g);
    const bg = nearest(hslToRgb(t.bg));
    const body = nearest(hslToRgb(t.body), [bg]);
    const highlight = nearest(hslToRgb(t.highlight), [bg, body]);
    const cells = new Array<number>(CELLS).fill(0);
    for (const p of g.pixels) cells[p.y * GRID + p.x] = p.tone === 2 ? highlight : body;
    return { bg, cells };
}

// --- SVG ---------------------------------------------------------------------------

/** The picture's frame: a circle holding the background and the pixels, `size` pixels across. */
function frame(size: number, bg: string, pixels: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW} ${VIEW}" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true">`
        + `<clipPath id="a"><circle cx="${VIEW / 2}" cy="${VIEW / 2}" r="${VIEW / 2}"/></clipPath>`
        + `<g clip-path="url(#a)"><rect width="${VIEW}" height="${VIEW}" fill="${bg}"/>${pixels}</g></svg>`;
}

const pixel = (x: number, y: number, fill: string) => `<rect x="${x + 1}" y="${y + 1}" width="1" height="1" fill="${fill}"/>`;

function generatedSvg(seed: string, size: number): string {
    const g = generate(seed);
    const colour = ([h, s, l]: Hsl) => `hsl(${h} ${s}% ${l}%)`;
    const t = tones(g);
    const fills = { 1: colour(t.body), 2: colour(t.highlight) };
    return frame(size, colour(t.bg), g.pixels.map(p => pixel(p.x, p.y, fills[p.tone])).join(''));
}

function drawingSvg(drawing: Drawing, size: number): string {
    const pixels = drawing.cells
        .map((c, i) => (c ? pixel(i % GRID, Math.floor(i / GRID), PALETTE[c].hex) : ''))
        .join('');
    return frame(size, PALETTE[drawing.bg].hex, pixels);
}

/**
 * A profile picture as an SVG string, `size` pixels across: the drawing when
 * `avatar` is one, else the picture generated from it as a seed. Only numbers
 * and palette colours go into the markup, never the text itself.
 */
export function avatarSvg(avatar: string, size = 24): string {
    const px = Number.isFinite(size) ? Math.max(1, Math.round(size)) : 24;
    const drawing = decodeDrawing(avatar);
    return drawing ? drawingSvg(drawing, px) : generatedSvg(avatar, px);
}
