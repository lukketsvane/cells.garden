/**
 * A tiny ZIP reader and writer, no dependencies.
 *
 * An Obsidian vault folder leaves the browser as a `.zip` and comes back the
 * same way, so the garden needs both halves of the format. Compression is the
 * platform's: `CompressionStream('deflate-raw')` where it exists (Chrome 80+,
 * Safari 16.4+, Firefox 113+), otherwise entries are stored uncompressed.
 * A valid ZIP either way. Reading handles stored and deflated entries.
 *
 * Deliberately not supported, because a garden never needs it: ZIP64 (> 4 GB
 * or > 65535 entries), encryption, and multi-disk archives.
 */

export interface ZipEntry {
    /** Path inside the archive, `/`-separated, never starting with `/`. */
    name: string;
    bytes: Uint8Array;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
/** Bit 11: the name is UTF-8 rather than CP437. */
const FLAG_UTF8 = 0x800;
/** Bit 3: sizes follow the data instead of preceding it. */
const FLAG_DATA_DESCRIPTOR = 0x08;
const STORED = 0;
const DEFLATED = 8;

// --- CRC-32 ---------------------------------------------------------------

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[i] = c >>> 0;
    }
    return table;
})();

export function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

// --- Compression ----------------------------------------------------------

type StreamCtor = new (format: string) => { readable: ReadableStream; writable: WritableStream };

function streamCtor(name: 'CompressionStream' | 'DecompressionStream'): StreamCtor | null {
    const ctor: unknown = name === 'CompressionStream'
        ? typeof CompressionStream === 'function' && CompressionStream
        : typeof DecompressionStream === 'function' && DecompressionStream;
    return typeof ctor === 'function' ? (ctor as StreamCtor) : null;
}

async function pipeThrough(ctor: StreamCtor, bytes: Uint8Array): Promise<Uint8Array> {
    const stream = new ctor('deflate-raw');
    const source = new Blob([toArrayBuffer(bytes)]).stream();
    const out = source.pipeThrough(stream);
    return new Uint8Array(await new Response(out).arrayBuffer());
}

async function deflate(bytes: Uint8Array): Promise<{ method: number; data: Uint8Array }> {
    const ctor = streamCtor('CompressionStream');
    if (!ctor || bytes.length === 0) return { method: STORED, data: bytes };
    try {
        const data = await pipeThrough(ctor, bytes);
        // A tiny or already-compressed file can come out bigger; store it instead.
        return data.length < bytes.length ? { method: DEFLATED, data } : { method: STORED, data: bytes };
    } catch {
        return { method: STORED, data: bytes };
    }
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
    const ctor = streamCtor('DecompressionStream');
    if (!ctor) throw new Error('This browser cannot read compressed zip entries (no DecompressionStream).');
    return pipeThrough(ctor, bytes);
}

/** A copy of the bytes as a standalone ArrayBuffer (never the whole pool behind a view). */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.slice().buffer;
}

// --- Writing --------------------------------------------------------------

