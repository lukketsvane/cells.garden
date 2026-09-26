import assert from 'node:assert/strict';

/** First-run coverage shared by all distributions; recycle through the real UI. */
export async function checkAndRecycleTutorial(page, { reload = true } = {}) {
    const seed = page.locator('.seed-content').filter({ hasText: /^Start here$/ });
    await seed.waitFor();
    assert.equal(await page.locator('.project-column').count(), 1);
    assert.equal(await page.locator('.garden-item').count(), 7);
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
