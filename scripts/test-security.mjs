#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const pkg = JSON.parse(read('package.json'));
const privacy = read('public/privacy.html');
const webstore = read('ext/WEBSTORE.md');
assert(privacy.includes('<code>sidePanel</code>') && privacy.includes('<code>storage</code>'), 'privacy policy must disclose Chrome permissions');
assert(/does not read the pages you visit, your browsing history/i.test(privacy), 'privacy policy must state browsing-data boundary');
assert(webstore.includes('Current replacement release: `' + pkg.version + '`'), 'Chrome Web Store notes must match package version');

const vercel = JSON.parse(read('vercel.json'));
assert(vercel.installCommand === 'npm ci --ignore-scripts');
const globalHeaders = vercel.headers?.find((h) => h.source === '/(.*)')?.headers ?? [];
const header = (name) => globalHeaders.find((h) => h.key.toLowerCase() === name.toLowerCase())?.value ?? '';
const csp = header('Content-Security-Policy');
for (const d of ["default-src 'self'","script-src 'self'","object-src 'none'","base-uri 'none'","frame-ancestors 'none'","form-action 'self'"]) {
    assert(csp.includes(d), 'CSP missing: ' + d);
}
assert(header('Strict-Transport-Security').includes('includeSubDomains'));
assert(header('X-Content-Type-Options') === 'nosniff');
assert(header('X-Frame-Options') === 'DENY');
assert(header('Permissions-Policy').includes('camera=()'));

const callbackHeaders = vercel.headers?.find((h) => h.source === '/privacy/oauth-return.html')?.headers ?? [];
assert(callbackHeaders.some((h) => h.key === 'Cache-Control' && /no-store/.test(h.value)));
const callbackHtml = read('public/privacy/oauth-return.html');
assert(!/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(callbackHtml), 'inline OAuth script');
assert(/src="\/privacy\/oauth-return\.js"/.test(callbackHtml));
assert(/name="referrer"\s+content="no-referrer"/i.test(callbackHtml));
const callbackJs = read('public/privacy/oauth-return.js');
assert(/history\.replaceState/.test(callbackJs));

const rootIndex = read('src/web/index.html');
assert(rootIndex.includes('/privacy/oauth-extension-return.js'), 'root extension OAuth interceptor missing');
assert(rootIndex.indexOf('/privacy/oauth-extension-return.js') < rootIndex.indexOf('./main.ts'), 'extension OAuth interceptor must run before web main');
const extensionStart = read('public/privacy/oauth-extension-start.js');
assert(/sessionStorage\.setItem/.test(extensionStart) && /redirect_to/.test(extensionStart), 'extension OAuth start intent missing');
const extensionReturn = read('public/privacy/oauth-extension-return.js');
assert(/__CELLS_EXTENSION_OAUTH_HANDOFF__/.test(extensionReturn), 'root callback does not stop web auth boot');
assert(/history\.replaceState/.test(extensionReturn), 'root callback leaves OAuth code in browser history');
assert(/runtime\.sendMessage/.test(extensionReturn), 'root callback does not message the extension');
const extensionWorker = read('ext/background.ts');
assert(/OAUTH_INTENT_KEY/.test(extensionWorker) && /acceptRootIntent/.test(extensionWorker), 'root OAuth callback is not nonce-gated');

