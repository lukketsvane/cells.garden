import assert from 'node:assert/strict';
import test from 'node:test';
import { hourOf, mineralOpacity, skyAt, skyGradient, starsFor, timeOf } from './garden-settings';
import { mergeGardens } from './merge';
import { DEFAULT_SETTINGS, defaultSettings, itemsFrom, settingsFrom, type Garden, type GardenItem, type GardenSettings } from './model';

/** The sky table and the lookup the garden used before it had settings, kept here to compare against. */
const OLD_SKY: { hour: number; color: [number, number, number]; stars: number }[] = [
    { hour: 0, color: [0, 0, 0], stars: 0.35 },
    { hour: 2.5, color: [0, 0, 0], stars: 0.35 },
    { hour: 4, color: [137, 224, 155], stars: 0 },
    { hour: 6, color: [135, 206, 235], stars: 0 },
    { hour: 18, color: [135, 206, 235], stars: 0 },
    { hour: 20, color: [232, 188, 95], stars: 0 },
    { hour: 22, color: [0, 0, 0], stars: 0.35 },
    { hour: 24, color: [0, 0, 0], stars: 0.35 },
];

function oldSkyAt(hour: number) {
    const next = OLD_SKY.findIndex(k => k.hour > hour);
    const to = OLD_SKY[next === -1 ? OLD_SKY.length - 1 : next];
    const from = OLD_SKY[Math.max(0, (next === -1 ? OLD_SKY.length : next) - 1)];
    const span = to.hour - from.hour;
    const t = span > 0 ? (hour - from.hour) / span : 0;
    const mix = (a: number, b: number) => a + (b - a) * t;
    return {
        skyColor: `rgb(${from.color.map((c, i) => Math.round(mix(c, to.color[i]))).join(', ')})`,
        starOpacity: mix(from.stars, to.stars),
    };
}

test('the default sky is the old sky, every minute of the day', () => {
    const settings = defaultSettings();
    for (let minute = 0; minute < 24 * 60; minute++) {
        const hour = minute / 60;
        const got = skyAt(settings, hour);
        const want = oldSkyAt(hour);
        assert.equal(got.skyColor, want.skyColor, `colour at ${timeOf(hour)}`);
        assert.ok(Math.abs(got.starOpacity - want.starOpacity) < 1e-9, `stars at ${timeOf(hour)}`);
    }
});

test('default node 1 is the clear sky, and static mode holds it all day', () => {
    const settings: GardenSettings = { ...defaultSettings(), skyMode: 'static' };
    for (const hour of [0, 3, 12, 21, 23.9]) {
        assert.deepEqual(skyAt(settings, hour), { skyColor: 'rgb(135, 206, 235)', starOpacity: 0 });
    }
    assert.equal(skyGradient(settings), 'linear-gradient(to right, rgb(135, 206, 235), rgb(135, 206, 235))');
});

test('the cycle wraps round midnight between the last node and the first', () => {
    const settings = { skyMode: 'cycle' as const, skyNodes: [{ color: '#ffffff', hour: 20 }, { color: '#000000', hour: 4 }] };
    assert.equal(skyAt(settings, 0).skyColor, 'rgb(128, 128, 128)'); // halfway from 20:00 to 04:00
    assert.equal(skyAt(settings, 22).skyColor, 'rgb(191, 191, 191)');
    assert.equal(skyAt(settings, 12).skyColor, 'rgb(128, 128, 128)'); // halfway from 04:00 to 20:00
    assert.equal(skyAt(settings, 4).skyColor, 'rgb(0, 0, 0)');
    assert.equal(skyAt({ skyMode: 'cycle', skyNodes: [{ color: '#102030', hour: 9 }] }, 17).skyColor, 'rgb(16, 32, 48)');
});

test('broken or missing nodes fall back to the default day', () => {
    const want = skyAt(defaultSettings(), 21);
    assert.deepEqual(skyAt({ skyMode: 'cycle', skyNodes: [] }, 21), want);
    assert.deepEqual(skyAt({ skyMode: 'cycle', skyNodes: [{ color: 'blue', hour: 40 }] as never }, 21), want);
});

test('stars: all out on black, none from a quarter luminance up', () => {
    assert.equal(starsFor([0, 0, 0]), 0.35);
    assert.equal(starsFor([255, 255, 255]), 0);
    assert.ok(starsFor([20, 20, 40]) > 0 && starsFor([20, 20, 40]) < 0.35);
});

test('the day bar puts each node at its hour and closes on midnight', () => {
    const settings = { skyMode: 'cycle' as const, skyNodes: [{ color: '#ffffff', hour: 18 }, { color: '#000000', hour: 6 }] };
    assert.equal(
        skyGradient(settings),
        'linear-gradient(to right, rgb(128, 128, 128) 0%, rgb(0, 0, 0) 25%, rgb(255, 255, 255) 75%, rgb(128, 128, 128) 100%)',
    );
});

