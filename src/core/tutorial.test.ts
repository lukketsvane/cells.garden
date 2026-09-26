import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { emptyGarden } from './model';
import { setLocalBackend } from './local';
import { LOCAL_KEY, LocalStore } from './store';
import { tutorialGarden } from './tutorial';

const values = new Map<string, string>();
beforeEach(() => {
    values.clear();
    setLocalBackend({
        get: key => values.get(key) ?? null,
        set: (key, value) => { values.set(key, value); },
        remove: key => { values.delete(key); },
    });
});

test('the tutorial is a normal plant with a cell in every layer and no shared IDs', () => {
    const a = tutorialGarden(), b = tutorialGarden();
    assert.equal(a.version, 1, 'the release version does not change the storage schema');
    assert.equal(a.projects.length, 1);
    const ids = new Set<string>();
    for (const garden of [a, b]) {
        const p = garden.projects[0];
        assert(!ids.has(p.id)); ids.add(p.id);
        for (const layer of ['flowers', 'stem', 'roots', 'minerals'] as const) {
            assert(p[layer].length > 0);
            for (const cell of p[layer]) {
                assert(!ids.has(cell.id)); ids.add(cell.id);
                assert.equal(cell.isComplete, layer === 'flowers');
                assert(!cell.assignees);
            }
        }
        assert(!p.sharedPlantId);
    }
    a.projects[0].minerals.pop();
    assert.equal(b.projects[0].minerals.length, 3);
});

test('the first local garden is saved once and survives another instance', async () => {
    const first = await new LocalStore(LOCAL_KEY, tutorialGarden).load();
    assert(first?.projects.length);
    assert.deepEqual(await new LocalStore(LOCAL_KEY, tutorialGarden).load(), first);
});

test('a deliberately emptied garden never gets the tutorial again', async () => {
    const store = new LocalStore(LOCAL_KEY, tutorialGarden);
    await store.load();
    const empty = emptyGarden();
    await store.save(empty);
    assert.deepEqual(await new LocalStore(LOCAL_KEY, tutorialGarden).load(), empty);
});

test('existing gardens are not rewritten and user mirrors are not initialized', async () => {
    const garden = tutorialGarden(); garden.projects[0].seed = 'My existing project';
    const raw = JSON.stringify(garden); values.set(LOCAL_KEY, raw);
    const loaded = await new LocalStore(LOCAL_KEY, tutorialGarden).load();
    assert.equal(loaded?.projects[0].seed, 'My existing project');
    assert.equal(values.get(LOCAL_KEY), raw);
    assert.equal(await new LocalStore(`${LOCAL_KEY}/user/test`).load(), null);
    assert(!values.has(`${LOCAL_KEY}/user/test`));
});

test('a damaged or empty stored value is not overwritten by onboarding', async () => {
    for (const raw of ['{}', '']) {
        values.set(LOCAL_KEY, raw);
        assert.equal(await new LocalStore(LOCAL_KEY, tutorialGarden).load(), null);
        assert.equal(values.get(LOCAL_KEY), raw);
    }
});

test('onboarding works in an embedded host without randomUUID', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    try {
        Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues } });
        const garden = tutorialGarden();
        assert.match(garden.projects[0].id, /^proj_[a-f0-9]{32}$/);
        assert.equal(garden.projects[0].minerals.length, 3);
    } finally {
        if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    }
});