const auth = read('src/core/auth.ts');
assert(!/\.auth\.signUp\s*\(/.test(auth), 'unverified password signup must stay disabled');
assert(/\.auth\.signInWithOtp\s*\(/.test(auth));

const obsidian = read('obsidian-plugin/main.ts');
assert(/noopener,noreferrer/.test(obsidian), 'Obsidian OAuth opener isolation missing');

const forbidden = [
    [/\.innerHTML\s*=/, 'innerHTML'],
    [/insertAdjacentHTML\s*\(/, 'insertAdjacentHTML'],
    [/document\.write\s*\(/, 'document.write'],
    [/(^|[^.$\w])eval\s*\(/m, 'eval'],
    [/new\s+Function\s*\(/, 'new Function'],
];
const runtimeFiles = [];
function walk(path) {
    const full = join(ROOT, path);
    const stat = statSync(full);
    if (stat.isDirectory()) return void readdirSync(full).forEach((entry) => walk(join(path, entry)));
    if (/\.(?:ts|js|html)$/.test(path)) runtimeFiles.push(path);
}
['src','ext','public'].forEach(walk);
runtimeFiles.push('obsidian-plugin/main.ts');
for (const path of runtimeFiles) {
    const source = read(path);
    for (const [pattern, label] of forbidden) assert(!pattern.test(source), path + ': forbidden ' + label);
}

for (const path of ['.env','.env.local.example','vercel.json','package.json','vite.config.ts','vite.ext.config.ts','vite.obsidian.config.ts',...runtimeFiles]) {
    const source = read(path);
    assert(!new RegExp('sb_' + 'secret_', 'i').test(source), path + ': secret Supabase key');
    assert(!new RegExp('service' + '_role', 'i').test(source), path + ': service-role key/reference');
}

const migrationDir = join(ROOT, 'supabase', 'migrations');
const migrations = readdirSync(migrationDir).filter((n) => n.endsWith('.sql')).sort();
for (const name of migrations) {
    const sql = read(join('supabase','migrations',name));
    assert(!/grant\s+execute\s+on\s+function[\s\S]*?\s+to\s+(?:anon|public)\b/i.test(sql), name + ': RPC exposed to anon/public');
    if (name >= '0004_harden_functions.sql') {
        for (const m of sql.matchAll(/create\s+or\s+replace\s+function[\s\S]*?\$\$;/gi)) {
            if (/security\s+definer/i.test(m[0])) assert(/set\s+search_path\s*=\s*''/i.test(m[0]), name + ': unpinned SECURITY DEFINER');
        }
    }
}
const allSql = migrations.map((n) => read(join('supabase','migrations',n))).join('\n');
for (const table of ['profiles','gardens','garden_members','garden_invites','plants','plant_members','plant_invites','plant_offers','notifications','push_subscriptions']) {
    assert(new RegExp('alter\\s+table\\s+public\\.' + table + '\\s+enable\\s+row\\s+level\\s+security','i').test(allSql), 'RLS missing: ' + table);
}
// Notifications (0012): only the notify function writes them; a client may change read_at and nothing else.
assert(!/create\s+policy[^;]*on\s+public\.notifications\s+for\s+(?:insert|delete|all)\b/i.test(allSql), 'notifications: clients must not insert or delete');
assert(/grant\s+update\s*\(\s*read_at\s*\)\s+on\s+public\.notifications\s+to\s+authenticated/i.test(allSql), 'notifications: update limited to read_at');
assert(/revoke\s+all\s+on\s+public\.notifications\s+from\s+public,\s*anon,\s*authenticated/i.test(allSql), 'notifications: default grants not revoked');

// Drawn pictures (0011): the database accepts exactly the format the client
// draws from (DRAWING_FORMAT, anchored, fixed length), nothing looser.
const pixels = read('src/core/avatar-pixels.ts');
const drawingFormat = /DRAWING_FORMAT = \/(.+)\/;/.exec(pixels)?.[1] ?? '';
const drawingLength = /DRAWING_LENGTH = (\d+);/.exec(pixels)?.[1] ?? '';
assert(/^\^[^|]*\$$/.test(drawingFormat), 'DRAWING_FORMAT must be one anchored pattern');
const drawingChecks = [...allSql.matchAll(/add\s+constraint\s+profiles_avatar_drawing_format\s+check\s*\(([\s\S]*?)\);/gi)];
const drawingCheck = drawingChecks.at(-1)?.[1] ?? '';
assert(drawingCheck.includes(`avatar_drawing ~ '${drawingFormat}'`), 'avatar_drawing check must use DRAWING_FORMAT exactly');
assert(drawingCheck.includes(`length(avatar_drawing) = ${drawingLength}`), 'avatar_drawing check must pin DRAWING_LENGTH');

// Every function that hands out a picture, as last defined, sends the drawing before the seed.
const latestFunctions = new Map();
for (const name of migrations) {
    for (const m of read(join('supabase','migrations',name)).matchAll(/create\s+or\s+replace\s+function\s+([\w.]+)\s*\([\s\S]*?\$\$([\s\S]*?)\$\$;/gi)) {
        latestFunctions.set(m[1], m[2]);
    }
}
for (const [fn, body] of latestFunctions) {
    if (/\bavatar_seed\b/.test(body)) {
        assert(/coalesce\(\s*\w+\.avatar_drawing\s*,\s*\w+\.avatar_seed\b/.test(body), fn + ': hands out avatar_seed without avatar_drawing');
    }
}

// --- Web Push keys and server keys --------------------------------------------------
// The VAPID public key is public by design (.env, like the publishable key). The
// private key and the service role key live only in the notify function's
// secrets: never in a tracked file, an untracked one about to be, or a build.

const dotenv = read('.env');
const vapidPublic = /^VITE_VAPID_PUBLIC_KEY=(.*)$/m.exec(dotenv)?.[1]?.trim() ?? '';
if (vapidPublic) {
    const point = Buffer.from(vapidPublic, 'base64url');
    assert(point.length === 65 && point[0] === 4, '.env: VITE_VAPID_PUBLIC_KEY must be the 65-byte public key, never the private one');
}

const BINARY = /\.(?:png|gif|jpe?g|webp|ico|zip|woff2?|ttf|otf|pdf|mp4|webm)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', '.claude', '.vercel', 'dist', 'dist-ext', 'dev-dist']);

/** Every file git tracks or would add (ignored files, such as .env.local, stay out); a plain walk without git. */
function repoFiles() {
    try {
        const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        return out.split('\0').filter(Boolean);
    } catch {
        const files = [];
        const walkAll = (dir) => {
            for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
                const path = dir ? `${dir}/${entry.name}` : entry.name;
                if (entry.isDirectory()) {
                    if (!SKIP_DIRS.has(entry.name)) walkAll(path);
                } else if (entry.name !== '.env.local') {
                    files.push(path);
                }
            }
        };
        walkAll('');
        return files;
    }
}

/** What the builds wrote, when they are there: scanned after "npm run build" too. */
function buildFiles() {
    const files = [];
    const walkBuild = (dir) => {
        if (!existsSync(join(ROOT, dir))) return;
        for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
            const path = `${dir}/${entry.name}`;
            if (entry.isDirectory()) walkBuild(path);
            else files.push(path);
        }
    };
    walkBuild('dist');
    walkBuild('dist-ext');
    for (const path of ['obsidian-plugin/main.js', 'main.js']) if (existsSync(join(ROOT, path))) files.push(path);
    return files;
}

const secretPatterns = [
    [/-----BEGIN (?:EC |ENCRYPTED )?PRIVATE KEY-----/, 'a PEM private key'],
    [/"d"\s*:\s*"[A-Za-z0-9_-]{43}"/, 'a JWK private key'],
    [/VAPID_PRIVATE_KEY\s*[=:]\s*["']?[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/, 'the VAPID private key'],
    [/\bprivateKey\s*[=:]\s*["'][A-Za-z0-9_-]{43}["']/, 'a private key literal'],
    [new RegExp('sb_' + 'secret_[A-Za-z0-9_-]{16,}'), 'a secret Supabase key'],
];
/** A JWT whose claims say service_role: the legacy service key. */
function hasServiceRoleJwt(source) {
    for (const m of source.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]*/g)) {
        try {
            if (JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')).role === 'service' + '_role') return true;
        } catch {
            // Not JSON: not a token.
        }
    }
    return false;
}
// The exact private key, when the one checking has it at hand (VAPID_PRIVATE_KEY, or a file named by VAPID_PRIVATE_KEY_FILE).
const knownSecret = (process.env.VAPID_PRIVATE_KEY
    || (process.env.VAPID_PRIVATE_KEY_FILE && existsSync(process.env.VAPID_PRIVATE_KEY_FILE) ? readFileSync(process.env.VAPID_PRIVATE_KEY_FILE, 'utf8') : '')).trim();

const scanned = [...new Set([...repoFiles(), ...buildFiles()])].filter((path) => !BINARY.test(path) && existsSync(join(ROOT, path)));
for (const path of scanned) {
    const source = readFileSync(join(ROOT, path), 'utf8');
    for (const [pattern, label] of secretPatterns) assert(!pattern.test(source), `${path}: ${label}`);
    assert(!hasServiceRoleJwt(source), `${path}: a service role key`);
    if (knownSecret.length >= 32) assert(!source.includes(knownSecret), `${path}: the VAPID private key`);
}

for (const name of readdirSync(join(ROOT,'.github','workflows')).filter((n) => /\.ya?ml$/.test(n))) {
    const wf = read(join('.github','workflows',name));
    for (const m of wf.matchAll(/uses:\s*(actions\/[A-Za-z0-9_.-]+)@([^\s#]+)/g)) {
        assert(/^[0-9a-f]{40}$/.test(m[2]), name + ': mutable action ref ' + m[1]);
    }
}
console.log('Security invariants passed:', runtimeFiles.length, 'runtime files,', migrations.length, 'migrations,', scanned.length, 'files scanned for keys.');