test('mineral opacity by depth', () => {
    const off = { mineralFade: false, mineralFadeFrom: 1, mineralFadeMin: 10 };
    assert.equal(mineralOpacity(off, 5, 6), 1);
    const on = { mineralFade: true, mineralFadeFrom: 3, mineralFadeMin: 10 };
    assert.equal(mineralOpacity(on, 0, 5), 1);
    assert.equal(mineralOpacity(on, 1, 5), 1);
    assert.ok(Math.abs(mineralOpacity(on, 2, 5) - 0.7) < 1e-9);
    assert.ok(Math.abs(mineralOpacity(on, 3, 5) - 0.4) < 1e-9);
    assert.ok(Math.abs(mineralOpacity(on, 4, 5) - 0.1) < 1e-9);
    assert.equal(mineralOpacity({ ...on, mineralFadeFrom: 9 }, 4, 5), 1);
});

test('times read and write as HH:MM', () => {
    assert.equal(timeOf(2.5), '02:30');
    assert.equal(timeOf(0), '00:00');
    assert.equal(hourOf('22:15'), 22.25);
    assert.equal(hourOf(''), null);
    assert.equal(hourOf('25:00'), null);
});

test('defaults change nothing that was there: fireflies 8, no fading, today\'s standby', () => {
    assert.equal(DEFAULT_SETTINGS.fireflies, 8);
    assert.equal(DEFAULT_SETTINGS.mineralFade, false);
    assert.equal(DEFAULT_SETTINGS.silhouetteOpacity, 100);
    assert.equal(DEFAULT_SETTINGS.silhouetteColor, '');
    assert.equal(DEFAULT_SETTINGS.standbyHidesMinerals, true);
});

function garden(settings: GardenSettings): Garden {
    return { version: 1, projects: [], settings, updatedAt: '2026-09-17T10:00:00.000Z' };
}

test('garden settings merge field by field', () => {
    const base = garden(defaultSettings());
    const local = garden({ ...defaultSettings(), skyMode: 'static', fireflies: 3 });
    const remote = garden({ ...defaultSettings(), skyNodes: [{ color: '#000000', hour: 1 }], mineralFade: true, fireflies: 12 });
    const merged = mergeGardens(base, local, remote, () => 'now').settings;
    assert.equal(merged.skyMode, 'static');
    assert.deepEqual(merged.skyNodes, [{ color: '#000000', hour: 1 }]);
    assert.equal(merged.mineralFade, true);
    assert.equal(merged.fireflies, 12); // both changed: remote wins
});

test('a garden saved before settings keeps the new ones from the side that has them', () => {
    const { fireflies: _f, skyMode: _m, skyNodes: _n, ...old } = defaultSettings();
    const base = garden(old as GardenSettings);
    const local = garden({ ...defaultSettings(), skyMode: 'static' });
    const merged = mergeGardens(base, local, garden(old as GardenSettings), () => 'now').settings;
    assert.equal(merged.skyMode, 'static');
    assert.equal(merged.fireflies, 8);
});

test('an offline edit survives a base remembered before settings, against a filled remote', () => {
    const { fireflies: _f, skyMode: _m, skyNodes: _n, ...old } = defaultSettings();
    const base = garden(old as GardenSettings);
    const local = garden({ ...defaultSettings(), skyMode: 'static', fireflies: 2 });
    const merged = mergeGardens(base, local, garden(defaultSettings()), () => 'now').settings;
    assert.equal(merged.skyMode, 'static');
    assert.equal(merged.fireflies, 2);
});

test('stored settings fill in the defaults and a broken node list is the default day', () => {
    assert.deepEqual(settingsFrom(undefined), defaultSettings());
    assert.deepEqual(settingsFrom({ skyNodes: null } as never).skyNodes, defaultSettings().skyNodes);
    assert.deepEqual(settingsFrom({ skyNodes: [] }).skyNodes, defaultSettings().skyNodes);
    assert.deepEqual(settingsFrom({ skyNodes: [{ color: '#000000', hour: 1 }], fireflies: 3 }).skyNodes, [{ color: '#000000', hour: 1 }]);
});

// --- Items ---

const gnome = (id: string, x: number, extra: Partial<GardenItem> = {}): GardenItem => ({ id, kind: 'gnome', x, ...extra });
const ids = (settings: GardenSettings) => settings.items.map(i => i.id).sort();
const withItems = (items: GardenItem[], extra: Partial<GardenSettings> = {}): Garden => garden({ ...defaultSettings(), items, ...extra });

test('a garden from before items has none, and no two gardens share the list', () => {
    const { items: _items, ...old } = defaultSettings();
    assert.deepEqual(settingsFrom(old as GardenSettings).items, []);
    assert.deepEqual(DEFAULT_SETTINGS.items, []);
    const a = defaultSettings();
    a.items.push(gnome('g1', 1));
    assert.deepEqual(defaultSettings().items, []);
    assert.deepEqual(settingsFrom(undefined).items, []);
});