/** MS-DOS date/time, the only timestamp a plain ZIP entry carries. */
function dosDateTime(date: Date): { time: number; date: number } {
    const year = Math.max(1980, date.getFullYear());
    return {
        time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
        date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
}

class ByteWriter {
    private chunks: Uint8Array[] = [];
    length = 0;

    push(bytes: Uint8Array) {
        this.chunks.push(bytes);
        this.length += bytes.length;
    }

    pushRecord(size: number, fill: (view: DataView) => void) {
        const bytes = new Uint8Array(size);
        fill(new DataView(bytes.buffer));
        this.push(bytes);
    }

    concat(): Uint8Array {
        const out = new Uint8Array(this.length);
        let offset = 0;
        for (const chunk of this.chunks) {
            out.set(chunk, offset);
            offset += chunk.length;
        }
        return out;
    }
}

/** Build a `.zip` from a list of entries, stamped now. Folders are implied by `/` in names. */
export async function zip(entries: ZipEntry[]): Promise<Uint8Array> {
    const { time, date } = dosDateTime(new Date());
    const encoder = new TextEncoder();
    const files = new ByteWriter();
    const central = new ByteWriter();

    for (const entry of entries) {
        const name = encoder.encode(normalizeName(entry.name));
        const { method, data } = await deflate(entry.bytes);
        const crc = crc32(entry.bytes);
        const offset = files.length;

        files.pushRecord(30, (v) => {
            v.setUint32(0, LOCAL_HEADER, true);
            v.setUint16(4, 20, true); // version needed
            v.setUint16(6, FLAG_UTF8, true);
            v.setUint16(8, method, true);
            v.setUint16(10, time, true);
            v.setUint16(12, date, true);
            v.setUint32(14, crc, true);
            v.setUint32(18, data.length, true);
            v.setUint32(22, entry.bytes.length, true);
            v.setUint16(26, name.length, true);
            v.setUint16(28, 0, true); // extra field length
        });
        files.push(name);
        files.push(data);

        central.pushRecord(46, (v) => {
            v.setUint32(0, CENTRAL_HEADER, true);
            v.setUint16(4, 20, true); // version made by
            v.setUint16(6, 20, true); // version needed
            v.setUint16(8, FLAG_UTF8, true);
            v.setUint16(10, method, true);
            v.setUint16(12, time, true);
            v.setUint16(14, date, true);
            v.setUint32(16, crc, true);
            v.setUint32(20, data.length, true);
            v.setUint32(24, entry.bytes.length, true);
            v.setUint16(28, name.length, true);
            v.setUint16(30, 0, true); // extra field length
            v.setUint16(32, 0, true); // comment length
            v.setUint16(34, 0, true); // disk number
            v.setUint16(36, 0, true); // internal attributes
            v.setUint32(38, 0, true); // external attributes
            v.setUint32(42, offset, true);
        });
        central.push(name);
    }

    const out = new ByteWriter();
    out.push(files.concat());
    const centralBytes = central.concat();
    out.push(centralBytes);
    out.pushRecord(22, (v) => {
        v.setUint32(0, END_OF_CENTRAL_DIRECTORY, true);
        v.setUint16(4, 0, true); // this disk
        v.setUint16(6, 0, true); // disk with the central directory
        v.setUint16(8, entries.length, true);
        v.setUint16(10, entries.length, true);
        v.setUint32(12, centralBytes.length, true);
        v.setUint32(16, files.length, true);
        v.setUint16(20, 0, true); // comment length
    });
    return out.concat();
}

function normalizeName(name: string): string {
    return name.replace(/\\/g, '/').replace(/^\/+/, '');
}

// --- Reading --------------------------------------------------------------

/**
 * Read a `.zip`. Directory entries are dropped; every file entry comes back
 * with its bytes. Throws when the archive is malformed or uses a feature we
 * do not implement.
 */
export async function unzip(archive: Uint8Array): Promise<ZipEntry[]> {
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    const eocd = findEndOfCentralDirectory(view);
    const count = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    const entries: ZipEntry[] = [];

    for (let i = 0; i < count; i++) {
        if (offset + 46 > archive.length || view.getUint32(offset, true) !== CENTRAL_HEADER) {
            throw new Error('Not a zip file: the central directory is damaged.');
        }
        const flags = view.getUint16(offset + 8, true);
        const method = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const uncompressedSize = view.getUint32(offset + 24, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localOffset = view.getUint32(offset + 42, true);
        // Writers that do not set the UTF-8 flag still tend to write UTF-8 names;
        // ASCII is a subset either way, so decoding as UTF-8 is the safe guess.
        const name = normalizeName(decoder.decode(archive.subarray(offset + 46, offset + 46 + nameLength)));
        offset += 46 + nameLength + extraLength + commentLength;

        if (name.endsWith('/')) continue; // a directory entry has no data
        if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
            throw new Error(`"${name}" needs zip64, which this reader does not support.`);
        }

        // The local header repeats the name and may carry a longer extra field,
        // so the data offset has to be read from it rather than assumed.
        if (view.getUint32(localOffset, true) !== LOCAL_HEADER) {
            throw new Error(`Not a zip file: "${name}" has no local header.`);
        }
        const dataStart =
            localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
        const raw = archive.subarray(dataStart, dataStart + compressedSize);

        let bytes: Uint8Array;
        if (method === STORED) bytes = raw.slice();
        else if (method === DEFLATED) bytes = await inflate(raw);
        else throw new Error(`"${name}" uses compression method ${method}, which this reader does not support.`);

        // Sizes live in a trailing data descriptor for bit-3 entries, but the
        // central directory copy (which we read) is always filled in.
        if (!(flags & FLAG_DATA_DESCRIPTOR) && bytes.length !== uncompressedSize) {
            throw new Error(`"${name}" is truncated or damaged.`);
        }
        entries.push({ name, bytes });
    }
    return entries;
}

function findEndOfCentralDirectory(view: DataView): number {
    // The record is last, but a trailing comment may push it up to 64 KB back.
    const min = Math.max(0, view.byteLength - 22 - 0xffff);
    for (let i = view.byteLength - 22; i >= min; i--) {
        if (view.getUint32(i, true) === END_OF_CENTRAL_DIRECTORY) return i;
    }
    throw new Error('Not a zip file: no end-of-central-directory record.');
}
