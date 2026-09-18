import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';

// The Obsidian plugin: the same core as the web build, bundled as one CommonJS
// file Obsidian can load, with every sprite inlined and the CSS in styles.css.
// Output is a ready plugin folder in dist-obsidian/.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** Emits manifest.json with the version from package.json. */
function pluginManifest(version: string): Plugin {
    return {
        name: 'cells-garden:obsidian-manifest',
        generateBundle() {
            const manifest = JSON.parse(readFileSync(fromRoot('./obsidian-plugin/manifest.json'), 'utf8'));
            this.emitFile({
                type: 'asset',
                fileName: 'manifest.json',
                source: JSON.stringify({ ...manifest, version }, null, 2) + '\n',
            });
        },
    };
}

export default defineConfig(({ mode }) => {
    // Same env handling as vite.config.ts: public values only, VITE_ prefix optional.
    const env = loadEnv(mode, repoRoot, '');
    const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
    const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || '';
    const pkg = JSON.parse(readFileSync(fromRoot('./package.json'), 'utf8')) as { version: string };

    return {
        publicDir: false,
        envDir: repoRoot,
        define: {
            'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
            'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(supabaseKey),
            'process.env.NODE_ENV': JSON.stringify('production'),
        },
        plugins: [pluginManifest(pkg.version)],
        build: {
            outDir: 'dist-obsidian',
            emptyOutDir: true,
            target: 'es2020',
            cssCodeSplit: false,
            assetsInlineLimit: 100 * 1024 * 1024,
            chunkSizeWarningLimit: 4096,
            lib: {
                entry: fromRoot('./obsidian-plugin/main.ts'),
                formats: ['cjs'],
                fileName: () => 'main.js',
                cssFileName: 'styles',
            },
            rollupOptions: {
                // Provided by Obsidian at runtime.
                external: ['obsidian', 'electron', /^@codemirror\//, /^@lezer\//],
                output: { exports: 'default', inlineDynamicImports: true },
            },
        },
    };
});
