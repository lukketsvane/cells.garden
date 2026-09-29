// Run after a production deployment that changes these public pages.
// https://www.indexnow.org/documentation
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const origin = 'https://cells.garden';
const key = (await readFile(new URL('../public/indexnow-key.txt', import.meta.url), 'utf8')).trim();
const keyLocation = origin + '/indexnow-key.txt';
const sitemap = await readFile(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
const allowed = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
const requested = process.argv.slice(2);
const urlList = requested.length ? [...new Set(requested)] : allowed;
assert(urlList.length > 0 && urlList.every(url => allowed.includes(url)), 'Submit only public canonical URLs in the sitemap.');
assert(/^[a-f0-9]{32}$/.test(key), 'Invalid IndexNow ownership key.');
const get = async url => {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 200, `${url} must be live without a redirect before submitting.`);
    return response.text();
};
assert.equal((await get(keyLocation)).trim(), key, 'Deploy the ownership file before submitting.');
for (const url of urlList) {
    const html = await get(url);
    assert(html.includes(`rel="canonical" href="${url}"`), 'Live canonical does not match: ' + url);
    assert(!/<meta[^>]+name="robots"[^>]+content="[^"]*noindex/i.test(html), 'Page is noindex: ' + url);
}
const response = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: 'cells.garden', key, keyLocation, urlList }),
    signal: AbortSignal.timeout(30000),
});
assert([200, 202].includes(response.status), `IndexNow returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
console.log(JSON.stringify({ status: response.status, urls: urlList, result: response.status === 202 ? 'Received; ownership validation pending.' : 'Submission received.', note: 'Receipt does not confirm crawling, indexing or ranking.' }, null, 2));
