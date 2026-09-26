import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitHeight } from './split';

test('a divider leaves room for both panes and its actual touch height', () => {
    assert.equal(splitHeight(844, 12, 542), 542);
    assert.equal(splitHeight(844, 12, -50), 100);
    assert.equal(splitHeight(844, 12, 900), 732);
    assert.equal(splitHeight(844, 4, 900), 740);
});
test('a short viewport does not create a negative or overflowing pane', () => {
    assert.equal(splitHeight(150, 12, 140), 69);
    assert.equal(splitHeight(8, 12, 4), 0);
    assert.equal(splitHeight(0, 12, 100), 0);
    assert.equal(splitHeight(Number.NaN, 12, 100), 0);
    assert.equal(splitHeight(800, 12, Number.NaN), 394);
});
