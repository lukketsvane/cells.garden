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
 *
 * Being tried out on dev.cells.garden (EXTRAS): pictures 12 by 12 in a new
 * palette, PALETTE_12. Such a drawing is "d2:" and 145 digits. Either kind is
 * drawn wherever it turns up, each in its own palette; a build trying the
 * twelves makes new pictures, generated or drawn, in them (PICTURE_GRID).
 */
import { EXTRAS } from './extras';

/** The size of the picture in pixels, inside a one-pixel ring of background. */
export const GRID = 7;
const CELLS = GRID * GRID;

/** The picture being tried out: 12 by 12. */
export const GRID_12 = 12;

/** The grid new pictures are made on: 12 on a build trying them out, else 7. */
export const PICTURE_GRID: 7 | 12 = EXTRAS ? GRID_12 : GRID;

/**
 * The only shape a drawing may have. Shared with the check constraint in
 * supabase/migrations/0011_avatar_drawing.sql, which must say exactly this
 * (scripts/test-security.mjs compares them): version 1, a background from 1 to
 * f, then 49 pixels from 0 (empty, the background shows) to f.
 */
export const DRAWING_FORMAT = /^d1:[1-9a-f][0-9a-f]{49}$/;
export const DRAWING_LENGTH = 53;

/** The 12 by 12 drawing: version 2, a background, then 144 pixels. Beside DRAWING_FORMAT in 0014_avatar_drawing_12.sql. */
export const DRAWING_FORMAT_12 = /^d2:[1-9a-f][0-9a-f]{144}$/;
export const DRAWING_LENGTH_12 = 148;

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

/**
 * The palette being tried out with the 12 by 12 pictures: Sweetie 16 by
 * GrafxKid, but for its dark slate (#333c57), which leaves the fifteen a
 * digit can pick. Brighter and wider than PALETTE, with warm and cold darks
 * for backgrounds. Swap the colours to try another; the order may change
 * until a drawing is kept in it for real.
 */
export const PALETTE_12: readonly { name: string; hex: string }[] = [
    { name: 'Empty', hex: '' },
    { name: 'Night', hex: '#1a1c2c' },
    { name: 'Plum', hex: '#5d275d' },
    { name: 'Berry', hex: '#b13e53' },
    { name: 'Ember', hex: '#ef7d57' },
    { name: 'Honey', hex: '#ffcd75' },
    { name: 'Lime', hex: '#a7f070' },
    { name: 'Fern', hex: '#38b764' },
    { name: 'Lagoon', hex: '#257179' },
    { name: 'Ink', hex: '#29366f' },
    { name: 'Cobalt', hex: '#3b5dc9' },
    { name: 'Sky', hex: '#41a6f6' },
    { name: 'Ice', hex: '#73eff7' },
    { name: 'Snow', hex: '#f4f4f4' },
    { name: 'Mist', hex: '#94b0c2' },
    { name: 'Slate', hex: '#566c86' },
];

/** The palette a drawing on `grid` is painted from. */
export function paletteFor(grid: number): readonly { name: string; hex: string }[] {
    return grid === GRID_12 ? PALETTE_12 : PALETTE;
}

/** The side of a drawing's grid, from its pixels. */
export function gridOf(cells: readonly number[]): number {
    return Math.round(Math.sqrt(cells.length));
}

/**
 * A drawing: the background colour (1 to 15) and its pixels, row by row (0 is
 * empty): 49 for 7 by 7, 144 for 12 by 12, each in its own palette.
 */
export interface Drawing {
    bg: number;
    cells: number[];
}

/** Both palettes hold sixteen entries, so a digit picks from either. */
const isIndex = (n: unknown, min: number): n is number => Number.isInteger(n) && (n as number) >= min && (n as number) < PALETTE.length;

/** The drawing as its stored string. Throws on anything that is not a drawing, rather than saving a wrong one. */
export function encodeDrawing(drawing: Drawing): string {
    const { bg, cells } = drawing;
    const version = cells.length === CELLS ? 1 : cells.length === GRID_12 * GRID_12 ? 2 : 0;
    if (!version || !isIndex(bg, 1) || !cells.every(c => isIndex(c, 0))) {
        throw new RangeError('Not a drawing');
    }
    return `d${version}:${bg.toString(16)}${cells.map(c => c.toString(16)).join('')}`;
}

/** True when `text` is a drawing in exactly one of the stored formats. */
export function isDrawing(text: unknown): text is string {
    if (typeof text !== 'string') return false;
    if (text.length === DRAWING_LENGTH) return DRAWING_FORMAT.test(text);
    return text.length === DRAWING_LENGTH_12 && DRAWING_FORMAT_12.test(text);
}

/** The drawing a stored string holds, or null for anything else (a seed, or junk). */
export function decodeDrawing(text: unknown): Drawing | null {
    if (!isDrawing(text)) return null;
    const digits = Array.from(text.slice(3), d => parseInt(d, 16));
    return { bg: digits[0], cells: digits.slice(1) };
}

