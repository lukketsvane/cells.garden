/**
 * The extension manifest as a function of the build environment. Emitted as
 * dist-ext/manifest.json by vite.ext.config.ts, so the version comes from
 * package.json and the Supabase origin from the env instead of being copied
 * by hand.
 */
export interface ManifestEnv {
    /** package.json `version`: 1 to 4 dot-separated integers, as Chrome requires. */
    version: string;
    /** package.json `description`. */
    description: string;
    /** VITE_SUPABASE_URL, or '' when the build has no Supabase config. */
    supabaseUrl: string;
}

const ICONS = {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
};

export function buildManifest(env: ManifestEnv): chrome.runtime.ManifestV3 {
    if (!/^\d+(\.\d+){0,3}$/.test(env.version)) {
        throw new Error(`Chrome needs a numeric extension version (1-4 dot-separated integers), got "${env.version}"`);
    }

    const manifest: chrome.runtime.ManifestV3 = {
        manifest_version: 3,
        name: 'cells.garden',
        version: env.version,
        description: env.description,
        icons: { ...ICONS },
        action: {
            default_title: 'Open the garden in the side panel',
            default_icon: { ...ICONS },
        },
        chrome_url_overrides: { newtab: 'newtab.html' },
        side_panel: { default_path: 'sidepanel.html' },
        background: { service_worker: 'background.js', type: 'module' },
        permissions: ['sidePanel'],
        minimum_chrome_version: '114',
    };

    // A magic link is a redirect from the auth server to
    // chrome-extension://<id>/newtab.html. Chrome only lets a web origin
    // navigate to an extension page that is web-accessible to that origin.
    const origin = supabaseOrigin(env.supabaseUrl);
    if (origin) {
        manifest.web_accessible_resources = [{ resources: ['newtab.html'], matches: [`${origin}/*`] }];
    }

    return manifest;
}

function supabaseOrigin(url: string): string | null {
    const trimmed = url.trim();
    if (!trimmed) return null;
    try {
        return new URL(trimmed).origin;
    } catch {
        throw new Error(`VITE_SUPABASE_URL is not a valid URL: "${trimmed}"`);
    }
}
