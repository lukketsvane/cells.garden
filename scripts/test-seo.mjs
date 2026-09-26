// Validate public pages without JavaScript and with an installed service worker.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const root = resolve('dist');
const config = JSON.parse(await readFile('vercel.json', 'utf8'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.txt': 'text/plain', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const redirect = config.redirects.find(r => r.source === url.pathname);
    if (redirect) { res.writeHead(308, { Location: redirect.destination + url.search }); res.end(); return; }
    const path = resolve(root, '.' + decodeURIComponent(url.pathname), url.pathname.endsWith('/') ? 'index.html' : '');
    if (!path.startsWith(root + '/')) { res.writeHead(403); res.end(); return; }
    try {
        const body = await readFile(path);
        const headers = Object.fromEntries(config.headers.find(h => h.source === '/(.*)').headers.map(h => [h.key, h.value]));
        // Local HTTP is intentionally used by the service-worker test.
        headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace('; upgrade-insecure-requests', '');
        res.writeHead(200, { ...headers, 'Content-Type': types[extname(path)] || 'application/octet-stream' });
        res.end(body);
    } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
    browser = await chromium.launch();
    const sitemap = await (await fetch(base + '/sitemap.xml')).text();
    const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => new URL(m[1]));
    assert.equal(urls.length, 5);
    const robots = await (await fetch(base + '/robots.txt')).text();
    assert(robots.includes('Sitemap: https://cells.garden/sitemap.xml'));
    const titles = new Set();
    const descriptions = new Set();
    const plain = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    const page = await plain.newPage();
    for (const url of urls) {
        const response = await page.goto(base + url.pathname);
        assert.equal(response.status(), 200, url.pathname);
        assert.equal(await page.locator('h1').count(), 1, url.pathname);
        assert(await page.locator('h1').isVisible());
        assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), url.href);
        const title = await page.title();
        const description = await page.locator('meta[name="description"]').getAttribute('content');
        assert(title.length > 10 && !titles.has(title), 'unique useful title: ' + url.pathname);
        assert(description.length > 60 && !descriptions.has(description), 'unique useful description: ' + url.pathname);
        titles.add(title); descriptions.add(description);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile overflow: ' + url.pathname);
        for (const href of await page.locator('a[href^="/"]').evaluateAll(links => links.map(a => a.getAttribute('href')))) {
            assert.equal((await fetch(base + href)).status, 200, 'broken internal link: ' + href);
        }
    }
    for (const path of ['/privacy/oauth-return.html', '/privacy/oauth-extension-start.html', '/privacy-refresh.html']) {
        await page.goto(base + path);
        assert.match(await page.locator('meta[name="robots"]').getAttribute('content'), /noindex/);
    }
    await plain.close();
    const context = await browser.newContext();
    const app = await context.newPage();
    await app.goto(base + '/');
    await app.waitForFunction(() => !!window.garden);
    await app.evaluate(() => navigator.serviceWorker.ready);
    await app.reload();
    assert(await app.evaluate(() => !!navigator.serviceWorker.controller), 'worker must control the browser');
    for (const path of ['/guide/', '/chrome-extension/', '/obsidian/', '/privacy.html']) {
        await app.goto(base + path);
        assert.equal(await app.locator('h1').count(), 1, 'worker swallowed ' + path);
        assert.equal(await app.locator('#app').count(), 0, 'app shell replaced ' + path);
    }
    await context.setOffline(true);
    await app.goto(base + '/guide/');
    assert.match(await app.locator('h1').innerText(), /project planner/);
    await app.goto(base + '/?offline-check=1');
    await app.waitForFunction(() => !!window.garden);
    await context.setOffline(false);
    const missing = await app.goto(base + '/this-page-does-not-exist');
    assert.equal(missing.status(), 404, 'unknown page must not become an app-shell soft 404');
    if (process.env.SEO_SCREENSHOTS) {
        await app.setViewportSize({ width: 1280, height: 900 });
        await app.goto(base + '/guide/');
        await app.screenshot({ path: process.env.SEO_SCREENSHOTS + '/guide-desktop.png', fullPage: true });
        await app.setViewportSize({ width: 390, height: 844 });
        await app.goto(base + '/chrome-extension/');
        await app.screenshot({ path: process.env.SEO_SCREENSHOTS + '/chrome-mobile.png', fullPage: true });
    }
    console.log('SEO checks passed: 5 crawlable pages, unique metadata, mobile layout, internal links, utility noindex, service-worker navigation, offline app and guide, true 404.');
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
