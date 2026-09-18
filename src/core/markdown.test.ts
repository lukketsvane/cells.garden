import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ASSET_FOLDER,
    fromVaultAssetPath,
    markdownToProject,
    projectFileName,
    projectToMarkdown,
    toVaultAssetPath,
} from './markdown';
import type { LayerItem, ProjectData } from './model';

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

/**
 * What a round trip is allowed to change: item ids are rebuilt from content,
 * `isComplete` is not in the format at all, and `name` becomes the file name.
 */
function comparable(p: ProjectData) {
    const layer = (items: LayerItem[]) =>
        items.map(({ content, imagePath, highlighted }) => ({ content, imagePath, highlighted: highlighted || undefined }));
    return {
        id: p.id,
        seed: p.seed,
        standby: p.standby,
        hue: p.hue,
        order: p.order,
        plantType: p.plantType,
        seedImagePath: p.seedImagePath,
        flowers: layer(p.flowers),
        stem: layer(p.stem),
        roots: layer(p.roots),
        minerals: layer(p.minerals),
    };
}

function roundTrip(p: ProjectData): ProjectData {
    const md = projectToMarkdown(p);
    const back = markdownToProject(md, projectFileName(p).replace(/\.md$/, ''));
    assert.ok(back, 'the file we just wrote did not parse back');
    return back;
}

// --- The format itself ----------------------------------------------------

test('a plant writes the frontmatter and sections the plugin writes', () => {
    const md = projectToMarkdown(plant({
        flowers: [item('Runs in a browser')],
        stem: [item('Scaffold'), item('Shim')],
        roots: [item('Friends can use it')],
        minerals: [item('Supabase sync')],
    }));

    assert.equal(md, [
        '---',
        'id: plant_1700000000000',
        'type: garden-cell',
        'seed: "Port the garden"',
        'hue: 0',
        'order: 0',
        'plantType: plant_1',
        'images:',
        '  flowers: [""]',
        '  stem: ["", ""]',
        '  roots: [""]',
        '  minerals: [""]',
        '---',
        '',
        '## Flowers',
        '- Runs in a browser',
        '',
        '## Stem',
        '- Scaffold',
        '- Shim',
        '',
        '## Roots',
        '- Friends can use it',
        '',
        '## Minerals',
        '- Supabase sync',
    ].join('\n'));
});

test('an empty plant is still a valid file', () => {
    const md = projectToMarkdown(plant());
    assert.ok(md.endsWith('---\n'), md.slice(-20));
    assert.deepEqual(comparable(roundTrip(plant())), comparable(plant()));
});

// --- Round trips ----------------------------------------------------------

test('every field survives a round trip', () => {
    const p = plant({
        seed: 'Ship M3',
        hue: 214,
        order: 3,
        standby: true,
        plantType: 'plant_2',
        seedImagePath: 'seeds/seed_2.png',
        flowers: [item('Done', { imagePath: 'plant_2/flowers/f1.png', highlighted: true })],
        stem: [item('Doing', { imagePath: 'plant_2/stem/s1.png' }), item('No art yet')],
        roots: [item('Why')],
        minerals: [item('Notes', { imagePath: 'minerals/m3.png' })],
    });
    assert.deepEqual(comparable(roundTrip(p)), comparable(p));
});

test('a seed full of characters that break hand-rolled YAML survives', () => {
    for (const seed of [
        'Quotes "inside" the title',
        'A backslash C:\\Users\\Iver',
        'Colons: everywhere: here',
        'Trailing hash # and a - dash',
        'Norsk: blåbærsyltetøy 🌱',
        '{ braces } [ brackets ] & ampersands',
        "It's an apostrophe",
        '*emphasis* and **strong**',
        '---',
        '  leading and trailing spaces  ',
    ]) {
        const back = roundTrip(plant({ seed }));
        assert.equal(back.seed, seed, `seed did not survive: ${JSON.stringify(seed)}`);
    }
});

test('a multi-line seed is flattened to one line, as the plugin does', () => {
    const back = roundTrip(plant({ seed: 'First line\nsecond line' }));
    assert.equal(back.seed, 'First line second line');
});

test('a cell holding a line break stays one cell', () => {
    const p = plant({ stem: [item('before\nafter'), item('next')] });
    const back = roundTrip(p);
    assert.deepEqual(back.stem.map(i => i.content), ['before after', 'next']);
});

test('highlighted cells round trip, and so does a cell that merely looks bold', () => {
    const back = roundTrip(plant({
        stem: [item('Important', { highlighted: true }), item('Ordinary')],
    }));
    assert.deepEqual(back.stem.map(i => [i.content, i.highlighted ?? false]), [['Important', true], ['Ordinary', false]]);
});

