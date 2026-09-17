import assert from 'node:assert/strict';
import test from 'node:test';
import { legacyImagePath } from './asset-paths';

test('the sprites the first web build shipped map onto the vault names', () => {
    assert.equal(legacyImagePath('plant_1/stem/plant_1_part3.png'), 'plant_1/stem/stem3.png');
    assert.equal(legacyImagePath('plant_1/stem/plant_1_part8.png'), 'plant_1/stem/stem8.png');
    assert.equal(legacyImagePath('plant_1/flowers/plant_1_flower1.png'), 'plant_1/flowers/flower1.png');
    assert.equal(legacyImagePath('plant_1/flowers/plant_1_flower4.png'), 'plant_1/flowers/flower4.png');
});

test('a path already in the vault naming is left to the pack', () => {
    assert.equal(legacyImagePath('plant_1/stem/stem3.png'), null);
    assert.equal(legacyImagePath('plant_7/flowers/flower2.png'), null);
    assert.equal(legacyImagePath('minerals/mineral12.png'), null);
    assert.equal(legacyImagePath('seeds/seed4.png'), null);
});

test('the rule stays inside one plant folder', () => {
    assert.equal(legacyImagePath('plant_2/stem/plant_1_part3.png'), null);
    assert.equal(legacyImagePath('plant_1/stem/plant_1_flower3.png'), null);
    assert.equal(legacyImagePath('plant_1/flowers/plant_1_part3.png'), null);
    assert.equal(legacyImagePath('plant_1/roots/plant_1_part3.png'), null);
    assert.equal(legacyImagePath('a/plant_1/stem/plant_1_part3.png'), null);
    assert.equal(legacyImagePath(''), null);
});
