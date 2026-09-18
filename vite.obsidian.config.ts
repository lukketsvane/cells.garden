import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { supabaseEnv } from './vite.config';

// The Obsidian plugin: the same core as the web build, bundled as one CommonJS
// file Obsidian can load, with every sprite inlined and the CSS in styles.css.
// Built into obsidian-plugin/ next to manifest.json and committed, so that folder
// is the plugin: link it into a vault and every pull updates it.
const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig(({ mode }) => {
    return {
        publicDir: false,
        define: {
            ...supabaseEnv(mode).define,
            'process.env.NODE_ENV': JSON.stringify('production'),
        },
        build: {
            outDir: 'obsidian-plugin',
            // Only main.js and styles.css are written; the sources beside them stay.
            emptyOutDir: false,
            target: 'es2020',
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
