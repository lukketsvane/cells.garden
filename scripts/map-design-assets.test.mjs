import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { ROOT, coverage, manifest, assetKey, assetByName } from './design-assets.mjs';
import { repositoryAssets, metadataNodes, describedPaths, classifyMapping, findSource, buildCoverage, isReadLimit, isSourceDescendant, exportTargets } from './map-design-assets.mjs';

test('every source asset is indexed once with its unchanged approved bytes and dimensions', () => {
    const current = repositoryAssets();
    assert.equal(current.length, coverage.assets.length);
    assert.equal(new Set(coverage.assets.map(a => a.path)).size, current.length);
    assert.equal(new Set(coverage.assets.map(a => assetKey(a.path))).size, current.length);
    for (const asset of current) {
        const mapped = coverage.assets.find(a => a.path === asset.path);
        assert(mapped, `Missing mapping: ${asset.path}`);
        for (const key of ['format', 'width', 'height', 'sha256']) assert.equal(mapped[key], asset[key], `${asset.path}: approved ${key} changed; review the artwork before updating the index`);
        assert.equal(assetByName(assetKey(asset.path)).path, asset.path);
    }
});

test('verification claims require actual matching digests and geometry', () => {
    for (const asset of coverage.assets) {
        if (asset.status === 'verified') {
            assert.equal(asset.figmaSha256, asset.sha256);
            assert.equal(asset.sourceWidth, asset.width);
            assert.equal(asset.sourceHeight, asset.height);
            assert.equal(asset.evidence, 'image-bytes');
        }
        if (asset.status === 'source-verified') {
            assert.equal(asset.figmaImageSha1, createHash('sha1').update(readFileSync(resolve(ROOT, asset.path))).digest('hex'));
            assert.equal(asset.sourceWidth, asset.width);
            assert.equal(asset.sourceHeight, asset.height);
            assert.match(asset.sourceNodeId, /^\d+:\d+$/);
            assert.match(asset.exportNodeId, /^\d+:\d+$/);
            assert.equal(asset.exportName, asset.path);
            assert.equal(asset.figmaSha256, null);
            assert.equal(asset.evidence, 'source-image-sha1-and-linked-export');
        }
        if (['missing-source', 'ambiguous-source'].includes(asset.status)) assert.equal(asset.sourceNodeId, null);
        if (asset.status === 'unverified') assert.equal(asset.figmaSha256, null);
    }
});

test('metadata parsing keeps exact source names and parent relationships', () => {
    const nodes = metadataNodes({ content: [{ type: 'text', text: '<canvas id="27:1966" name="ASSETS"><frame id="1:2" name="Source &amp; Art" width="32" height="32"><symbol id="1:3" name="Variant=1" width="8" height="7" /></frame></canvas>' }] });
    assert.equal(nodes[1].name, 'Source & Art');
    assert.equal(nodes[2].parentNodeId, '1:2');
    assert.equal(nodes[2].width, 8);
});

test('a missing image response is unverified, never a claimed visual mismatch', () => {
    const asset = { path: 'src/assets/test.png', format: 'png', width: 32, height: 32, sha256: 'expected' };
    const context = { content: [{ type: 'text', text: 'https://github.com/lukketsvane/cells.garden/blob/main/src/assets/test.png' }] };
    const mapping = classifyMapping({ nodeId: '1:2', name: asset.path, width: 32, height: 32 }, context, undefined, [asset]);
    assert.equal(mapping.status, 'unverified');
    assert.equal(mapping.figmaSha256, null);
    assert.deepEqual(describedPaths(context), [asset.path]);
});

