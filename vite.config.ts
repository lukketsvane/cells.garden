import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

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
