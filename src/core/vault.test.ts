import assert from 'node:assert/strict';
import test from 'node:test';
import { ASSET_FOLDER, PLANT_FOLDER } from './markdown';
import { DEFAULT_SETTINGS, type Garden, type LayerItem, type ProjectData } from './model';
import {
    archiveFileName,
    CUSTOM_PREFIX,
    gardenToVaultFiles,
    mergeGarden,
    SETTINGS_FILE,
    vaultFilesToGarden,
    type VaultFile,
} from './vault';

const enc = new TextEncoder();
const dec = new TextDecoder();

function item(content: string, extra: Partial<LayerItem> = {}): LayerItem {
    return { id: 'item_' + content, content, isComplete: false, ...extra };
}

function plant(extra: Partial<ProjectData> = {}): ProjectData {
    return {
        id: 'plant_1700000000000',
        name: 'Port the garden',
        seed: 'Port the garden',
        standby: false,
        hue: 0,
        order: 0,
        plantType: 'plant_1',
        flowers: [],
        stem: [],
        roots: [],
        minerals: [],
        ...extra,
    };
}

function garden(projects: ProjectData[], settings = DEFAULT_SETTINGS): Garden {
    return { version: 1, projects, settings, updatedAt: '2026-09-17T06:00:00.000Z' };
}

function pathsOf(files: VaultFile[]): string[] {
    return files.map(f => f.path);
}

function fileNamed(files: VaultFile[], path: string): VaultFile {
    const found = files.find(f => f.path === path);
    assert.ok(found, `no file at ${path}; got ${pathsOf(files).join(', ')}`);
    return found;
}

// --- Export ---------------------------------------------------------------

test('a garden becomes a vault folder the plugin can read', () => {
    const files = gardenToVaultFiles(garden([
        plant({ id: 'a', seed: 'Second', order: 1 }),
        plant({ id: 'b', seed: 'First', order: 0 }),
    ]));

    // Ordered by column, so the folder listing matches the garden.
    assert.deepEqual(pathsOf(files), [
        `${PLANT_FOLDER}/First.md`,
        `${PLANT_FOLDER}/Second.md`,
        SETTINGS_FILE,
    ]);
    assert.match(dec.decode(fileNamed(files, `${PLANT_FOLDER}/First.md`).bytes), /^---\n/);
});

test('plants that reduce to the same file name each get their own', () => {
    const files = gardenToVaultFiles(garden([
        plant({ id: 'a', seed: 'Same/name?', order: 0 }),
        plant({ id: 'b', seed: 'Same name', order: 1 }),
        plant({ id: 'c', seed: '???', order: 2 }),
        plant({ id: 'd', seed: '!!!', order: 3 }),
    ]));

    assert.deepEqual(pathsOf(files).filter(p => p.endsWith('.md')), [
        `${PLANT_FOLDER}/Samename.md`,
        `${PLANT_FOLDER}/Same name.md`,
        `${PLANT_FOLDER}/Untitled Plant.md`,
        `${PLANT_FOLDER}/Untitled Plant 2.md`,
    ]);
});

test('the settings file carries the settings but never the camera', () => {
    const settings = { ...DEFAULT_SETTINGS, fireflyCount: 3, viewState: { zoom: 2, translateX: 10, translateY: 20, kanbanScrollLeft: 0, kanbanScrollTop: 0 } };
    const files = gardenToVaultFiles(garden([], settings), new Date('2026-09-17T06:00:00.000Z'));

    const parsed = JSON.parse(dec.decode(fileNamed(files, SETTINGS_FILE).bytes));
    assert.equal(parsed.version, 1);
    assert.equal(parsed.exportedAt, '2026-09-17T06:00:00.000Z');
    assert.equal(parsed.settings.fireflyCount, 3);
    assert.ok(!('viewState' in parsed.settings), 'the camera is per device and must not travel');
});

test('the archive is named after the day it was made', () => {
    assert.equal(archiveFileName(new Date(2026, 8, 7)), 'cells.garden-2026-09-07.zip');
});

// --- Import ---------------------------------------------------------------

test('a whole vault, a lone note and our own archive all import', () => {
    const files = gardenToVaultFiles(garden([plant({ id: 'a', seed: 'Alpha' })]));
    const note = fileNamed(files, `${PLANT_FOLDER}/Alpha.md`);

    // Nested inside a vault, alongside files that are none of our business.
    const nested = vaultFilesToGarden([
        { path: `MyVault/${PLANT_FOLDER}/${note.path.split('/').pop()}`, bytes: note.bytes },
        { path: 'MyVault/.obsidian/workspace.json', bytes: enc.encode('{}') },
        { path: 'MyVault/Daily/2026-09-17.md', bytes: enc.encode('# not a plant') },
    ]);
    assert.equal(nested.projects.length, 1);
    assert.equal(nested.projects[0].seed, 'Alpha');
    // The note that is not a garden cell is reported, not swallowed.
    assert.ok(nested.skipped.some(p => p.endsWith('2026-09-17.md')));

    // The bare file, with no folder at all.
    const lone = vaultFilesToGarden([{ path: 'Alpha.md', bytes: note.bytes }]);
    assert.equal(lone.projects.length, 1);
});

test('an export reads back as the garden it came from', () => {
    const before = [
        plant({ id: 'a', seed: 'Alpha', order: 0, hue: 120, stem: [item('one'), item('two', { highlighted: true })] }),
        plant({ id: 'b', seed: 'Beta', order: 1, standby: true, flowers: [item('bloom')] }),
    ];
    const files = gardenToVaultFiles(garden(before, { ...DEFAULT_SETTINGS, fireflyCount: 4 }));
    const after = vaultFilesToGarden(files);

    assert.deepEqual(after.projects.map(p => [p.id, p.seed, p.order]), [['a', 'Alpha', 0], ['b', 'Beta', 1]]);
    assert.equal(after.projects[0].hue, 120);
    assert.equal(after.projects[0].stem[1].highlighted, true);
    assert.equal(after.projects[1].standby, true);
    assert.equal(after.settings?.fireflyCount, 4);
    assert.deepEqual(after.skipped, []);
});

