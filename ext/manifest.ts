/**
 * Extension manifest emitted by vite.ext.config.ts. OAuth returns to the normal
 * cells.garden website, which can message this extension but nothing else.
 */
export interface ManifestEnv {
    version: string;
    description: string;
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

    return {
        manifest_version: 3,
        name: 'cells.garden',
        version: env.version,
        description: env.description,
        homepage_url: 'https://cells.garden',
        icons: { ...ICONS },
        action: {
            default_title: 'cells.garden',
            default_icon: { ...ICONS },
            default_popup: 'popup.html',
        },
        chrome_url_overrides: { newtab: 'newtab.html' },
        side_panel: { default_path: 'sidepanel.html' },
        background: { service_worker: 'background.js', type: 'module' },
        permissions: ['sidePanel', 'storage'],
        externally_connectable: {
            matches: ['https://cells.garden/*'],
        },
        minimum_chrome_version: '116',
    };
}
