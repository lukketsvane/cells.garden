import assert from 'node:assert/strict';
import test from 'node:test';
import { allAssigned, assignedLabel, assigneesOf, assignNotice, clip, newlyAssigned, toggleAssignee } from './assign';
import { markdownToProject, projectToMarkdown } from './markdown';
import { mergeGardens, mergePlant, plantData } from './merge';
import { DEFAULT_SETTINGS, type Garden, type LayerItem, type ProjectData } from './model';

const ANA = '11111111-1111-4111-8111-111111111111';
const BO = '22222222-2222-4222-8222-222222222222';
const CY = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-09-23T12:00:00.000Z';

function item(id: string, extra: Partial<LayerItem> = {}): LayerItem {
    return { id, content: id, isComplete: false, ...extra };
}

function plant(id: string, extra: Partial<ProjectData> = {}): ProjectData {
    return { id, name: id, seed: id, standby: false, hue: 0, order: 0, plantType: 'plant_1', flowers: [], stem: [], roots: [], minerals: [], ...extra };
}

function garden(projects: ProjectData[]): Garden {
    return { version: 1, projects, settings: { ...DEFAULT_SETTINGS }, updatedAt: '2026-09-23T10:00:00.000Z' };
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

test('a stored cell names its people once each, in order; junk is left out', () => {
    assert.deepEqual(assigneesOf(item('a')), []);
    assert.deepEqual(assigneesOf(null), []);
    assert.deepEqual(assigneesOf({ assignees: 'nope' }), []);
    assert.deepEqual(assigneesOf({ assignees: [ANA, 7, '', null, BO, ANA, 'x'.repeat(65)] }), [ANA, BO]);
});

test('one tap assigns a person to every cell of a selection, the next takes them off every one', () => {
    const a = item('a');
    const b = item('b', { assignees: [ANA] });
    const gained = toggleAssignee([a, b], ANA);
    assert.deepEqual(gained, [a], 'only the cell that did not have them is told about');
    assert.deepEqual(a.assignees, [ANA]);
    assert.deepEqual(b.assignees, [ANA]);
    assert.equal(allAssigned([a, b], ANA), true);

    assert.deepEqual(toggleAssignee([a, b], ANA), []);
    assert.equal('assignees' in a, false, 'nobody left: the field goes, as on a cell that never had any');
    assert.equal('assignees' in b, false);
});

test('others already on a cell stay when someone is added or taken off', () => {
    const a = item('a', { assignees: [BO] });
    toggleAssignee([a], ANA);
    assert.deepEqual(a.assignees, [BO, ANA]);
    toggleAssignee([a], BO);
    assert.deepEqual(a.assignees, [ANA]);
});

test('only the people just added are told, never yourself', () => {
    assert.deepEqual(newlyAssigned([ANA], [ANA, BO, CY], CY), [BO]);
    assert.deepEqual(newlyAssigned([], [ANA], ANA), []);
});

test('the notify request: trimmed text, the garden and plant, and nothing when there is nobody to tell', () => {
    const notice = assignNotice({
        me: ANA,
        added: [BO, ANA, BO],
        gardenId: 'g-1',
        plantId: undefined,
        projectId: 'proj_1',
        itemId: 'item_1',
        text: `  Water the\n tomatoes ${'x'.repeat(200)}`,
        where: 'Tomatoes',
    });
    assert.ok(notice);
    assert.deepEqual(notice.recipients, [BO]);
    assert.equal(notice.gardenId, 'g-1');
    assert.equal('plantId' in notice, false);
    assert.equal(notice.text.length, 140);
    assert.ok(notice.text.startsWith('Water the tomatoes x') && notice.text.endsWith('…'));
    assert.equal(assignNotice({ me: ANA, added: [ANA], gardenId: 'g', projectId: 'p', itemId: 'i', text: '', where: '' }), null);
    assert.equal(assignNotice({ me: ANA, added: [BO], projectId: 'p', itemId: 'i', text: '', where: '' }), null, 'no garden and no plant: nowhere to check');
    assert.equal(clip('  a  b ', 10), 'a b');
});

test('the label names everyone', () => {
    assert.equal(assignedLabel([]), '');
    assert.equal(assignedLabel(['Ana']), 'Assigned to Ana');
    assert.equal(assignedLabel(['Ana', 'you']), 'Assigned to Ana and you');
    assert.equal(assignedLabel(['Ana', 'Bo', 'Cy', 'Dee']), 'Assigned to Ana, Bo, Cy and Dee');
});

// --- Travelling with the cell ---------------------------------------------------

test('an assignment on one device and an edit of the same cell on another both survive the merge', () => {
    const base = garden([plant('p', { stem: [item('s1')] })]);
    const local = copy(base);
    local.projects[0].stem[0].assignees = [ANA];
    const remote = copy(base);
    remote.projects[0].stem[0].content = 'edited elsewhere';
    const merged = mergeGardens(base, local, remote, () => NOW);
    assert.deepEqual(merged.projects[0].stem[0].assignees, [ANA]);
    assert.equal(merged.projects[0].stem[0].content, 'edited elsewhere');
});

test('assignees are one field of the cell: changed on both sides, the other side wins as for any field', () => {
    const base = garden([plant('p', { stem: [item('s1', { assignees: [ANA] })] })]);
    const local = copy(base);
    local.projects[0].stem[0].assignees = [ANA, BO];
    const remote = copy(base);
    remote.projects[0].stem[0].assignees = [ANA, CY];
    assert.deepEqual(mergeGardens(base, local, remote, () => NOW).projects[0].stem[0].assignees, [ANA, CY]);
    // Taken off everyone on one side, untouched on the other: the change wins.
    const cleared = copy(base);
    delete cleared.projects[0].stem[0].assignees;
    assert.equal(mergeGardens(base, cleared, copy(base), () => NOW).projects[0].stem[0].assignees, undefined);
});

test('a client that predates assignees keeps them: they are a field it merges without knowing it', () => {
    // What such a client holds and saves is the stored JSON, extra fields and all.
    const stored = copy(garden([plant('p', { flowers: [item('f1', { assignees: [ANA] })] })]));
    const loaded = copy(stored);
    const edited = copy(loaded);
    edited.projects[0].flowers[0].content = 'renamed by an old client';
    const merged = mergeGardens(loaded, edited, loaded, () => NOW);
    assert.deepEqual(merged.projects[0].flowers[0].assignees, [ANA]);
});

test('a shared plant carries assignees to everyone who has it', () => {
    const base = plantData(plant('p', { roots: [item('r1')] }));
    const local = copy(base);
    local.roots[0].assignees = [BO];
    const remote = copy(base);
    remote.roots.push(item('r2'));
    const merged = mergePlant(base, local, remote);
    assert.deepEqual(merged.roots.map(r => [r.id, r.assignees]), [['r1', [BO]], ['r2', undefined]]);
});

test('an exported plant file carries assignees and reads them back; a plant without any keeps the plugin bytes', () => {
    const p = plant('p', {
        stem: [item('s1'), item('s2', { assignees: [ANA, BO] })],
        minerals: [item('m1', { assignees: [CY] })],
    });
    const md = projectToMarkdown(p);
    assert.match(md, /^assignees:\n {2}flowers: \[\]\n {2}stem: \[\[\], \["1111/m);
    const back = markdownToProject(md, 'p');
    assert.ok(back);
    assert.deepEqual(back.stem.map(s => s.assignees), [undefined, [ANA, BO]]);
    assert.deepEqual(back.minerals.map(s => s.assignees), [[CY]]);

    const plain = projectToMarkdown(plant('q', { stem: [item('s1')] }));
    assert.ok(!plain.includes('assignees'), 'no key at all when nobody is assigned');
});