test('an emptied cell is not silently dropped', () => {
    const back = roundTrip(plant({ stem: [item('One'), item(''), item('Three')] }));
    assert.deepEqual(back.stem.map(i => i.content), ['One', '', 'Three']);
});

test('image paths stay lined up when only some cells have art', () => {
    const p = plant({
        stem: [item('a', { imagePath: 'plant_1/stem/p1.png' }), item('b'), item('c', { imagePath: 'plant_1/stem/p3.png' })],
    });
    const back = roundTrip(p);
    assert.deepEqual(back.stem.map(i => i.imagePath), ['plant_1/stem/p1.png', undefined, 'plant_1/stem/p3.png']);
});

// --- Vault paths ----------------------------------------------------------

test('art is written as a vault path and read back as a pack path', () => {
    const md = projectToMarkdown(plant({
        seedImagePath: 'seeds/seed_1.png',
        stem: [item('a', { imagePath: 'plant_1/stem/p1.png' })],
    }));
    assert.match(md, /seedImagePath: "Garden-Assets\/seeds\/seed_1\.png"/);
    assert.match(md, /stem: \["Garden-Assets\/plant_1\/stem\/p1\.png"\]/);

    const back = markdownToProject(md, 'Port the garden');
    assert.equal(back?.seedImagePath, 'seeds/seed_1.png');
    assert.equal(back?.stem[0].imagePath, 'plant_1/stem/p1.png');
});

test('the prefix is added once and stripped once', () => {
    assert.equal(toVaultAssetPath('a/b.png'), `${ASSET_FOLDER}/a/b.png`);
    assert.equal(toVaultAssetPath(`${ASSET_FOLDER}/a/b.png`), `${ASSET_FOLDER}/a/b.png`);
    assert.equal(fromVaultAssetPath(`${ASSET_FOLDER}/a/b.png`), 'a/b.png');
    assert.equal(fromVaultAssetPath('a/b.png'), 'a/b.png');
    assert.equal(fromVaultAssetPath(`./${ASSET_FOLDER}/a/b.png`), 'a/b.png');
    assert.equal(fromVaultAssetPath(`${ASSET_FOLDER}\\a\\b.png`), 'a/b.png');
});

// --- Reading other people's files ----------------------------------------

test('a note that is not a garden cell is refused', () => {
    assert.equal(markdownToProject('# Just a note\n\nSome text.', 'Note'), null);
    assert.equal(markdownToProject('---\ntags: [x]\n---\n\nHi', 'Note'), null);
});

test('broken frontmatter is refused rather than half-read', () => {
    assert.equal(markdownToProject('---\nid: a\n  bad: [indent\ntype: garden-cell\n---\n', 'Broken'), null);
});

test('CRLF files from a Windows vault read the same', () => {
    const md = projectToMarkdown(plant({ stem: [item('a'), item('b')] })).replace(/\n/g, '\r\n');
    const back = markdownToProject(md, 'Port the garden');
    assert.deepEqual(back?.stem.map(i => i.content), ['a', 'b']);
});

test('the old frontmatter-array format still imports', () => {
    const md = [
        '---',
        'id: old_1',
        'type: garden-cell',
        'seed: "An old plant"',
        'hue: 12',
        'flowers:',
        '  - id: f1',
        '    content: Bloom',
        '    isComplete: true',
        'roots:',
        '  - id: r1',
        '    content: Deep',
        `    imagePath: ${ASSET_FOLDER}/roots/r1.png`,
        '  - id: r2',
        '    content: Deeper',
        '---',
        '',
    ].join('\n');
    const back = markdownToProject(md, 'An old plant');
    assert.equal(back?.id, 'old_1');
    assert.equal(back?.hue, 12);
    assert.deepEqual(back?.flowers.map(i => i.content), ['Bloom']);
    // The old format stored roots bottom-up.
    assert.deepEqual(back?.roots.map(i => i.content), ['Deeper', 'Deep']);
    assert.equal(back?.roots[1].imagePath, 'roots/r1.png');
});

test('a checkbox list from an older file still reads', () => {
    const md = [
        '---', 'id: c1', 'type: garden-cell', 'seed: "Checkboxes"', 'hue: 0', 'order: 0', 'plantType: plant_1',
        'images:', '  stem: ["", ""]', '---', '', '## Stem', '- [ ] todo', '- [x] done', '',
    ].join('\n');
    assert.deepEqual(markdownToProject(md, 'Checkboxes')?.stem.map(i => i.content), ['todo', 'done']);
});

