import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeGardens, mergePlant, plantData } from './merge';
import { DEFAULT_SETTINGS, type Garden, type LayerItem, type ProjectData } from './model';

const NOW = '2026-09-17T12:00:00.000Z';
const now = () => NOW;

function item(id: string, content = id, extra: Partial<LayerItem> = {}): LayerItem {
    return { id, content, isComplete: false, ...extra };
}

function plant(id: string, order: number, extra: Partial<ProjectData> = {}): ProjectData {
    return {
        id, name: id, seed: id, standby: false, hue: 0, order, plantType: 'plant_1',
        flowers: [], stem: [], roots: [], minerals: [],
        ...extra,
    };
}

function garden(projects: ProjectData[], extra: Partial<Garden> = {}): Garden {
    return { version: 1, projects, settings: { ...DEFAULT_SETTINGS }, updatedAt: '2026-09-17T10:00:00.000Z', ...extra };
}

/** A deep copy to edit, so a test never mutates its base. */
function copy<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

const seeds = (g: Garden) => g.projects.map(p => p.seed);
const stem = (g: Garden, i = 0) => g.projects[i].stem.map(s => s.content);

test('nothing changed locally: the result is remote, timestamp included', () => {
    const base = garden([plant('a', 0, { stem: [item('s1')] })]);
    const remote = copy(base);
    remote.projects[0].stem.push(item('s2'));
    remote.updatedAt = '2026-09-17T11:00:00.000Z';
    const merged = mergeGardens(base, copy(base), remote, now);
    assert.deepEqual(merged.projects, remote.projects);
    assert.equal(merged.updatedAt, remote.updatedAt);
});

test('edits to two different plants both survive', () => {
    const base = garden([plant('a', 0), plant('b', 1)]);
    const local = copy(base);
    local.projects[0].seed = 'a local';
    const remote = copy(base);
    remote.projects[1].seed = 'b remote';
    const merged = mergeGardens(base, local, remote, now);
    assert.deepEqual(seeds(merged), ['a local', 'b remote']);
    assert.equal(merged.updatedAt, NOW);
});

test('cells added to the same layer on both sides are all kept, local ones where they were put', () => {
    const base = garden([plant('a', 0, { stem: [item('s1')] })]);
    const local = copy(base);
    local.projects[0].stem.unshift(item('L'));
    const remote = copy(base);
    remote.projects[0].stem.push(item('R'));
    const merged = mergeGardens(base, local, remote, now);
    assert.deepEqual(stem(merged), ['L', 's1', 'R']);
});

test('an edit beats a delete, and an untouched delete sticks', () => {
    const base = garden([plant('a', 0, { stem: [item('keep'), item('gone')] })]);
    const local = copy(base);
    local.projects[0].stem[0].content = 'kept and edited';
    local.projects[0].stem.splice(1, 1);
    const remote = copy(base);
    remote.projects[0].stem.splice(0, 1);
    const merged = mergeGardens(base, local, remote, now);
    assert.deepEqual(stem(merged), ['kept and edited']);
});

test('the same field edited on both sides: remote wins', () => {
    const base = garden([plant('a', 0, { stem: [item('s1', 'old')] })]);
    const local = copy(base);
    local.projects[0].stem[0].content = 'mine';
    const remote = copy(base);
    remote.projects[0].stem[0].content = 'theirs';
    assert.deepEqual(stem(mergeGardens(base, local, remote, now)), ['theirs']);
});

test('different fields of one cell edited on each side: both land', () => {
    const base = garden([plant('a', 0, { stem: [item('s1', 'text')] })]);
    const local = copy(base);
    local.projects[0].stem[0].highlighted = true;
    const remote = copy(base);
    remote.projects[0].stem[0].content = 'new text';
    const merged = mergeGardens(base, local, remote, now);
    assert.equal(merged.projects[0].stem[0].content, 'new text');
    assert.equal(merged.projects[0].stem[0].highlighted, true);
});

