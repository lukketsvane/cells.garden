#!/usr/bin/env node
// Generates the PNG icons for the Chrome extension and the PWA from the
// 16x16 pixel grid in public/icon.svg. No dependencies: the PNG encoder is
// written here on top of node:zlib. Run with "npm run icons".
//
// Outputs:
//   ext/public/icons/icon-{16,32,48,128}.png   rounded corners, transparent outside
//   public/icon-192.png, public/icon-512.png   square, sky full-bleed
//   public/icon-maskable-512.png               full-bleed, artwork in the central 80%

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Artwork: the same 16x16 grid as public/icon.svg, hard-coded.
// ---------------------------------------------------------------------------

const PALETTE = {
    '.': '#87CEEB', // sky
    'g': '#5a4030', // ground
    's': '#3e8e41', // stem + leaves
    'f': '#e9569c', // flower petals
    'c': '#ffd54f', // flower centre
    'a': '#2b1d14', // ants
};

const GRID = [
    '................',
    '................',
    '......ffff......',
    '......fccf......',
    '......fccf......',
    '......ffff......',
    '.......ss.......',
    '.....ssss.......',
    '.......ssss.....',
    '.......ss.......',
    '.......ss.......',
    'gggggggggggggggg',
    'gggggggggggggggg',
    'gggaaggggggaaggg',
    'gggggggggggggggg',
    'gggggggggggggggg',
];

const GRID_SIZE = 16;
// Corner radius of public/icon.svg (rx="3" on a 16 unit box), as a fraction of the size.
const CORNER_RADIUS = 3 / 16;

if (GRID.length !== GRID_SIZE) throw new Error(`GRID has ${GRID.length} rows, expected ${GRID_SIZE}`);
for (let y = 0; y < GRID.length; y++) {
    if (GRID[y].length !== GRID_SIZE) {
        throw new Error(`GRID row ${y} has ${GRID[y].length} columns, expected ${GRID_SIZE}: "${GRID[y]}"`);
    }
}

function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

const COLORS = Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, hexToRgb(v)]));

function gridColor(gx, gy) {
    // Clamp so that pixels outside the grid extend the edge rows/columns
    // (sky above, ground below); used by the full-bleed maskable icon.
    const x = Math.min(GRID_SIZE - 1, Math.max(0, gx));
    const y = Math.min(GRID_SIZE - 1, Math.max(0, gy));
    const key = GRID[y][x];
    const rgb = COLORS[key];
    if (!rgb) throw new Error(`Unknown palette key "${key}" at ${x},${y}`);
    return rgb;
}

// ---------------------------------------------------------------------------
// Rasteriser: nearest-neighbour scaling of the grid into an RGBA buffer.
// ---------------------------------------------------------------------------

/**
 * @param {number} size      output width and height in pixels
 * @param {object} opts
 * @param {number} opts.cell     size of one grid cell in output pixels
 * @param {number} opts.offset   where the grid's top-left corner lands
 * @param {boolean} [opts.rounded]  mask the rounded corners of the SVG
 */
function rasterise(size, { cell, offset, rounded = false }) {
    const rgba = Buffer.alloc(size * size * 4);
    const radius = size * CORNER_RADIUS;
    for (let y = 0; y < size; y++) {
        const gy = Math.floor((y - offset) / cell);
        for (let x = 0; x < size; x++) {
            const gx = Math.floor((x - offset) / cell);
            const [r, g, b] = gridColor(gx, gy);
            const i = (y * size + x) * 4;
            rgba[i] = r;
            rgba[i + 1] = g;
            rgba[i + 2] = b;
            rgba[i + 3] = rounded ? roundedAlpha(x, y, size, radius) : 255;
        }
    }
    return rgba;
}

// Coverage of the rounded rectangle for one output pixel, supersampled so the
// corners are smooth while the artwork itself stays hard-edged. Coverage under
// MIN_COVERAGE snaps to fully transparent so the 16 and 32 px icons do not
// keep a faint stray pixel in each corner.
const SUPERSAMPLE = 8;
const MIN_COVERAGE = 1 / 16;
function roundedAlpha(x, y, size, radius) {
    // Only pixels inside one of the four corner squares can be partially covered.
    const inCornerX = x < radius || x >= size - radius;
    const inCornerY = y < radius || y >= size - radius;
    if (!inCornerX || !inCornerY) return 255;
    const cx = x < radius ? radius : size - radius;
    const cy = y < radius ? radius : size - radius;
    let inside = 0;
    for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        const py = y + (sy + 0.5) / SUPERSAMPLE;
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
            const px = x + (sx + 0.5) / SUPERSAMPLE;
            const dx = px - cx;
            const dy = py - cy;
            if (dx * dx + dy * dy <= radius * radius) inside++;
        }
    }
    const coverage = inside / (SUPERSAMPLE * SUPERSAMPLE);
    return coverage < MIN_COVERAGE ? 0 : Math.round(coverage * 255);
}

// ---------------------------------------------------------------------------
// PNG encoder: 8-bit RGBA, no interlace, filter type 0 on every scanline.
// ---------------------------------------------------------------------------

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const typeBytes = Buffer.from(type, 'ascii');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
    return Buffer.concat([length, typeBytes, data, crc]);
}

function encodePng(size, rgba) {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0); // width
    ihdr.writeUInt32BE(size, 4); // height
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // colour type: RGBA
    ihdr[10] = 0; // compression method
    ihdr[11] = 0; // filter method
    ihdr[12] = 0; // interlace method

    const stride = size * 4;
    const raw = Buffer.alloc((stride + 1) * size);
    for (let y = 0; y < size; y++) {
        raw[y * (stride + 1)] = 0; // filter type 0 (None)
        rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }

    return Buffer.concat([
        signature,
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

const EXT_SIZES = [16, 32, 48, 128];
const PWA_SIZES = [192, 512];
const MASKABLE_SIZE = 512;
// Cell size for the maskable icon: 16 * 24 = 384 px of artwork on a 512 px
// canvas (75% of the width), so every drawn pixel sits inside the 80% safe
// zone and the sky/ground extend full-bleed to the edges.
const MASKABLE_CELL = 24;

const jobs = [];
for (const size of EXT_SIZES) {
    jobs.push({
        path: join(ROOT, 'ext', 'public', 'icons', `icon-${size}.png`),
        size,
        opts: { cell: size / GRID_SIZE, offset: 0, rounded: true },
    });
}
for (const size of PWA_SIZES) {
    jobs.push({
        path: join(ROOT, 'public', `icon-${size}.png`),
        size,
        opts: { cell: size / GRID_SIZE, offset: 0 },
    });
}
jobs.push({
    path: join(ROOT, 'public', `icon-maskable-${MASKABLE_SIZE}.png`),
    size: MASKABLE_SIZE,
    opts: { cell: MASKABLE_CELL, offset: (MASKABLE_SIZE - GRID_SIZE * MASKABLE_CELL) / 2 },
});

for (const job of jobs) {
    if (!Number.isInteger(job.opts.cell) || !Number.isInteger(job.opts.offset)) {
        throw new Error(`${job.path}: cell ${job.opts.cell} / offset ${job.opts.offset} must be whole pixels`);
    }
    const png = encodePng(job.size, rasterise(job.size, job.opts));
    mkdirSync(dirname(job.path), { recursive: true });
    writeFileSync(job.path, png);
    console.log(`${relative(ROOT, job.path)}  ${job.size}x${job.size}  ${png.length} bytes`);
}
