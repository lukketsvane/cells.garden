/**
 * The toolbar popup: one plant at a time, a square cutout of the same garden
 * the other pages show. Left and right cycle through the plants; the garden
 * itself is the same GardenView, aimed by focusProject(), with the kanban
 * hidden by ext.css. Buttons open the full garden in a tab or the side panel.
 * The garden itself is booted by main.ts, as on the other extension pages.
 */
import { local } from '../src/core/local';
import { inExtension, ready } from './main';

/** Which plant the popup showed last. Per device, like the camera. */
const INDEX_KEY = 'cells.garden/popup/index';

function readIndex(): number {
    const n = Number(local.get(INDEX_KEY));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function writeIndex(i: number) {
    local.set(INDEX_KEY, String(i)); // Blocked storage: the popup starts at the first plant next time.
}

void ready.then((app) => {
    const footer = document.body.createDiv('popup-footer');
    const row = footer.createDiv('popup-row');
    const prev = row.createEl('button', { cls: 'popup-arrow', text: '<', attr: { 'aria-label': 'Previous plant' } });
    const label = row.createDiv('popup-label');
    const next = row.createEl('button', { cls: 'popup-arrow', text: '>', attr: { 'aria-label': 'Next plant' } });
    const name = footer.createDiv('popup-name');
    const actions = footer.createDiv('popup-actions');
    const openGarden = actions.createEl('button', { cls: 'popup-action', text: 'Garden' });
    const openPanel = actions.createEl('button', { cls: 'popup-action', text: 'Side panel' });

    let index = readIndex();

    const show = (i: number) => {
        const count = app.gardenData.length;
        if (count === 0) {
            label.setText('No plants yet');
            name.setText('');
            prev.disabled = next.disabled = true;
            return;
        }
        index = ((i % count) + count) % count;
        writeIndex(index);
        prev.disabled = next.disabled = count < 2;
        label.setText(`Plant ${index + 1}/${count}`);
        name.setText(app.gardenData[index].seed || app.gardenData[index].name || '');
        app.view?.focusProject(index);
        // The first aim jumps; every later one glides (ext.css keys the transition on this class).
        if (!document.documentElement.classList.contains('popup-aimed')) {
            void document.body.offsetWidth;
            document.documentElement.classList.add('popup-aimed');
        }
    };

    prev.onclick = () => show(index - 1);
    next.onclick = () => show(index + 1);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') show(index - 1);
        if (e.key === 'ArrowRight') show(index + 1);
    });

    if (inExtension) {
        openGarden.onclick = () => {
            void chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
            window.close();
        };
        openPanel.onclick = async () => {
            const win = await chrome.windows.getCurrent();
            if (win.id !== undefined) await chrome.sidePanel.open({ windowId: win.id });
            window.close();
        };
    } else {
        // Opened from disk while debugging: no chrome.* APIs.
        actions.remove();
    }

    // The view re-renders on every data change (a new plant, a sync). Aim again each time.
    if (app.view) app.view.onRendered = () => show(index);
    // First aim: after the view's own centring, which runs in a double rAF.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => show(index)));
});
