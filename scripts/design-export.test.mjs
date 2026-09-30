import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { ROOT, manifest } from './design-assets.mjs';
import { readDesignExport } from './design-export.mjs';

const gnome = readFileSync(resolve(ROOT, manifest.assets.gnome.path));
const tile = readFileSync(resolve(ROOT, manifest.assets['void-tile'].path));

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
    const files = [], directory = [];
    let offset = 0;
    for (const { name, bytes = Buffer.alloc(0), method = 0, flags = 0, disk = 0, size = bytes.length } of entries) {
        const filename = Buffer.from(name);
        const compressed = method === 8 ? deflateRawSync(bytes) : bytes;
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(flags, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt32LE(crc32(bytes), 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(size, 22);
        local.writeUInt16LE(filename.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        local.copy(central, 6, 4, 26);
        central.writeUInt16LE(filename.length, 28);
        central.writeUInt16LE(disk, 34);
        central.writeUInt32LE(offset, 42);
        files.push(local, filename, compressed);
        directory.push(central, filename);
        offset += local.length + filename.length + compressed.length;
    }
    const body = Buffer.concat(files), index = Buffer.concat(directory), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(index.length, 12);
    end.writeUInt32LE(body.length, 16);
    return Buffer.concat([body, index, end]);
}

function exported(t, bytes, extension = '.zip') {
    const directory = mkdtempSync(resolve(tmpdir(), 'garden-export-test-'));
    t.after(() => {
        assert(directory.startsWith(`${resolve(tmpdir())}${sep}garden-export-test-`));
        rmSync(directory, { recursive: true, force: true });
    });
    const path = resolve(directory, `export${extension}`);
    writeFileSync(path, bytes);
    return path;
}

test('native PNG imports preserve bytes and require the selected native dimensions', t => {
    assert.deepEqual(readDesignExport(exported(t, gnome, '.png')), [{ name: 'gnome', path: manifest.assets.gnome.path, bytes: gnome }]);
    const path = exported(t, tile, '.png');
    assert.deepEqual(readDesignExport(path, 'void-tile'), [{ name: 'void-tile', path: manifest.assets['void-tile'].path, bytes: tile }]);
    assert.throws(() => readDesignExport(path), /native 13/);
    assert.throws(() => readDesignExport(path, 'missing-artwork'), /Unknown mapped/);
});

test('Figma ZIP names, stored/deflated bytes, directories and unmapped files are handled', t => {
    const archive = zip([
        { name: 'src/' },
        { name: 'unmapped.png', bytes: Buffer.from('unmapped export') },
        { name: 'src/assets/pets/gnome.png.png', bytes: gnome, method: 8, flags: 8 },
        { name: manifest.assets['void-tile'].path, bytes: tile },
    ]);
    assert.deepEqual(readDesignExport(exported(t, archive)), [
        { name: 'gnome', path: manifest.assets.gnome.path, bytes: gnome },
        { name: 'void-tile', path: manifest.assets['void-tile'].path, bytes: tile },
    ]);
});

test('ZIP corruption, traversal, encryption, multidisk and duplicate mappings are rejected', t => {
    for (const name of ['../src/assets/pets/gnome.png', '/src/assets/pets/gnome.png', 'C:/src/assets/pets/gnome.png', 'src\\assets\\pets\\gnome.png']) {
        assert.throws(() => readDesignExport(exported(t, zip([{ name, bytes: gnome }]))), /unsafe path/);
    }
    for (const [options, message] of [[{ flags: 1 }, /Encrypted/], [{ disk: 1 }, /Multidisk/], [{ method: 12 }, /compression/]]) {
        assert.throws(() => readDesignExport(exported(t, zip([{ name: manifest.assets.gnome.path, bytes: gnome, ...options }]))), message);
    }
    const archive = zip([{ name: manifest.assets.gnome.path, bytes: gnome }]);
    assert.throws(() => readDesignExport(exported(t, archive.subarray(0, -3))), /end record/);
    const damaged = Buffer.from(archive);
    damaged[30 + Buffer.byteLength(manifest.assets.gnome.path)] ^= 1;
    assert.throws(() => readDesignExport(exported(t, damaged)), /checksum mismatch/);
    assert.throws(() => readDesignExport(exported(t, zip([
        { name: manifest.assets.gnome.path, bytes: gnome },
        { name: `${manifest.assets.gnome.path}.png`, bytes: gnome },
    ]))), /duplicate artwork/);
});

test('oversize or unmapped archives and resized mapped images are rejected', t => {
    assert.throws(() => readDesignExport(exported(t, zip([{ name: manifest.assets.gnome.path, bytes: gnome, size: 1024 * 1024 + 1 }]))), /larger than 1 MB/);
    assert.throws(() => readDesignExport(exported(t, zip([{ name: 'large.bin', size: 20 * 1024 * 1024 + 1 }]))), /expands beyond 20 MB/);
    assert.throws(() => readDesignExport(exported(t, Buffer.alloc(20 * 1024 * 1024 + 1))), /larger than 20 MB/);
    assert.throws(() => readDesignExport(exported(t, zip([{ name: 'unmapped.png', bytes: gnome }]))), /no mapped/);
    assert.throws(() => readDesignExport(exported(t, zip([{ name: manifest.assets.gnome.path, bytes: tile }]))), /native 13/);
});
