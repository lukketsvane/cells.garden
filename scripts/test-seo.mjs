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
async function checkBrand(page) {
    assert.equal(await page.locator('[itemscope][itemtype="https://schema.org/WebSite"]').count(), 1, 'one site identity must survive app boot');
    assert.equal(await page.locator('meta[itemprop="name"]').getAttribute('content'), 'cells.garden');
    assert.equal(await page.locator('meta[itemprop="alternateName"]').getAttribute('content'), 'Cells Garden');
    assert.equal(await page.locator('link[itemprop="url"]').getAttribute('href'), 'https://cells.garden/');
    assert.match(await page.title(), /Cells Garden \(cells\.garden\)/);
}
let browser;
try {
    browser = await chromium.launch();
    const sitemap = await (await fetch(base + '/sitemap.xml')).text();
    const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => new URL(m[1]));
    const expected = ['/', '/guide/', '/guide/mobile/', '/guide/sync-sharing/', '/guide/backups/', '/chrome-extension/', '/obsidian/', '/privacy.html'];
    assert.deepEqual(urls.map(url => url.pathname).sort(), expected.slice().sort(), 'Sitemap must contain each public canonical page exactly once.');
    assert(urls.every(url => url.origin === 'https://cells.garden' && !url.search && !url.hash), 'Only public canonical URLs belong in the sitemap.');
    const robots = await (await fetch(base + '/robots.txt')).text();
    assert(robots.includes('Sitemap: https://cells.garden/sitemap.xml'));
    const titles = new Set();
    const descriptions = new Set();
    const links = new Map();
    const plain = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    const page = await plain.newPage();
    for (const url of urls) {
        const response = await page.goto(base + url.pathname);
        assert.equal(response.status(), 200, url.pathname);
        assert.equal(await page.locator('h1').count(), 1, url.pathname);
        assert(await page.locator('h1').isVisible());
        assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), url.href);
        assert.equal(await page.locator('link[rel="canonical"]').count(), 1);
        assert.equal(await page.locator('meta[name="robots"][content*="noindex"]').count(), 0, 'public page must remain indexable');
        const title = await page.title();
        const description = await page.locator('meta[name="description"]').getAttribute('content');
        assert(title.length > 10 && !titles.has(title), 'unique useful title: ' + url.pathname);
        assert(description.length > 60 && !descriptions.has(description), 'unique useful description: ' + url.pathname);
        titles.add(title); descriptions.add(description);
        if (url.pathname === '/') await checkBrand(page);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile overflow: ' + url.pathname);
        const outgoing = await page.locator('a[href^="/"]').evaluateAll(anchors => anchors.map(a => a.getAttribute('href')));
        links.set(url.pathname, outgoing);
        for (const href of outgoing) {
            assert.equal((await fetch(base + href)).status, 200, 'broken internal link: ' + href);
        }
    }
    const reachable = new Set();
    const queue = ['/'];
    while (queue.length) {
        const path = queue.shift();
        if (reachable.has(path)) continue;
        reachable.add(path);
        queue.push(...(links.get(path) ?? []));
    }
    assert(expected.every(path => reachable.has(path)), 'Every public page needs a crawlable path from the homepage.');
    for (const redirect of config.redirects) {
        const response = await fetch(base + redirect.source + '?from=seo-check', { redirect: 'manual' });
        assert.equal(response.status, 308);
        assert.equal(response.headers.get('location'), redirect.destination + '?from=seo-check');
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
    await checkBrand(app);
    await app.evaluate(() => navigator.serviceWorker.ready);
    await app.reload();
    assert(await app.evaluate(() => !!navigator.serviceWorker.controller), 'worker must control the browser');
    for (const path of expected.filter(path => path !== '/')) {
        await app.goto(base + path);
        assert.equal(await app.locator('h1').count(), 1, 'worker swallowed ' + path);
        assert.equal(await app.locator('#app').count(), 0, 'app shell replaced ' + path);
    }
    await context.setOffline(true);
    for (const path of expected.filter(path => path.startsWith('/guide/'))) {
        await app.goto(base + path);
        assert.equal(await app.locator('h1').count(), 1, 'guide must work offline: ' + path);
    }
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
    console.log(`SEO checks passed: ${urls.length} crawlable pages, unique metadata, mobile layout, reachable internal links, canonical redirects, utility noindex, service-worker navigation, offline app and guides, true 404.`);
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