test('custom art comes back under its pack-relative path', () => {
    const png = new Uint8Array([1, 2, 3]);
    const result = vaultFilesToGarden([
        { path: `MyVault/${ASSET_FOLDER}/${CUSTOM_PREFIX}abc123.png`, bytes: png },
        { path: `${ASSET_FOLDER}/plant_1/stem/plant_1_part1.png`, bytes: png },
    ]);

    assert.deepEqual([...result.assets.keys()], [`${CUSTOM_PREFIX}abc123.png`]);
    // Pack art is not the user's, so it is not carried back in.
    assert.ok(result.skipped.some(p => p.includes('plant_1_part1.png')));
});

test('hidden files are passed over without being reported', () => {
    const result = vaultFilesToGarden([
        { path: 'MyVault/.DS_Store', bytes: new Uint8Array([0]) },
        { path: 'MyVault/.obsidian/.hidden', bytes: new Uint8Array([0]) },
    ]);
    assert.deepEqual(result.projects, []);
    assert.deepEqual(result.skipped, []);
});

test('a damaged settings file leaves the defaults alone', () => {
    const result = vaultFilesToGarden([{ path: SETTINGS_FILE, bytes: enc.encode('{ not json') }]);
    assert.equal(result.settings, null);
});

test('a settings file fills in anything a newer version added', () => {
    const result = vaultFilesToGarden([{
        path: SETTINGS_FILE,
        bytes: enc.encode(JSON.stringify({ version: 1, settings: { enableAnt: false, viewState: { zoom: 9 } } })),
    }]);

    assert.equal(result.settings?.enableAnt, false);
    assert.equal(result.settings?.fireflyCount, DEFAULT_SETTINGS.fireflyCount);
    assert.ok(!result.settings?.viewState, 'an imported camera must not move this device');
});

test('files arrive in column order however the archive listed them', () => {
    const files = gardenToVaultFiles(garden([
        plant({ id: 'a', seed: 'Alpha', order: 0 }),
        plant({ id: 'b', seed: 'Beta', order: 1 }),
    ]));
    const result = vaultFilesToGarden([...files].reverse());
    assert.deepEqual(result.projects.map(p => p.seed), ['Alpha', 'Beta']);
});

// --- Merging --------------------------------------------------------------

function importOf(projects: ProjectData[]) {
    return { projects, settings: null, assets: new Map(), skipped: [] };
}

test('merge updates a plant that came from here and plants the rest after it', () => {
    const current = garden([
        plant({ id: 'a', seed: 'Alpha', order: 0, hue: 10 }),
        plant({ id: 'b', seed: 'Beta', order: 1 }),
    ]);
    const { garden: next, summary } = mergeGarden(current, importOf([
        plant({ id: 'a', seed: 'Alpha, edited', order: 7, hue: 200 }),
        plant({ id: 'c', seed: 'Gamma', order: 0 }),
    ]), 'merge');

    assert.deepEqual(summary, { added: 1, updated: 1 });
    assert.deepEqual(next.projects.map(p => [p.seed, p.order]), [
        ['Alpha, edited', 0],
        ['Beta', 1],
        ['Gamma', 2],
    ]);
    // The file decided the contents; the garden kept the column.
    assert.equal(next.projects[0].hue, 200);
});

test('merge keeps the settings this device is using', () => {
    const current = garden([], { ...DEFAULT_SETTINGS, fireflyCount: 2 });
    const incoming = { ...importOf([]), settings: { ...DEFAULT_SETTINGS, fireflyCount: 30 } };
    const { garden: next } = mergeGarden(current, incoming, 'merge');
    assert.equal(next.settings.fireflyCount, 2);
});

test('replace throws the open garden away and takes the settings too', () => {
    const current = garden([plant({ id: 'a', seed: 'Alpha' })], { ...DEFAULT_SETTINGS, fireflyCount: 2 });
    const incoming = {
        ...importOf([plant({ id: 'x', seed: 'X', order: 5 }), plant({ id: 'y', seed: 'Y', order: 9 })]),
        settings: { ...DEFAULT_SETTINGS, fireflyCount: 30 },
    };
    const { garden: next, summary } = mergeGarden(current, incoming, 'replace');

    assert.deepEqual(summary, { added: 2, updated: 0 });
    assert.deepEqual(next.projects.map(p => [p.seed, p.order]), [['X', 0], ['Y', 1]]);
    assert.equal(next.settings.fireflyCount, 30);
});

test('replace with no settings file keeps the ones already in use', () => {
    const current = garden([], { ...DEFAULT_SETTINGS, fireflyCount: 2 });
    const { garden: next } = mergeGarden(current, importOf([]), 'replace');
    assert.equal(next.settings.fireflyCount, 2);
});

test('importing the same files twice changes nothing the second time', () => {
    const first = garden([plant({ id: 'a', seed: 'Alpha' })]);
    const incoming = importOf([plant({ id: 'a', seed: 'Alpha' })]);

    const once = mergeGarden(first, incoming, 'merge');
    const twice = mergeGarden(once.garden, incoming, 'merge');

    assert.deepEqual(twice.summary, { added: 0, updated: 1 });
    assert.deepEqual(twice.garden.projects.map(p => p.id), ['a']);
});