test('named source mapping distinguishes seed icons, seeds and plant assembly slots', () => {
    const nodes = [
        { nodeId: '1:1', type: 'frame', name: 'Source/Ground/Seeds', parentNodeId: manifest.pageNodeId },
        { nodeId: '1:2', type: 'symbol', name: 'Kind=Seed, Variant=seed1', parentNodeId: '1:1' },
        { nodeId: '1:3', type: 'symbol', name: 'Kind=Icon, Variant=seed1', parentNodeId: '1:1' },
        { nodeId: '2:1', type: 'frame', name: 'Source/Plants/Bell', parentNodeId: manifest.pageNodeId },
        { nodeId: '2:2', type: 'symbol', name: 'Part=Stem, Variant=stem1', parentNodeId: '2:1' },
        { nodeId: '3:1', type: 'frame', name: 'Source/Assembly Slots/Plants/Bell/Stem', parentNodeId: manifest.pageNodeId },
        { nodeId: '3:2', type: 'symbol', name: 'Variant=stem1', parentNodeId: '3:1' },
    ];
    assert.equal(findSource({ path: 'src/assets/pack/seeds/seed1.png' }, nodes, []).nodeId, '1:2');
    assert.equal(findSource({ path: 'src/assets/pack/seeds/seed_icons/seed1.png' }, nodes, []).nodeId, '1:3');
    assert.equal(findSource({ path: 'src/assets/pack/plant_1/stem/stem1.png' }, nodes, []).nodeId, '2:2');
    assert.equal(findSource({ path: 'src/assets/pack/plant_9/stem/Stem_1.png' }, nodes), undefined);
});

test('stale old comparisons cannot upgrade changed repository files to verified', () => {
    const asset = { path: 'src/assets/bg_image.png', format: 'png', width: 540, height: 108, sha256: 'new' };
    const nodes = [{ nodeId: '29:3203', type: 'symbol', name: 'Source/Environment/Background', parentNodeId: manifest.pageNodeId, width: 540, height: 108 }];
    const old = [{ path: asset.path, baselineSha256: 'old', candidateSha256: 'old' }];
    assert.equal(buildCoverage([asset], nodes, [], old)[0].status, 'unverified');
});

test('approved source IDs survive container and component renaming without rebinding', () => {
    const asset = coverage.assets.find(asset => asset.path === 'src/assets/bg_image.png');
    const source = { nodeId: asset.sourceNodeId, type: 'symbol', name: 'Background / native pixels', parentNodeId: '10:2', width: asset.width, height: asset.height };
    const nodes = [
        { nodeId: '10:1', type: 'section', name: '01 / Artwork', parentNodeId: manifest.pageNodeId },
        { nodeId: '10:2', type: 'frame', name: 'Environment', parentNodeId: '10:1' },
        source,
        { nodeId: '10:3', type: 'symbol', name: asset.sourceName, parentNodeId: manifest.pageNodeId },
    ];
    assert.equal(findSource(asset, nodes), source);
    assert.equal(findSource(asset, nodes.filter(node => node !== source)), undefined);
    assert.equal(findSource(asset, nodes.map(node => node === source ? { ...node, type: 'instance' } : node)), undefined);
    assert.equal(findSource(asset, [...nodes, { ...source }]), undefined);
});

test('new sources can be discovered through nested sections but never through instances or ambiguous copies', () => {
    const asset = { path: 'src/assets/pack/plant_9/stem/Stem_1.png' };
    const nodes = [
        { nodeId: '10:1', type: 'section', name: 'Native artwork', parentNodeId: manifest.pageNodeId },
        { nodeId: '10:2', type: 'frame', name: 'Source/Plants/Plume', parentNodeId: '10:1' },
        { nodeId: '10:3', type: 'frame', name: 'Stems', parentNodeId: '10:2' },
        { nodeId: '10:4', type: 'symbol', name: 'Part=Stem, Variant=Stem_1', parentNodeId: '10:3' },
    ];
    assert.equal(findSource(asset, nodes, []).nodeId, '10:4');
    assert.equal(findSource(asset, nodes.map(node => node.nodeId === '10:3' ? { ...node, type: 'instance' } : node), []), undefined);
    assert.equal(findSource(asset, nodes.map(node => node.nodeId === '10:4' ? { ...node, type: 'instance' } : node), []), undefined);
    assert.equal(findSource(asset, [...nodes, { ...nodes[3], nodeId: '10:5' }], []), undefined);
    assert.equal(findSource(asset, [...nodes, { ...nodes[1], nodeId: '10:6' }], []), undefined);
    assert.equal(findSource(asset, nodes.map(node => node.nodeId === '10:1' ? { ...node, parentNodeId: 'other:page' } : node), []), undefined);
});