test('local reorders plants while remote adds one: the new order holds and the new plant is kept', () => {
    const base = garden([plant('a', 0), plant('b', 1)]);
    const local = copy(base);
    local.projects[0].order = 1;
    local.projects[1].order = 0;
    const remote = copy(base);
    remote.projects.push(plant('c', 2));
    const merged = mergeGardens(base, local, remote, now);
    assert.deepEqual(seeds(merged), ['b', 'a', 'c']);
    assert.deepEqual(merged.projects.map(p => p.order), [0, 1, 2]);
});

test('a plant added on the left on both sides keeps both, orders stay dense', () => {
    const base = garden([plant('a', 0)]);
    const local = garden([plant('L', 0), plant('a', 1)]);
    const remote = garden([plant('R', 0), plant('a', 1)]);
    const merged = mergeGardens(base, local, remote, now);
    assert.deepEqual(new Set(seeds(merged)), new Set(['L', 'R', 'a']));
    assert.deepEqual(merged.projects.map(p => p.order), [0, 1, 2]);
    assert.equal(merged.projects[2].seed, 'a');
});

test('a plant recycled remotely and untouched locally is gone; edited locally it stays', () => {
    const base = garden([plant('a', 0), plant('b', 1)]);
    const local = copy(base);
    local.projects[1].stem.push(item('late edit'));
    const remote = garden([]);
    const merged = mergeGardens(base, local, remote, now);
    assert.deepEqual(seeds(merged), ['b']);
});

test('settings changed on one side only are taken from that side', () => {
    const base = garden([]);
    const local = copy(base);
    local.settings.enableAnt = false;
    const remote = copy(base);
    remote.settings.fireflyCount = 3;
    const merged = mergeGardens(base, local, remote, now);
    assert.equal(merged.settings.enableAnt, false);
    assert.equal(merged.settings.fireflyCount, 3);
});

test('no base: union, nothing deleted, local wins field conflicts', () => {
    const local = garden([plant('a', 0, { seed: 'mine', stem: [item('x')] })]);
    const remote = garden([plant('a', 0, { seed: 'theirs', stem: [item('y')] }), plant('b', 1)]);
    const merged = mergeGardens(null, local, remote, now);
    assert.deepEqual(seeds(merged).sort(), ['b', 'mine']);
    assert.deepEqual(new Set(stem(merged, merged.projects.findIndex(p => p.id === 'a'))), new Set(['x', 'y']));
});

test('optional fields removed on one side stay removed', () => {
    const base = garden([plant('a', 0, { seedImagePath: 'seeds/one.png' })]);
    const local = copy(base);
    delete local.projects[0].seedImagePath;
    const merged = mergeGardens(base, local, copy(base), now);
    assert.equal('seedImagePath' in merged.projects[0], false);
});

test('a shared plant merges cell edits from both people and drops garden-only fields', () => {
    const base = plantData(plant('a', 0, { stem: [item('s1')], sharedPlantId: 'p1' }));
    const local = { ...copy(base), stem: [item('mine'), item('s1')] };
    const remote = { ...copy(base), flowers: [item('theirs')] };
    const merged = mergePlant(base, local, remote);
    assert.deepEqual(merged.stem.map(s => s.content), ['mine', 's1']);
    assert.deepEqual(merged.flowers.map(s => s.content), ['theirs']);
    assert.equal('order' in merged, false);
    assert.equal('sharedPlantId' in merged, false);
});

test('a plant tagged on this device keeps its tags when the other side changed something else', () => {
    const base = garden([plant('a', 0), plant('b', 1)]);
    const local = copy(base);
    local.projects[0].tags = ['work'];
    const remote = copy(base);
    remote.projects[1].seed = 'renamed';
    const merged = mergeGardens(base, local, remote, now);
    assert.deepEqual(merged.projects[0].tags, ['work']);
    assert.equal(merged.projects[1].seed, 'renamed');
});

test('tags taken off on one side stay off', () => {
    const base = garden([plant('a', 0, { tags: ['work'] })]);
    const local = copy(base);
    delete local.projects[0].tags;
    const merged = mergeGardens(base, local, copy(base), now);
    assert.equal('tags' in merged.projects[0], false);
});
