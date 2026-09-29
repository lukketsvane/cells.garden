import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanTag, gardenTags, hasTag, isHidden, MAX_TAG_LENGTH, setTag, tagKey, tagsOf } from './tags';

test('a tag is kept trimmed, with single spaces, and no longer than the limit', () => {
    assert.equal(cleanTag('  deep   work \n'), 'deep work');
    assert.equal(cleanTag('   '), '');
    assert.equal(cleanTag('x'.repeat(MAX_TAG_LENGTH + 10)).length, MAX_TAG_LENGTH);
    assert.equal(cleanTag(`${'a'.repeat(MAX_TAG_LENGTH - 1)} b`), 'a'.repeat(MAX_TAG_LENGTH - 1));
    assert.equal(tagKey(' Work '), 'work');
});

test('a plant\'s tags are read clean, each once whatever the case, and junk is passed over', () => {
    const project = { tags: ['Work', ' work ', 'home', '', 3, null, 'Home'] as unknown as string[] };
    assert.deepEqual(tagsOf(project), ['Work', 'home']);
    assert.deepEqual(tagsOf({}), []);
    assert.deepEqual(tagsOf({ tags: 'work' as unknown as string[] }), []);
    assert.ok(hasTag(project, 'WORK'));
    assert.ok(!hasTag(project, 'play'));
});

test('putting a tag on and taking it off leaves no empty list behind', () => {
    const project: { tags?: string[] } = {};
    setTag(project, ' work ', true);
    setTag(project, 'Work', true); // already on, as it was written first
    setTag(project, 'home', true);
    assert.deepEqual(project.tags, ['work', 'home']);
    setTag(project, 'WORK', false);
    setTag(project, 'home', false);
    assert.equal('tags' in project, false);
    setTag(project, '   ', true);
    assert.equal('tags' in project, false);
});

test('the garden\'s tags are each tag once, first spelling, in alphabetical order', () => {
    const garden = [{ tags: ['work', 'Zoo'] }, {}, { tags: ['Work', 'apples'] }];
    assert.deepEqual(gardenTags(garden), ['apples', 'work', 'Zoo']);
});

test('a plant is hidden when one of its tags is', () => {
    const hidden = new Set(['work']);
    assert.ok(isHidden({ tags: ['home', 'Work'] }, hidden));
    assert.ok(!isHidden({ tags: ['home'] }, hidden));
    assert.ok(!isHidden({}, hidden));
    assert.ok(!isHidden({ tags: ['work'] }, new Set()));
});
