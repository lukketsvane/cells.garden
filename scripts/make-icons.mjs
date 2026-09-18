#!/usr/bin/env node
// Renders the PNG icons for the Chrome extension and the PWA from
// public/icon.svg, in Chromium. Run with "npm run icons".
//
// Outputs:
//   ext/public/icons/icon-{16,32,48,128}.png   rounded corners, transparent outside
//   public/icon-{180,192,512}.png             square, full-bleed (180 is the iOS home screen icon)
//   public/icon-maskable-512.png               full-bleed, artwork in the central 80%

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(ROOT, 'public', 'icon.svg'));
const src = `data:image/svg+xml;base64,${svg.toString('base64')}`;
// The icon's own background, so the maskable icon's margin continues it.
const BACKGROUND = /<rect width="\d+" height="\d+" fill="(#[0-9a-f]{6})"/i.exec(svg.toString())?.[1] ?? '#000000';

const browser = await chromium.launch();
const page = await browser.newPage();

async function render(file, size, { radius = 0, inset = 0 } = {}) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0;background:transparent">
        <div style="width:${size}px;height:${size}px;border-radius:${radius}px;overflow:hidden;background:${BACKGROUND};display:grid;place-items:center">
        <img src="${src}" style="width:${size - 2 * inset}px;height:${size - 2 * inset}px;display:block"></div></body>`);
    await page.locator('img').evaluate((img) => img.decode());
    writeFileSync(file, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
    console.log(`wrote ${relative(ROOT, file)}`);
}

for (const size of [16, 32, 48, 128]) {
    await render(join(ROOT, 'ext', 'public', 'icons', `icon-${size}.png`), size, { radius: Math.round(size * 3 / 16) });
}
for (const size of [180, 192, 512]) {
    await render(join(ROOT, 'public', `icon-${size}.png`), size);
}
await render(join(ROOT, 'public', 'icon-maskable-512.png'), 512, { inset: 512 * 0.1 });

await browser.close();
