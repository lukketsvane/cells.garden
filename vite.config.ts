import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Env files live at the repo root (not in src/web, which is Vite's `root`).
const repoRoot = fileURLToPath(new URL('.', import.meta.url));

// The web app is the core build. `ext/` (M2) will add a second entry that
// wraps the same src/core code for New Tab + Side Panel.
export default defineConfig(({ mode }) => {
    // .env, .env.local, .env.<mode> from the repo root, plus the real environment.
    // Public Supabase values (URL + publishable key) are safe in the bundle; RLS
    // protects the data. Accept the unprefixed names too so the same env works in
    // dev, Vercel and CI. The secret key is never read here.
    const env = loadEnv(mode, repoRoot, '');
    const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
    const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || '';

    return {
        root: 'src/web',
        publicDir: '../../public',
        envDir: repoRoot,
        // "/" on Vercel; "/cells.garden/" when deployed as a GitHub project page.
        base: env.VITE_BASE || '/',
        define: {
            'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
            'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(supabaseKey),
        },
        plugins: [
            // PWA: web manifest + Workbox service worker, so the garden installs on
            // a phone and opens offline. The manifest is generated here rather than
            // kept in public/, so the plugin precaches it and injects the <link>
            // into dist/index.html itself. Nothing of this runs in dev (devOptions
            // off): "virtual:pwa-register" is a no-op there.
            VitePWA({
                // A new build waits until the page applies it (src/web/main.ts does
                // that as soon as no modal or inline edit is open), then the page
                // reloads once. Registration lives in src/web/main.ts.
                registerType: 'prompt',
                injectRegister: false,
                // public/ files to precache on top of the manifest icons.
                includeAssets: ['icon.svg', 'icon-maskable.svg'],
                manifest: {
                    name: 'cells.garden',
                    short_name: 'Garden',
                    description: 'A kanban-style project garden where tasks grow into plants.',
                    // Relative, so the same build also installs from a sub-path (VITE_BASE).
                    start_url: './',
                    scope: './',
                    display: 'standalone',
                    orientation: 'any',
                    background_color: '#1e1e1e',
                    theme_color: '#87CEEB',
                    icons: [
                        { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
                        { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
                        { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
                        { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
                    ],
                },
                workbox: {
                    // Everything Vite emits: index.html plus the hashed assets/ files.
                    // The sprites are inlined into the JS (assetsInlineLimit below), so
                    // there are no other image files; the public/ icons and the manifest
                    // are added by the plugin (includeAssets + manifest icons) and must
                    // not be globbed a second time. Extend this if an asset ever gets
                    // emitted as a file (scripts/test-web.mjs fails offline if one is
                    // missing from the precache).
                    globPatterns: ['**/*.{html,js,css}'],
                    // Every same-origin navigation gets the precached shell. The
                    // Supabase magic link lands on "/?code=..." and must reach index.html.
                    navigateFallback: 'index.html',
                    // No runtimeCaching on purpose: only precached same-origin URLs are
                    // ever served from the worker. Cross-origin requests (Supabase auth
                    // and data) pass straight through and are never cached.
                    cleanupOutdatedCaches: true,
                    // Spelled out because registration is explicit (injectRegister false).
                    // skipWaiting stays off: the page sends SKIP_WAITING itself when it is
                    // safe to reload (see onNeedRefresh in src/web/main.ts).
                    skipWaiting: false,
                    clientsClaim: true,
                    // The sprites are inlined into the single JS chunk (assetsInlineLimit
                    // below), so it grows with the asset pack. Workbox's 2 MiB default
                    // would silently drop it from the precache and break offline start.
                    maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
                    // One self-contained sw.js instead of sw.js + workbox-<hash>.js.
                    inlineWorkboxRuntime: true,
                },
            }),
        ],
        build: {
            outDir: '../../dist',
            emptyOutDir: true,
            // Match the old esbuild `dataurl` loader: every sprite ends up inlined,
            // so the garden works offline and inside an extension without asset paths.
            assetsInlineLimit: 256 * 1024,
            target: 'es2020',
            chunkSizeWarningLimit: 1024,
        },
        server: {
            port: 5173,
        },
    };
});
