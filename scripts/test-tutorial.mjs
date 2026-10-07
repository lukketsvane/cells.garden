import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tileUrl = 'data:image/png;base64,' + readFileSync(new URL('../src/assets/void_tile.png', import.meta.url)).toString('base64');

/** Check the shipped artwork, not only the source files retained in the repository. */
async function checkArtwork(page) {
    await page.locator('.garden-bg-layer').first().waitFor({ state: 'attached' });
    const artwork = await page.evaluate(() => {
        const viewport = getComputedStyle(document.querySelector('.garden-canvas-viewport'));
        const sky = ['sky-color', 'stars', 'satellite', 'shooting-star', 'mountains', 'bg'].map(name =>
            getComputedStyle(document.querySelector('.garden-' + name + '-layer')).zIndex);
        const isolated = getComputedStyle(document.querySelector('.garden-world')).isolation;
        return { image: viewport.backgroundImage, size: viewport.backgroundSize, repeat: viewport.backgroundRepeat, sky, isolated };
    });
    assert.equal(artwork.image, `url("${tileUrl}")`, 'the void renders the original image, not just its alpha mask');
    assert.equal(artwork.size, '32px 32px');
    assert.equal(artwork.repeat, 'repeat');
    assert.deepEqual(artwork.sky, ['-8', '-7', '-6', '-5', '0', '3'], 'UFOs, satellites and shooting stars stay behind the mountains');
    assert.equal(artwork.isolated, 'isolate', 'negative sky layers stay inside the world');
}

/** First-run coverage shared by all distributions; recycle through the real UI. */
export async function checkAndRecycleTutorial(page, { reload = true } = {}) {
    const seed = page.locator('.seed-content').filter({ hasText: /^Tutorial plant$/ });
    await seed.waitFor();
    await checkArtwork(page);
    assert.equal(await page.locator('.project-column').count(), 1);
    assert.equal(await page.locator('.garden-item').count(), 40);
    const id = await seed.getAttribute('data-id');
    for (const layer of ['flowers', 'stem', 'roots', 'minerals']) {
        assert(await page.locator(`.${layer}-zone .garden-item`).count() > 0, layer);
    }
    if (reload) {
        await page.reload({ waitUntil: 'load' });
        await seed.waitFor();
        assert.equal(await seed.getAttribute('data-id'), id, 'the tutorial is kept, not recreated');
    }
    await seed.click({ button: 'right' });
    await page.getByRole('button', { name: 'Recycle plant', exact: true }).click();
    await page.getByRole('button', { name: 'Recycle', exact: true }).click();
    await page.waitForSelector('.kanban-empty-message');
    if (reload) {
        await page.reload({ waitUntil: 'load' });
        await page.waitForSelector('.kanban-empty-message');
        assert.equal(await page.locator('.project-column').count(), 0, 'an intentionally empty garden stays empty');
    }
}
