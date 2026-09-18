/**
 * The toolbar popup: one plant at a time, a square cutout of the same garden
 * the other pages show. Left and right cycle through the plants; the garden
 * itself is the same GardenView, aimed by focusProject(). A compact, collapsible
 * copy of the current plant's kanban card sits below the scene.
 */
import { local } from '../src/core/local';
import { inExtension, ready } from './main';

/** Which plant the popup showed last. Per device, like the camera. */
const INDEX_KEY = 'cells.garden/popup/index';
const KANBAN_KEY = 'cells.garden/popup/kanban-open';

function readIndex(): number {
    const n = Number(local.get(INDEX_KEY));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function writeIndex(i: number) {
    local.set(INDEX_KEY, String(i)); // Blocked storage: the popup starts at the first plant next time.
}

function readKanbanOpen(): boolean {
    return local.get(KANBAN_KEY) === '1';
}

void ready.then((app) => {
    const footer = document.body.createDiv('popup-footer');
    const row = footer.createDiv('popup-row');
    const prev = row.createEl('button', { cls: 'popup-arrow', text: '<', attr: { 'aria-label': 'Previous plant' } });
    const label = row.createDiv('popup-label');
    const next = row.createEl('button', { cls: 'popup-arrow', text: '>', attr: { 'aria-label': 'Next plant' } });

    const kanban = footer.createEl('details', { cls: 'popup-kanban' });
    const kanbanSummary = kanban.createEl('summary', { cls: 'popup-kanban-summary' });
    kanbanSummary.createSpan({ text: 'Kanban' });
    kanbanSummary.createSpan({ cls: 'popup-kanban-chevron', text: '›' });
    const kanbanBody = kanban.createDiv('popup-kanban-body');

    const actions = footer.createDiv('popup-actions');
    const openGarden = actions.createEl('button', { cls: 'popup-action', text: 'Garden' });
    const openPanel = actions.createEl('button', { cls: 'popup-action', text: 'Side panel' });

    let index = readIndex();

    const syncKanbanOpenClass = () => {
        document.documentElement.classList.toggle('popup-kanban-open', kanban.open);
        local.set(KANBAN_KEY, kanban.open ? '1' : '0');
    };

    const renderKanban = () => {
        kanbanBody.empty();
        const project = app.gardenData[index];
        if (!project) {
            kanbanBody.createDiv({ cls: 'popup-kanban-empty', text: 'No plant selected' });
            return;
        }
        app.view?.createProjectColumn(kanbanBody, project);
    };

    const show = (i: number) => {
        const count = app.gardenData.length;
        if (count === 0) {
            label.setText('No plants yet');
            row.setAttribute('aria-label', 'No plants yet');
            prev.disabled = next.disabled = true;
            renderKanban();
            return;
        }

        index = ((i % count) + count) % count;
        writeIndex(index);
        prev.disabled = next.disabled = count < 2;

        const project = app.gardenData[index];
        label.setText(project.seed || project.name || 'Untitled plant');
        row.setAttribute('aria-label', `Plant ${index + 1} of ${count}`);
        renderKanban();

        app.view?.focusProject(index);
        // The first aim jumps; every later one glides (ext.css keys the transition on this class).
        if (!document.documentElement.classList.contains('popup-aimed')) {
            void document.body.offsetWidth;
            document.documentElement.classList.add('popup-aimed');
        }
    };

    kanban.open = readKanbanOpen();
    syncKanbanOpenClass();
    kanban.addEventListener('toggle', syncKanbanOpenClass);

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

    // The view re-renders on every data change (a new plant, a sync). Aim and
    // rebuild the compact card again each time.
    if (app.view) app.view.onRendered = () => show(index);
    // First aim: after the view's own centring, which runs in a double rAF.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => show(index)));
});