test('two files with no id get different ids', () => {
    const md = '---\ntype: garden-cell\nseed: "No id"\nimages:\n---\n';
    const a = markdownToProject(md, 'A');
    const b = markdownToProject(md, 'B');
    assert.ok(a && b);
    assert.notEqual(a.id, b.id);
});

test('a missing seed falls back to the file name', () => {
    const back = markdownToProject('---\nid: x\ntype: garden-cell\nimages:\n---\n', 'From the file name');
    assert.equal(back?.seed, 'From the file name');
});

// --- The YAML reader ------------------------------------------------------
// These pin what js-yaml's default schema returned, which the reader keeps.

/** A file shaped the way Max's plugin writes it: quotes escaped, nothing else. */
function maxFile(frontmatter: string[], body: string[] = []): string {
    return ['---', ...frontmatter, '---', ...(body.length ? ['', ...body] : [])].join('\n');
}

test('a file written by Max\'s plugin reads field by field', () => {
    const back = markdownToProject(maxFile([
        'id: proj_1712345678901',
        'type: garden-cell',
        'seed: "Say \\"hi\\" to the garden"',
        'hue: 214',
        'order: 3',
        'plantType: plant_2',
        `seedImagePath: "${ASSET_FOLDER}/seeds/seed_2.png"`,
        'standby: true',
        'images:',
        `  flowers: ["${ASSET_FOLDER}/plant_2/flowers/f1.png"]`,
        '  stem: ["", ""]',
        '  roots: []',
        '  minerals: []',
    ], ['## Flowers', '- **Done**', '', '## Stem', '- One', '- Two']), 'Say hi to the garden');
    assert.ok(back);
    assert.deepEqual(comparable(back), {
        id: 'proj_1712345678901',
        seed: 'Say "hi" to the garden',
        standby: true,
        hue: 214,
        order: 3,
        plantType: 'plant_2',
        seedImagePath: 'seeds/seed_2.png',
        flowers: [{ content: 'Done', imagePath: 'plant_2/flowers/f1.png', highlighted: true }],
        stem: [{ content: 'One', imagePath: undefined, highlighted: undefined }, { content: 'Two', imagePath: undefined, highlighted: undefined }],
        roots: [],
        minerals: [],
    });
});

test('scalars resolve as js-yaml resolved them', () => {
    const read = (lines: string[]) => markdownToProject(maxFile(['type: garden-cell', 'images:', ...lines]), 'File');
    assert.equal(read(['hue: 0x1F'])?.hue, 31);
    assert.equal(read(['hue: 1e3'])?.hue, 1000);
    assert.equal(read(['hue: "12"'])?.hue, 0);
    assert.equal(read(['standby: True'])?.standby, true);
    assert.equal(read(['standby: yes'])?.standby, false);
    assert.equal(read(['id: 12345'])?.id, 12345);
    // A bare date is a Date, not a string, so it is no seed.
    assert.equal(read(['seed: 2024-01-01'])?.seed, 'File');
    assert.ok((read(['id: 2024-01-01'])?.id as unknown) instanceof Date);
    assert.equal(read(['<<: {hue: 7}'])?.hue, 7);
    assert.equal(read(['seed: "a\r b"'])?.seed, 'a b');
});

test('frontmatter js-yaml refused is still refused', () => {
    const read = (lines: string[]) => markdownToProject(maxFile(['type: garden-cell', 'images:', ...lines]), 'File');
    assert.equal(read(['hue: 1', 'hue: 2']), null, 'duplicate key');
    assert.equal(read(['seed: !custom x']), null, 'unknown tag');
    assert.equal(read(['seed: "a\u0001b"']), null, 'control character');
    // Max's plugin does not escape backslashes, so this seed never parsed.
    assert.equal(read(['seed: "C:\\Users\\Iver"']), null, 'bad escape');
});

test('an empty frontmatter is not a garden cell', () => {
    assert.equal(markdownToProject('---\n\n---\n', 'Empty'), null);
    assert.equal(markdownToProject('---\n# only a comment\n---\n', 'Empty'), null);
});

// --- File names -----------------------------------------------------------

test('the file name is the plugin\'s file name', () => {
    assert.equal(projectFileName(plant({ seed: 'Port the garden' })), 'Port the garden.md');
    assert.equal(projectFileName(plant({ seed: 'Blåbær 🌱' })), 'Blbr.md');
    assert.equal(projectFileName(plant({ seed: '🌱' })), 'Untitled Plant.md');
});
