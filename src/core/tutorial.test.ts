import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';
import { emptyGarden, type Garden, type ProjectData } from './model';
import { mergeGardens } from './merge';
import { setLocalBackend } from './local';
import { LOCAL_KEY, LocalStore } from './store';
import { tutorialGarden, upgradeLegacyTutorial } from './tutorial';

const values = new Map<string, string>();
const legacyGarden = (): Garden => JSON.parse(readFileSync(new URL('../../scripts/fixtures/legacy-tutorial.json', import.meta.url), 'utf8')) as Garden;
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
                assert.equal(cell.isComplete, false);
                assert(cell.imagePath && cell.content);
                assert(!cell.assignees);
            }
        }
        assert(!p.sharedPlantId);
    }
    a.projects[0].minerals.pop();
    assert.equal(b.projects[0].minerals.length, 12);
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
        assert.match(garden.projects[0].id, /^tutorial_[a-f0-9]{32}$/);
        assert.equal(garden.projects[0].minerals.length, 12);
    } finally {
        if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    }
});

test('the untouched small starter becomes the original tall tutorial without changing its identity', () => {
    const old = legacyGarden(), before = structuredClone(old);
    old.projects[0].order = 4;
    const upgraded = upgradeLegacyTutorial(old);
    const plant = upgraded.projects[0];
    assert.equal(plant.id, old.projects[0].id);
    assert.equal(plant.order, 4);
    assert.equal(plant.seed, 'Tutorial plant');
    assert.equal(plant.stem.length, 9);
    assert.equal(plant.flowers.length, 13);
    assert.equal(plant.roots.length, 6);
    assert.equal(plant.minerals.length, 12);
    assert.equal(plant.hue, 304);
    assert.equal(upgraded.settings, old.settings);
    assert.deepEqual(old.projects[0].minerals, before.projects[0].minerals, 'input is not mutated');
    assert.equal(upgradeLegacyTutorial(upgraded), upgraded, 'the upgrade is idempotent');
});

test('edited, customized, shared and deleted starters are never replaced', () => {
    const edits: Array<(plant: ProjectData) => void> = [
        p => { p.name = 'My project'; }, p => { p.seed = 'My project'; },
        p => { p.hue = 20; }, p => { p.standby = true; }, p => { p.plantType = 'plant_2'; },
        p => { p.seedImagePath = 'seeds/seed2.png'; }, p => { p.tags = ['personal']; },
        p => { p.sharedPlantId = 'shared'; }, p => { p.minerals[0].content = 'My own idea'; },
        p => { p.minerals[0].isComplete = true; }, p => { p.minerals[0].highlighted = true; },
        p => { p.minerals[0].assignees = ['someone']; }, p => { p.minerals[0].imagePath = 'minerals/mineral1.png'; },
        p => { p.minerals.pop(); }, p => { p.roots.reverse(); }, p => { p.stem.push({ ...p.stem[0], id: 'new-cell' }); },
    ];
    for (const edit of edits) {
        const garden = legacyGarden();
        edit(garden.projects[0]);
        assert.equal(upgradeLegacyTutorial(garden), garden);
    }
    const empty = emptyGarden();
    assert.equal(upgradeLegacyTutorial(empty), empty);
    const unrelated = tutorialGarden().projects[0];
    const garden = legacyGarden();
    garden.projects.push(unrelated);
    assert.equal(upgradeLegacyTutorial(garden).projects[1], unrelated);
});

test('two devices upgrading the same starter merge without duplicate cells', () => {
    const base = legacyGarden();
    const first = upgradeLegacyTutorial(base), second = upgradeLegacyTutorial(structuredClone(base));
    assert.deepEqual(first, second);
    const merged = mergeGardens(base, first, second);
    assert.deepEqual(merged.projects, first.projects);
    const edited = structuredClone(base);
    edited.projects[0].minerals[0].content = 'Keep my concurrent edit';
    const concurrent = mergeGardens(base, first, edited);
    assert(concurrent.projects[0].minerals.some(cell => cell.content === 'Keep my concurrent edit'));
});
