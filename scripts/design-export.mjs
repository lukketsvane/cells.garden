import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { assetKey, coverage, manifest, validatePng } from './design-assets.mjs';

const MAX_ARCHIVE = 20 * 1024 * 1024;
const MAX_PNG = 1024 * 1024;
const mappings = new Map([
    ...coverage.assets.filter(asset => asset.format === 'png' && asset.sourceNodeId && asset.exportNodeId),
    ...Object.values(manifest.assets),
].map(asset => [asset.path, asset]));
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function readZip(archive) {
    let end = -1;
    for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 65557); offset--) {
        if (archive.readUInt32LE(offset) === 0x06054b50 && offset + 22 + archive.readUInt16LE(offset + 20) === archive.length) {
            end = offset;
            break;
        }
    }
    requireThat(end >= 0, 'ZIP has no complete end record.');
    const count = archive.readUInt16LE(end + 10);
    const directorySize = archive.readUInt32LE(end + 12);
    const directoryOffset = archive.readUInt32LE(end + 16);
    requireThat(archive.readUInt16LE(end + 4) === 0 && archive.readUInt16LE(end + 6) === 0
        && archive.readUInt16LE(end + 8) === count, 'Multidisk ZIP exports are unsupported.');
    requireThat(count !== 0xffff && directorySize !== 0xffffffff && directoryOffset !== 0xffffffff, 'ZIP64 exports are unsupported.');
    requireThat(directoryOffset + directorySize === end, 'ZIP directory is truncated or inconsistent.');
    let offset = directoryOffset;
    let totalSize = 0;
    const result = [];
    const seen = new Set();
    for (let entry = 0; entry < count; entry++) {
        requireThat(offset + 46 <= end && archive.readUInt32LE(offset) === 0x02014b50, 'ZIP directory entry is truncated or invalid.');
        const flags = archive.readUInt16LE(offset + 8);
        const method = archive.readUInt16LE(offset + 10);
        const checksum = archive.readUInt32LE(offset + 16);
        const compressedSize = archive.readUInt32LE(offset + 20);
        const size = archive.readUInt32LE(offset + 24);
        const nameLength = archive.readUInt16LE(offset + 28);
        const extraLength = archive.readUInt16LE(offset + 30);
        const commentLength = archive.readUInt16LE(offset + 32);
        const localOffset = archive.readUInt32LE(offset + 42);
        const next = offset + 46 + nameLength + extraLength + commentLength;
        requireThat(next <= end, 'ZIP filename or extra data is truncated.');
        const nameBytes = archive.subarray(offset + 46, offset + 46 + nameLength);
        const name = nameBytes.toString('utf8');
        requireThat(name && !/[\\\0:]/.test(name) && !name.startsWith('/')
            && !name.split('/').some(part => part === '..' || part === '.'), 'ZIP contains an unsafe path.');
        requireThat(!(flags & 0x41), 'Encrypted ZIP exports are unsupported.');
        requireThat(archive.readUInt16LE(offset + 34) === 0, 'Multidisk ZIP exports are unsupported.');
        requireThat(method === 0 || method === 8, 'ZIP compression must be stored or deflated.');
        totalSize += size;
        requireThat(size <= MAX_ARCHIVE && totalSize <= MAX_ARCHIVE, 'ZIP expands beyond 20 MB.');
        requireThat(localOffset + 30 <= directoryOffset && archive.readUInt32LE(localOffset) === 0x04034b50, 'ZIP local entry is truncated or invalid.');
        requireThat(archive.readUInt16LE(localOffset + 6) === flags && archive.readUInt16LE(localOffset + 8) === method, 'ZIP entry headers disagree.');
        const localNameLength = archive.readUInt16LE(localOffset + 26);
        const dataOffset = localOffset + 30 + localNameLength + archive.readUInt16LE(localOffset + 28);
        requireThat(dataOffset + compressedSize <= directoryOffset
            && archive.subarray(localOffset + 30, localOffset + 30 + localNameLength).equals(nameBytes), 'ZIP local filename or data is inconsistent.');
        if (!(flags & 8)) requireThat(archive.readUInt32LE(localOffset + 14) === checksum
            && archive.readUInt32LE(localOffset + 18) === compressedSize && archive.readUInt32LE(localOffset + 22) === size, 'ZIP entry sizes or checksums disagree.');
        const path = name.endsWith('.png.png') ? name.slice(0, -4) : name;
        const asset = mappings.get(path);
        if (asset) {
            requireThat(size <= MAX_PNG, 'Mapped PNG is larger than 1 MB.');
            requireThat(!seen.has(path), `ZIP contains duplicate artwork: ${path}`);
            seen.add(path);
        }
        const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
        const bytes = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: Math.max(1, size) });
        requireThat(bytes.length === size && crc32(bytes) === checksum, 'ZIP data size or checksum mismatch.');
        if (asset) {
            validatePng(bytes, asset);
            result.push({ name: assetKey(path), path, bytes });
        }
        offset = next;
    }
    requireThat(offset === end, 'ZIP directory entry count is inconsistent.');
    requireThat(result.length > 0, 'ZIP contains no mapped native PNG artwork.');
    return result;
}

export function readDesignExport(path, assetName = 'gnome') {
    const extension = extname(path).toLowerCase();
    requireThat(extension === '.png' || extension === '.zip', 'Choose a native PNG or Figma ZIP export.');
    const limit = extension === '.png' ? MAX_PNG : MAX_ARCHIVE;
    requireThat(statSync(path).size <= limit, extension === '.png' ? 'PNG is larger than 1 MB.' : 'ZIP is larger than 20 MB.');
    const bytes = readFileSync(path);
    requireThat(bytes.length <= limit, 'Export changed while reading or exceeds its size limit.');
    if (extension === '.zip') return readZip(bytes);
    const asset = [...mappings.values()].find(value => assetKey(value.path) === assetName);
    requireThat(asset, `Unknown mapped PNG artwork: ${assetName}`);
    validatePng(bytes, asset);
    return [{ name: assetName, path: asset.path, bytes }];
}
