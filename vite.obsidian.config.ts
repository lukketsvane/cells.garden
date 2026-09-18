import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

// The Obsidian plugin: the same core as the web build, bundled as one CommonJS
// file Obsidian can load, with every sprite inlined and the CSS in styles.css.
// Built into obsidian-plugin/ next to manifest.json and committed, so that folder
// is the plugin: link it into a vault and every pull updates it.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig(({ mode }) => {
    // Same env handling as vite.config.ts: public values only, VITE_ prefix optional.
    const env = loadEnv(mode, repoRoot, '');
    const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
    const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || '';

    return {
        publicDir: false,
        envDir: repoRoot,
        define: {
            'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
            'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(supabaseKey),
            'process.env.NODE_ENV': JSON.stringify('production'),
        },
        build: {
            outDir: 'obsidian-plugin',
            // Only main.js and styles.css are written; the sources beside them stay.
            emptyOutDir: false,
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
