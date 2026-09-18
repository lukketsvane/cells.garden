import type { LayerName } from './model';

/**
 * The line icons, as SVG markup. They are set with innerHTML on a button or a
 * label, so they hold no text and inherit `currentColor`.
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
    /** A pane split in two: show or hide the board. */
    board: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="1.3"/></svg>`,
};

/**
 * The four zone icons, drawn rather than typed: the symbols these replace were
 * whichever characters a font happened to carry, and the stem one landed in a
 * plane no system font covers, so every reader saw an empty box. Each is one
 * plain line drawing on the same 24-square, to be redrawn without touching
 * anything else.
 */
export const ZONE_ICONS: Record<LayerName, string> = {
    /** A blossom: five petals around an eye. */
    flowers: `<svg ${stroke}><circle cx="12" cy="12" r="2"></circle><circle cx="12" cy="6.5" r="2.8"></circle><circle cx="17.2" cy="10.3" r="2.8"></circle><circle cx="15.2" cy="16.4" r="2.8"></circle><circle cx="8.8" cy="16.4" r="2.8"></circle><circle cx="6.8" cy="10.3" r="2.8"></circle></svg>`,
    /** A stalk carrying a leaf on either side. */
    stem: `<svg ${stroke}><path d="M12 21V4"></path><path d="M12 11c-3.3 0-5-2.2-5-5 3.3 0 5 2.2 5 5z"></path><path d="M12 8c3.3 0 5-2.2 5-5-3.3 0-5 2.2-5 5z"></path></svg>`,
    /** A taproot forking under the soil. */
    roots: `<svg ${stroke}><path d="M12 2v7"></path><path d="M12 9v13"></path><path d="M12 9c0 4.5-2.2 7-5.5 9"></path><path d="M12 9c0 4.5 2.2 7 5.5 9"></path></svg>`,
    /** A cut crystal, girdle and all. */
    minerals: `<svg ${stroke}><path d="M12 3 4 9l8 12 8-12-8-6z"></path><path d="M4 9h16"></path></svg>`,
};
