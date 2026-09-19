#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

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
for (const table of ['profiles','gardens','garden_members','garden_invites','plants','plant_members','plant_invites','plant_offers']) {
    assert(new RegExp('alter\\s+table\\s+public\\.' + table + '\\s+enable\\s+row\\s+level\\s+security','i').test(allSql), 'RLS missing: ' + table);
}

for (const name of readdirSync(join(ROOT,'.github','workflows')).filter((n) => /\.ya?ml$/.test(n))) {
    const wf = read(join('.github','workflows',name));
    for (const m of wf.matchAll(/uses:\s*(actions\/[A-Za-z0-9_.-]+)@([^\s#]+)/g)) {
        assert(/^[0-9a-f]{40}$/.test(m[2]), name + ': mutable action ref ' + m[1]);
    }
}
console.log('Security invariants passed:', runtimeFiles.length, 'runtime files,', migrations.length, 'migrations.');
