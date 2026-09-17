import assert from 'node:assert/strict';
import test from 'node:test';
import { crc32, unzip, zip } from './zip';

const enc = new TextEncoder();
const dec = new TextDecoder();

test('crc32 matches the reference vector', () => {
    assert.equal(crc32(enc.encode('123456789')), 0xcbf43926);
    assert.equal(crc32(new Uint8Array(0)), 0);
});

test('a zip round trips text, folders and binary', async () => {
    // Long enough that deflate wins, so the deflated branch is exercised.
    const md = '---\nid: a\ntype: garden-cell\n---\n\n## Flowers\n- Runs in a browser\n'.repeat(40);
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3, 255, 254]);

    const archive = await zip([
        { name: 'Garden/Port the garden.md', bytes: enc.encode(md) },
        { name: 'Garden/_assets/deadbeef.png', bytes: png },
        { name: 'Garden/empty.md', bytes: new Uint8Array(0) },
    ]);

    const back = await unzip(archive);
    assert.deepEqual(back.map((e) => e.name), [
        'Garden/Port the garden.md',
        'Garden/_assets/deadbeef.png',
        'Garden/empty.md',
    ]);
    assert.equal(dec.decode(back[0].bytes), md);
    assert.deepEqual(back[1].bytes, png);
    assert.equal(back[2].bytes.length, 0);
    // Deflate actually ran: the archive is far smaller than the text it carries.
    assert.ok(archive.length < md.length / 2, `archive is ${archive.length} bytes for ${md.length} of text`);
});

test('names with non-ASCII characters survive', async () => {
    const name = 'Hagen/Blåveis 🌱.md';
    const back = await unzip(await zip([{ name, bytes: enc.encode('hei') }]));
    assert.equal(back[0].name, name);
});

test('leading slashes and backslashes are normalised away', async () => {
    const back = await unzip(await zip([{ name: '/Garden\\Sub\\One.md', bytes: enc.encode('x') }]));
    assert.equal(back[0].name, 'Garden/Sub/One.md');
});

test('an empty archive is still a valid zip', async () => {
    const archive = await zip([]);
    assert.equal(archive.length, 22); // end-of-central-directory only
    assert.deepEqual(await unzip(archive), []);
});

test('reading something that is not a zip fails loudly', async () => {
    await assert.rejects(() => unzip(enc.encode('# just some markdown')), /not a zip file/i);
});

test('a truncated archive fails rather than returning half a garden', async () => {
    const archive = await zip([{ name: 'a.md', bytes: enc.encode('x'.repeat(200)) }]);
    await assert.rejects(() => unzip(archive.subarray(0, archive.length - 30)), /not a zip file/i);
});

test('the reader tolerates a trailing archive comment', async () => {
    const archive = await zip([{ name: 'a.md', bytes: enc.encode('hello') }]);
    const comment = enc.encode('written by cells.garden');
    // Point the end-of-central-directory record at a comment and append it.
    const withComment = new Uint8Array(archive.length + comment.length);
    withComment.set(archive);
    withComment.set(comment, archive.length);
    new DataView(withComment.buffer).setUint16(archive.length - 2, comment.length, true);

    const back = await unzip(withComment);
    assert.equal(dec.decode(back[0].bytes), 'hello');
});

test('directory entries are skipped', async () => {
    const archive = await zip([
        { name: 'Garden/', bytes: new Uint8Array(0) },
        { name: 'Garden/a.md', bytes: enc.encode('x') },
    ]);
    const back = await unzip(archive);
    assert.deepEqual(back.map((e) => e.name), ['Garden/a.md']);
});
