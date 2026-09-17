import { defineConfig } from 'vite';

// Public Supabase values (URL + publishable key) are safe in the bundle; RLS
// protects the data. Accept the unprefixed names too so the same env works in
// dev, Vercel and CI. The secret key is never read here.
const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? '';

// The web app is the core build. `ext/` (M2) will add a second entry that
// wraps the same src/core code for New Tab + Side Panel.
export default defineConfig({
    root: 'src/web',
    publicDir: '../../public',
    // "/" on Vercel; "/cells.garden/" when deployed as a GitHub project page.
    base: process.env.VITE_BASE ?? '/',
    define: {
        'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
        'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(supabaseKey),
    },
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