test('stored items: malformed ones are dropped, the rest kept as they are', () => {
    const stored: unknown = [
        gnome('g1', 0.5),
        { id: 'p1', kind: 'pumpkin', x: -0.75 },
        null,
        'gnome',
        [1, 2],
        { kind: 'gnome', x: 1 },
        { id: '', kind: 'gnome', x: 1 },
        { id: 7, kind: 'gnome', x: 1 },
        { id: 'k1', x: 1 },
        { id: 'k2', kind: '', x: 1 },
        { id: 'x1', kind: 'gnome' },
        { id: 'x2', kind: 'gnome', x: '1' },
        { id: 'x3', kind: 'gnome', x: Number.NaN },
        { id: 'x4', kind: 'gnome', x: Number.POSITIVE_INFINITY },
        gnome('g1', 9),
    ];
    assert.deepEqual(itemsFrom(stored), [gnome('g1', 0.5), { id: 'p1', kind: 'pumpkin', x: -0.75 }]);
    assert.deepEqual(settingsFrom({ items: stored } as never).items, itemsFrom(stored));
    assert.deepEqual(itemsFrom('not a list'), []);
    assert.deepEqual(itemsFrom({ g1: gnome('g1', 1) }), []);
});

test('an item of a kind this client does not know, and fields it does not know, survive', () => {
    const frog = { id: 'f1', kind: 'frog-statue', x: 2, tilt: 3 };
    assert.deepEqual(settingsFrom({ items: [frog] } as never).items, [frog]);
});

test('items placed on two devices at once are all kept', () => {
    const base = withItems([gnome('g1', 1)]);
    const local = withItems([gnome('g1', 1), gnome('L', 2)]);
    const remote = withItems([gnome('g1', 1), { id: 'R', kind: 'pumpkin', x: 3 }]);
    const merged = mergeGardens(base, local, remote, () => 'now').settings;
    assert.deepEqual(ids(merged), ['L', 'R', 'g1']);
});

test('an item moved on one side lands there, beside one added on the other', () => {
    const base = withItems([gnome('g1', 1)]);
    const local = withItems([gnome('g1', 4.25)]);
    const remote = withItems([gnome('g1', 1), gnome('R', 0)]);
    const merged = mergeGardens(base, local, remote, () => 'now').settings;
    assert.equal(merged.items.find(i => i.id === 'g1')?.x, 4.25);
    assert.deepEqual(ids(merged), ['R', 'g1']);
});

test('an item moved on both sides: remote wins', () => {
    const base = withItems([gnome('g1', 1)]);
    const merged = mergeGardens(base, withItems([gnome('g1', 2)]), withItems([gnome('g1', 3)]), () => 'now').settings;
    assert.deepEqual(merged.items, [gnome('g1', 3)]);
});

test('a removed item stays removed, unless the other side moved it meanwhile', () => {
    const base = withItems([gnome('gone', 1), gnome('moved', 2)]);
    const local = withItems([]);
    const remote = withItems([gnome('gone', 1), gnome('moved', 5)]);
    const merged = mergeGardens(base, local, remote, () => 'now').settings;
    assert.deepEqual(merged.items, [gnome('moved', 5)]);
});

test('items placed offline survive a base and a remote from before items', () => {
    const { items: _items, ...old } = defaultSettings();
    const base = garden(old as GardenSettings);
    const local = withItems([gnome('g1', 1)]);
    const merged = mergeGardens(base, local, garden(old as GardenSettings), () => 'now').settings;
    assert.deepEqual(merged.items, [gnome('g1', 1)]);
});

test('with no base the items are a union, and malformed ones never get in', () => {
    const local = withItems([gnome('L', 1)]);
    const remote = garden({ ...defaultSettings(), items: [gnome('R', 2), { id: 'bad', kind: 'gnome' }] as never });
    const merged = mergeGardens(null, local, remote, () => 'now').settings;
    assert.deepEqual(ids(merged), ['L', 'R']);
});

test('item and pet settings merge alongside the rest, pet switches this client does not know included', () => {
    const base = withItems([]);
    const local = withItems([gnome('g1', 1)], { petCrow: true });
    const remote = garden({ ...defaultSettings(), petFrog: true } as GardenSettings);
    const merged = mergeGardens(base, local, remote, () => 'now').settings as GardenSettings & { petFrog?: boolean };
    assert.equal(merged.petCrow, true);
    assert.equal(merged.petFrog, true);
    assert.deepEqual(merged.items, [gnome('g1', 1)]);
    // Old gardens' pet switches are still carried.
    assert.equal(merged.petGnome, false);
    assert.equal(merged.petPumpkin, false);
});
