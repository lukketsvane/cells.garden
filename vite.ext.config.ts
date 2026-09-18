import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { buildManifest, type ManifestEnv } from './ext/manifest';
import { supabaseEnv } from './vite.config';

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

// The Chrome extension: New Tab, Side Panel and popup around the same src/core
// code as the web build. Output is an unpacked extension in dist-ext/.
export default defineConfig(({ mode }) => {
    const { url: supabaseUrl, define } = supabaseEnv(mode);
    const pkg = JSON.parse(readFileSync(fromRoot('./package.json'), 'utf8')) as {
        version: string;
        description: string;
    };

    return {
        root: 'ext',
        // Extension pages load their assets relative to themselves.
        base: './',
        publicDir: 'public',
        define: {
            ...define,
            __CELLS_BROWSER_STORAGE__: 'true',
            __CELLS_SYSTEM_CLIPBOARD__: 'true',
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
                    popup: fromRoot('./ext/popup.html'),
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
