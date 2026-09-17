import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { buildManifest, type ManifestEnv } from './ext/manifest';

// Env files live at the repo root (not in ext/, which is Vite's `root`).
const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** Emits dist-ext/manifest.json from ext/manifest.ts as part of the bundle. */
function extensionManifest(env: ManifestEnv): Plugin {
    return {
        name: 'cells-garden:extension-manifest',
        generateBundle() {
            this.emitFile({
                type: 'asset',
                fileName: 'manifest.json',
                source: JSON.stringify(buildManifest(env), null, 2) + '\n',
            });
        },
    };
}

// The Chrome extension: New Tab + Side Panel around the same src/core code as
// the web build. Output is an unpacked extension in dist-ext/.
export default defineConfig(({ mode }) => {
    // Same env handling as vite.config.ts (kept in step by hand, not imported,
    // so the two builds stay independent): .env* from the repo root plus the
    // real environment; VITE_ prefix optional. The secret key is never read.
    const env = loadEnv(mode, repoRoot, '');
    const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
    const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || '';

    const pkg = JSON.parse(readFileSync(fromRoot('./package.json'), 'utf8')) as {
        version: string;
        description: string;
    };

    return {
        root: 'ext',
        // Extension pages load their assets relative to themselves.
        base: './',
        publicDir: 'public',
        envDir: repoRoot,
        define: {
            'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
            'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(supabaseKey),
        },
        plugins: [
            extensionManifest({ version: pkg.version, description: pkg.description, supabaseUrl }),
        ],
        build: {
            outDir: '../dist-ext',
            emptyOutDir: true,
            // Same as the web build: every sprite inlined as a data URL.
            assetsInlineLimit: 256 * 1024,
            target: 'es2020',
            chunkSizeWarningLimit: 1024,
            // Chrome >= 114 preloads modules natively; the polyfill would be dead
            // code in the entry chunk.
            modulePreload: { polyfill: false },
            rollupOptions: {
                input: {
                    newtab: fromRoot('./ext/newtab.html'),
                    sidepanel: fromRoot('./ext/sidepanel.html'),
                    background: fromRoot('./ext/background.ts'),
                },
                output: {
                    // The manifest names the service worker, so it gets a fixed
                    // path; everything else is hashed under assets/.
                    entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
                    chunkFileNames: 'assets/[name]-[hash].js',
                    assetFileNames: 'assets/[name]-[hash][extname]',
                },
            },
        },
    };
});
