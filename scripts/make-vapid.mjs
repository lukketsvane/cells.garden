#!/usr/bin/env node
// Makes a VAPID key pair for Web Push (P-256) with node:crypto alone.
//
//   node scripts/make-vapid.mjs <file outside the repo>
//
// Prints the public key. It goes in .env as VITE_VAPID_PUBLIC_KEY and in the
// notify function's VAPID_PUBLIC_KEY secret; it is public by design, like the
// Supabase publishable key. The private key is written to the file and never
// shown: it goes in the function's VAPID_PRIVATE_KEY secret and nowhere else.
// Both are base64url, the form Web Push libraries and browsers take.
//
// A new pair cuts off every device that turned notifications on with the old
// one, until it turns them on again.

import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
if (!target) {
    console.error('Usage: node scripts/make-vapid.mjs <file outside the repo>');
    process.exit(1);
}
const out = resolve(target);
const inside = relative(ROOT, out);
if (!inside.startsWith('..') && !isAbsolute(inside)) {
    console.error('Refusing to write a private key inside the repository.');
    process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });
// The uncompressed point: 0x04, x, y. 65 bytes.
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]);
if (raw.length !== 65 || Buffer.from(priv.d, 'base64url').length !== 32) throw new Error('unexpected key size');

// 'wx': never overwrite a key that may already be in use.
writeFileSync(out, priv.d + '\n', { flag: 'wx', mode: 0o600 });
console.log(raw.toString('base64url'));
console.error(`Private key written to ${out}`);