test('organised exports retain approved targets and do not audit their nested image layers twice', () => {
    const asset = { path: 'src/assets/test.png' };
    const nodes = [
        { nodeId: '10:1', type: 'section', name: 'Environment', parentNodeId: manifest.exportSectionNodeId },
        { nodeId: '10:2', type: 'frame', name: 'Native exports', parentNodeId: '10:1' },
        { nodeId: '10:3', type: 'instance', name: 'A linked sprite', parentNodeId: '10:2' },
        { nodeId: '10:4', type: 'instance', name: 'Nested image', parentNodeId: '10:3' },
        { nodeId: '10:5', type: 'frame', name: asset.path, parentNodeId: '10:2' },
        { nodeId: '10:6', type: 'instance', name: 'Nested export image', parentNodeId: '10:5' },
        { nodeId: manifest.assets.grass.exportNodeId, type: 'frame', name: 'Renamed grass export', parentNodeId: '10:2' },
        { nodeId: '10:7', type: 'text', name: 'Notes', parentNodeId: '10:2' },
        { nodeId: '10:8', type: 'instance', name: 'Outside exports', parentNodeId: manifest.pageNodeId },
    ];
    assert.deepEqual(exportTargets(nodes, [asset]).map(node => node.nodeId), ['10:3', '10:5', manifest.assets.grass.exportNodeId]);
});

test('broken or cyclic container ancestry cannot establish source ownership', () => {
    const nodes = [
        { nodeId: '10:1', type: 'frame', parentNodeId: '10:2' },
        { nodeId: '10:2', type: 'frame', parentNodeId: '10:1' },
        { nodeId: '10:3', type: 'symbol', parentNodeId: '10:1' },
    ];
    assert.equal(isSourceDescendant(nodes[2], manifest.pageNodeId, nodes), false);
    assert.equal(isSourceDescendant({ nodeId: '10:4', type: 'symbol', parentNodeId: 'missing' }, manifest.pageNodeId, nodes), false);
});

test('animated stars and ambiguous logos stay protected while Plume uses its reconciled sources', () => {
    const stars = coverage.assets.find(a => a.path.endsWith('stars_pattern.gif'));
    assert.equal(stars.format, 'gif');
    assert.equal(stars.status, 'reference-only');
    const plume = coverage.assets.filter(a => a.path.includes('/plant_9/'));
    assert.equal(plume.length, 5);
    assert(plume.every(a => a.sourceNodeId && a.exportNodeId && (a.status === 'source-verified'
        || (a.status === 'unverified' && a.figmaSha256 === null && a.figmaImageSha1 === null))));
    const logos = coverage.assets.filter(a => /CG_logo/.test(a.path));
    assert.equal(logos.length, 2);
    assert(logos.every(a => a.status === 'ambiguous-source' && a.sourceNodeId === null));
});

test('quota and authentication failures stop live auditing', () => {
    for (const message of ['Rate limit exceeded, please try again tomorrow', 'reauthentication required', 'UNAUTHORIZED']) assert(isReadLimit(new Error(message)));
    assert(!isReadLimit(new Error('Composite source requires review')));
});

test('the source contract retains the current rendering scale and sky ordering', () => {
    const css = readFileSync(resolve(ROOT, 'src/core/styles.css'), 'utf8');
    const model = readFileSync(resolve(ROOT, 'src/core/model.ts'), 'utf8');
    assert.match(model, /PIXEL_SCALE = 4/);
    for (const [layer, z] of [['sky-color', -8], ['stars', -7], ['satellite', -6], ['shooting-star', 1.45], ['mountains', 0], ['bg', 3]]) {
        assert.match(css, new RegExp('\\.garden-' + layer + '-layer\\s*\\{[^}]*z-index:\\s*' + z + ';'));
    }
});

test('rendering references point to existing implementation files and explicit Figma nodes', () => {
    const renderMap = JSON.parse(readFileSync(resolve(ROOT, 'design/render-map.json'), 'utf8'));
    for (const binding of renderMap.bindings) {
        assert(binding.rules.length > 0);
        for (const path of binding.files) assert(existsSync(resolve(ROOT, path)), `Missing implementation: ${path}`);
        for (const id of binding.figmaNodeIds) assert.match(id, /^\d+:\d+$/);
    }
});