/** True when every row reads the same from either side, as generated pictures do. */
export function isMirrored(cells: readonly number[]): boolean {
    const grid = gridOf(cells);
    for (let y = 0; y < grid; y++) {
        for (let x = 0; x < grid / 2; x++) {
            if (cells[y * grid + x] !== cells[y * grid + grid - 1 - x]) return false;
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
 * The picture a seed makes on `grid`. On 7 by 7 the draws from the generator
 * happen in the same order as they always have, so nobody's picture changes.
 */
function generate(seed: string, grid: number = GRID): Generated {
    const rand = generator(hash(seed || 'someone'));
    const hue = Math.floor(rand() * 360);
    const accent = (hue + 40 + Math.floor(rand() * 80)) % 360;

    const pixels: Generated['pixels'] = [];
    const half = Math.ceil(grid / 2);
    for (let y = 0; y < grid; y++) {
        for (let x = 0; x < half; x++) {
            const r = rand();
            // How near the middle the pixel is. The 12 by 12 keeps most there and
            // few at the rim, so its larger shape still reads as one thing in a
            // circle rather than a tile; the 7 by 7 keeps its own rule, as it was.
            const centre = 1 - (Math.abs(x - (half - 1)) + Math.abs(y - (grid - 1) / 2)) / grid;
            const keep = grid === GRID ? 0.25 + (1 - centre) * 0.55 : 1.3 * centre - 0.35;
            if (r > keep) continue;
            const tone = rand() < 0.18 ? 2 : 1;
            for (const cx of x === grid - 1 - x ? [x] : [x, grid - 1 - x]) pixels.push({ x: cx, y, tone });
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

/** The colour in `palette` closest to `rgb`, other than the ones already taken. */
function nearest(rgb: Rgb, taken: number[] = [], palette = PALETTE): number {
    let best = 1;
    let bestDistance = Infinity;
    for (let i = 1; i < palette.length; i++) {
        if (taken.includes(i)) continue;
        const d = distance(rgb, hexToRgb(palette[i].hex));
        if (d < bestDistance) [best, bestDistance] = [i, d];
    }
    return best;
}

/**
 * The generated picture of `seed` as a drawing, to start the editor from: the
 * same pixels, each of its three colours moved to the nearest one in the
 * palette, and never two of them onto the same one. On `grid` 12 it is the
 * seed's 12 by 12 picture, in PALETTE_12.
 */
export function fromSeed(seed: string, grid: number = PICTURE_GRID): Drawing {
    const palette = paletteFor(grid);
    const g = generate(seed, grid);
    const t = tones(g);
    const bg = nearest(hslToRgb(t.bg), [], palette);
    const body = nearest(hslToRgb(t.body), [bg], palette);
    const highlight = nearest(hslToRgb(t.highlight), [bg, body], palette);
    const cells = new Array<number>(grid * grid).fill(0);
    for (const p of g.pixels) cells[p.y * grid + p.x] = p.tone === 2 ? highlight : body;
    return { bg, cells };
}

/** Where each of the 12 rows and columns comes from in 7: the outer two and the middle one doubled, so a mirrored drawing stays mirrored. */
const SEVEN_TO_TWELVE = [0, 0, 1, 1, 2, 3, 3, 4, 5, 5, 6, 6];

/**
 * A 7 by 7 drawing grown to 12 by 12, to go on with in the editor: every
 * pixel where it was, some of them doubled, and each colour moved to the
 * nearest in PALETTE_12, never onto the background's.
 */
export function toTwelve(drawing: Drawing): Drawing {
    if (drawing.cells.length !== CELLS) return drawing;
    const bg = nearest(hexToRgb(PALETTE[drawing.bg].hex), [], PALETTE_12);
    const colour = new Map<number, number>();
    const cells = new Array<number>(GRID_12 * GRID_12).fill(0);
    for (let y = 0; y < GRID_12; y++) {
        for (let x = 0; x < GRID_12; x++) {
            const c = drawing.cells[SEVEN_TO_TWELVE[y] * GRID + SEVEN_TO_TWELVE[x]];
            if (!c) continue;
            if (!colour.has(c)) colour.set(c, nearest(hexToRgb(PALETTE[c].hex), [bg], PALETTE_12));
            cells[y * GRID_12 + x] = colour.get(c) as number;
        }
    }
    return { bg, cells };
}

// --- SVG ---------------------------------------------------------------------------

/** The picture's frame: a circle holding the background and the pixels of a `grid`, `size` pixels across. */
function frame(size: number, bg: string, pixels: string, grid: number = GRID): string {
    const view = grid + 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${view} ${view}" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true">`
        + `<clipPath id="a"><circle cx="${view / 2}" cy="${view / 2}" r="${view / 2}"/></clipPath>`
        + `<g clip-path="url(#a)"><rect width="${view}" height="${view}" fill="${bg}"/>${pixels}</g></svg>`;
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
    const grid = gridOf(drawing.cells);
    const palette = paletteFor(grid);
    const pixels = drawing.cells
        .map((c, i) => (c ? pixel(i % grid, Math.floor(i / grid), palette[c].hex) : ''))
        .join('');
    return frame(size, palette[drawing.bg].hex, pixels, grid);
}

/**
 * A profile picture as an SVG string, `size` pixels across: the drawing when
 * `avatar` is one, else the picture generated from it as a seed, on `grid`.
 * Only numbers and palette colours go into the markup, never the text itself.
 */
export function avatarSvg(avatar: string, size = 24, grid: number = PICTURE_GRID): string {
    const px = Number.isFinite(size) ? Math.max(1, Math.round(size)) : 24;
    const drawing = decodeDrawing(avatar);
    if (drawing) return drawingSvg(drawing, px);
    // The twelves are tried in their palette, so a generated one is too.
    return grid === GRID_12 ? drawingSvg(fromSeed(avatar, GRID_12), px) : generatedSvg(avatar, px);
}
