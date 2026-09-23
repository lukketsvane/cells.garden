/**
 * Items and pets wait for Max's approval before they reach cells.garden, so a
 * build carries them or not (extrasFlag in vite.config.ts). They are in the
 * dev server and in Vercel's build of the dev branch, dev.cells.garden, and
 * CELLS_EXTRAS=1 puts them in any build for testing. Every release goes
 * without: cells.garden, the extension and the Obsidian plugin.
 *
 * A build without them still keeps the items and pet switches a garden holds,
 * through loads, merges and saves; it only never shows them.
 */
declare const __CELLS_EXTRAS__: boolean;

export const EXTRAS: boolean = typeof __CELLS_EXTRAS__ === 'boolean' ? __CELLS_EXTRAS__ : false;
