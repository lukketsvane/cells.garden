import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { ROOT, manifest, sha256, stageAsset, previewServer } from './design-assets.mjs';

const root = mkdtempSync(resolve(tmpdir(), 'garden-preview-test-'));
const asset = manifest.assets['void-tile'];
const tile = readFileSync(resolve(ROOT, asset.path));
mkdirSync(dirname(resolve(root, asset.path)), { recursive: true });
writeFileSync(resolve(root, asset.path), tile);
let browser;
let server;
try {
    browser = await chromium.launch({ headless: true });
    for (const blocked of [false, true]) {
        if (blocked) asset.blockedSha256.push(sha256(tile));
        stageAsset('void-tile', tile, root);
        server = previewServer('void-tile', root);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        for (const viewport of [{ width: 1200, height: 800 }, { width: 390, height: 844 }]) {
            await page.setViewportSize(viewport);
            await page.goto(base);
            await page.waitForFunction(() => document.querySelector('#status').dataset.blocked !== undefined);
            assert.equal(await page.locator('#status').getAttribute('data-blocked'), String(blocked));
            assert.match(await page.locator('#status').innerText(), blocked ? /Blocked:/ : /Byte-identical:/);
            assert.equal(await page.locator('#source').getAttribute('href'), `https://www.figma.com/design/${manifest.fileKey}/cells.garden?node-id=253-411`);
            const geometry = await page.evaluate(() => ({
                overflow: document.documentElement.scrollWidth > innerWidth,
                images: [...document.images].map(image => [image.naturalWidth, image.naturalHeight, image.getBoundingClientRect().width]),
                repeats: [...document.querySelectorAll('.pattern')].map(element => [getComputedStyle(element).backgroundSize, getComputedStyle(element).imageRendering]),
            }));
            assert.equal(geometry.overflow, false);
            assert.deepEqual(geometry.images, [[32, 32, 32], [32, 32, 32]]);
            assert.deepEqual(geometry.repeats, [['32px 32px', 'pixelated'], ['32px 32px', 'pixelated']]);
        }
        assert.deepEqual(errors, []);
        await page.close();
        await new Promise(resolve => server.close(resolve));
        server = undefined;
    }
    console.log('Design preview passed: desktop, mobile, native pixels, blocked artwork and no page errors.');
} finally {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
}
