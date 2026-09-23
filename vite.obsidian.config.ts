import { copyFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { extrasFlag, supabaseEnv } from './vite.config';

// The Obsidian plugin: the same core as the web build, bundled as one CommonJS
// file Obsidian can load, with every sprite inlined and the CSS in styles.css.
// Built into obsidian-plugin/ and committed, so that folder is the plugin: link
// it into a vault and every pull updates it. The manifest's source is the one in
// the repo root, which is where Obsidian's plugin directory reads it; the build
// copies it into the folder. It also copies main.js and styles.css back to the
// root, beside manifest.json, where the plugin directory's build check looks.
const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig(({ command, mode }) => {
    return {
        publicDir: false,
        plugins: [{
            name: 'cells-garden:obsidian-manifest',
            generateBundle() {
                this.emitFile({ type: 'asset', fileName: 'manifest.json', source: readFileSync(fromRoot('./manifest.json'), 'utf8') });
            },
            writeBundle() {
                for (const file of ['main.js', 'styles.css']) copyFileSync(fromRoot(`./obsidian-plugin/${file}`), fromRoot(`./${file}`));
            },
        }],
        define: {
            ...supabaseEnv(mode).define,
            'process.env.NODE_ENV': JSON.stringify('production'),
            __CELLS_BROWSER_STORAGE__: 'false',
            __CELLS_SYSTEM_CLIPBOARD__: 'false',
            // The plugin ships from main, never from Vercel's dev build.
            __CELLS_EXTRAS__: extrasFlag(command, false),
        },
        build: {
            outDir: 'obsidian-plugin',
            // Only main.js, styles.css and manifest.json are written; the sources beside them stay.
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
