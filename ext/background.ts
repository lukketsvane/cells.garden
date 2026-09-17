/**
 * MV3 module service worker. The toolbar icon shows the popup (one plant at a
 * time), so the side panel must not also claim the click. Chrome stores the
 * behavior per install; setting it on every start also covers updates and
 * profile restores.
 */
function popupOwnsActionClick(): Promise<void> {
    return chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: false })
        .catch((e: unknown) => console.error('cells.garden: could not set the side panel behavior', e));
}

chrome.runtime.onInstalled.addListener(() => { void popupOwnsActionClick(); });
void popupOwnsActionClick();
