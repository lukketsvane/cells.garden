import { defineConfig } from 'vite';

// The web app is the core build. `ext/` (M2) will add a second entry that
// wraps the same src/core code for New Tab + Side Panel.
export default defineConfig({
    root: 'src/web',
    publicDir: '../../public',
    build: {
        outDir: '../../dist',
        emptyOutDir: true,
        // Match the old esbuild `dataurl` loader: every sprite ends up inlined,
        // so the garden works offline and inside an extension without asset paths.
        assetsInlineLimit: 256 * 1024,
        target: 'es2020',
    },
    server: {
        port: 5173,
    },
});
