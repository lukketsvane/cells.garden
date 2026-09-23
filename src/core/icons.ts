import type { LayerName } from './model';

/**
 * The line icons, as SVG markup. setIcon() puts one into a button or a label,
 * so it holds no text and inherits `currentColor`.
 */
const stroke = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

export const ICONS = {
    /** Three nodes joined by two lines: share this plant. */
    share: `<svg ${stroke}><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"></line><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"></line></svg>`,
    /** A plant on standby wears the shut eye; hovering opens it. */
    eyeClosed: `<svg ${stroke}><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"></path><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"></path><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"></path><line x1="2" y1="2" x2="22" y2="22"></line></svg>`,
    eyeOpen: `<svg ${stroke}><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
    /** The plant's own menu. */
    dots: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="12" cy="19" r="2"></circle></svg>`,
    /** An arrow turning back: revert a setting to its default. */
    reset: `<svg ${stroke}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>`,
    /** A cross: remove. */
    close: `<svg ${stroke}><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>`,
    /** Google's G, in its own colours, as its sign-in button guidelines ask. */
    google: `<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`,
    /** A pane split in two: show or hide the board. */
    board: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="1.3"/></svg>`,
};

/**
 * A pixel-art icon from rows of `#` (a pixel) and `.` (none), one row per line
 * of the square it is drawn on. Each run of pixels in a row becomes a rectangle
 * one pixel high, all in one path filled with `currentColor`; crisp edges keep
 * the renderer from smoothing a pixel into its neighbours.
 */
function pixelIcon(rows: string[]): string {
    const size = rows.length;
    let d = '';
    rows.forEach((row, y) => {
        for (const run of row.matchAll(/#+/g)) {
            const n = run[0].length;
            d += `M${run.index} ${y}h${n}v1h-${n}z`;
        }
    });
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true"><path d="${d}"></path></svg>`;
}

/**
 * The four zone icons, drawn rather than typed: the symbols these replace were
 * whichever characters a font happened to carry, and the stem one landed in a
 * plane no system font covers, so every reader saw an empty box.
 *
 * They are pixel art, like the garden they label: one ink, square pixels, each
 * on the same 12-square and drawn here as its rows, so one can be redrawn
 * without touching anything else. The board shows them at 12 CSS pixels, an
 * art pixel to a CSS pixel, which puts every edge on a whole device pixel at
 * any whole-number screen scale.
 */
export const ZONE_ICONS: Record<LayerName, string> = {
    /** A blossom seen from above: four round petals parted around an open eye. */
    flowers: pixelIcon([
        '....####....',
        '...######...',
        '...######...',
        '.##.####.##.',
        '####.##.####',
        '#####..#####',
        '#####..#####',
        '####.##.####',
        '.##.####.##.',
        '...######...',
        '...######...',
        '....####....',
    ]),
    /** A stalk with a pointed leaf on either side, the upper one reaching for the light. */
    stem: pixelIcon([
        '......#....#',
        '......#..###',
        '......#.####',
        '......#.###.',
        '......##....',
        '.#....#.....',
        '.###..#.....',
        '.####.#.....',
        '..###.#.....',
        '.....##.....',
        '......#.....',
        '......#.....',
    ]),
    /** Roots from the base of the plant, forking as they spread down, one pixel thin like the garden's own. */
    roots: pixelIcon([
        '.....##.....',
        '.....##.....',
        '.....#.#....',
        '...##..#....',
        '..#...#.##..',
        '.#...#....#.',
        '.#..#.#....#',
        '#...#..#....',
        '...#...#..#.',
        '..#.....##..',
        '..#.......#.',
        '.#..........',
    ]),
    /** A cut gem in outline: the table, the girdle and the facets meeting at the point. */
    minerals: pixelIcon([
        '............',
        '...######...',
        '..#.#..#.#..',
        '.#..#..#..#.',
        '############',
        '#...#..#...#',
        '.#..#..#..#.',
        '..#..##..#..',
        '...#.##.#...',
        '....####....',
        '.....##.....',
        '............',
    ]),
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Put an SVG string into an element, parsed as SVG rather than set as HTML. */
export function setIcon(el: Element, svg: string) {
    const markup = svg.includes('xmlns=') ? svg : svg.replace('<svg', `<svg xmlns="${SVG_NS}"`);
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
    el.replaceChildren(document.importNode(doc.documentElement, true));
}
