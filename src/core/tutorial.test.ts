import assert from 'node:assert/strict';
import test from 'node:test';
import { local, setLocalBackend } from './local';
import { emptyGarden } from './model';
import { LocalStore } from './store';
import { seedTutorial, tutorialGarden } from './tutorial';

test('only a new store receives a starter; edits and deliberate emptiness survive reloads', async () => {
    const saved = new Map<string, string>();
    setLocalBackend({ get: key => saved.get(key) ?? null, set: (key, value) => { saved.set(key, value); }, remove: key => { saved.delete(key); } });
    const store = new LocalStore('test/tutorial');
    local.remove(store.key);
    await seedTutorial(store);
    const garden = await store.load();
    assert.equal(garden?.projects.length, 1);
    garden!.projects[0].seed = 'My own project';
    await store.save(garden!);
    await seedTutorial(store);
    assert.equal((await store.load())?.projects[0].seed, 'My own project');
    await store.save(emptyGarden());
    await seedTutorial(store);
    assert.equal((await store.load())?.projects.length, 0);
    local.remove(store.key);
});

test('practice gardens have independent IDs and all four editable layers', () => {
    const first = tutorialGarden();
    const second = tutorialGarden();
    assert.notEqual(first.projects[0].id, second.projects[0].id);
    for (const layer of ['minerals', 'roots', 'stem', 'flowers'] as const) {
        assert(first.projects[0][layer].length > 0);
        assert(first.projects[0][layer].every(cell => cell.imagePath && cell.content));
    }
    assert.equal(first.projects[0].sharedPlantId, undefined);
});
