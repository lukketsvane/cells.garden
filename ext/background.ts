/**
 * MV3 module service worker. Its one job: make a click on the toolbar icon
 * open the side panel. Chrome stores the behavior per install, but setting it
 * again on every start is cheap and also covers updates and profile restores.
 */
function openPanelOnActionClick(): Promise<void> {
    return chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch((e: unknown) => console.error('cells.garden: could not set the side panel behavior', e));
}

chrome.runtime.onInstalled.addListener(() => { void openPanelOnActionClick(); });
void openPanelOnActionClick();
