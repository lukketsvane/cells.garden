#!/usr/bin/env node
// Decodes the crow atlas in a real browser and reports which cells carry pixels.
//
// The 160 x 160 sheet is 8 x 8 cells of 20 x 20 native pixels. An earlier atlas
// was a corrupt PNG whose zlib stream went bad past scanline 105, so Chromium
// dropped every row after the walk cycle and those animations drew nothing at
// all. This guards against that returning. Run with:
//
//   node scripts/check-crow-atlas.mjs [path/to/other-atlas-source.ts]
//
// and every cell an animation addresses should come back non-empty.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(process.argv[2] || join(ROOT, 'src', 'core', 'crow.ts'), 'utf8');
const url = /CROW_ATLAS_URL\s*=\s*'(data:image\/png;base64,[^']+)'/.exec(source)?.[1];
if (!url) throw new Error('no CROW_ATLAS_URL in the source');

const browser = await chromium.launch();
const page = await browser.newPage();
const report = await page.evaluate(async (src) => {
    const image = new Image();
    const loaded = await new Promise((resolve) => {
        image.onload = () => resolve(true);
        image.onerror = () => resolve(false);
        image.src = src;
    });
    if (!loaded) return { loaded: false };

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);

    const cell = 20;
    const rows = [];
    for (let row = 0; row * cell < canvas.height; row++) {
        const counts = [];
        for (let col = 0; col * cell < canvas.width; col++) {
            const { data } = ctx.getImageData(col * cell, row * cell, cell, cell);
            let opaque = 0;
            for (let i = 3; i < data.length; i += 4) if (data[i] > 8) opaque++;
            counts.push(opaque);
        }
        rows.push(counts);
    }
    return { loaded: true, width: canvas.width, height: canvas.height, rows };
}, url);
await browser.close();

if (!report.loaded) {
    console.error('the browser refused the atlas outright');
    process.exit(1);
}

console.log(`atlas ${report.width} x ${report.height}, opaque pixels per 32 x 32 cell:`);
report.rows.forEach((counts, row) => console.log(` row ${row}: ${counts.join(', ')}`));

// Every frame the controller addresses has to have art in it.
const used = [...source.matchAll(/row:\s*(\d+),\s*frames:\s*(\d+)/g)]
    .map(([, row, frames]) => ({ row: Number(row), frames: Number(frames) }));
const blank = [];
for (const { row, frames } of used) {
    for (let frame = 0; frame < frames; frame++) {
        if (!report.rows[row]?.[frame]) blank.push(`row ${row} frame ${frame}`);
    }
}
if (blank.length) {
    console.error(`\nblank frames the crow would vanish on: ${blank.join('; ')}`);
    process.exit(1);
}
console.log(`\nall ${used.reduce((n, a) => n + a.frames, 0)} addressed frames carry art`);
