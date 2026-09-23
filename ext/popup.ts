/**
 * The toolbar popup: one plant at a time, a square cutout of the same garden
 * the other pages show. Left and right cycle through the plants; the garden
 * itself is the same GardenView, aimed by focusProject(). A compact, collapsible
 * copy of the current plant's kanban card sits below the scene.
 */
import { local } from '../src/core/local';
import { setIcon } from '../src/core/icons';
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
    const scene = document.querySelector<HTMLElement>('#app')!;
    const footer = document.body.createDiv('popup-footer');
    const row = scene.createDiv('popup-row');
    const prev = row.createEl('button', { cls: 'popup-arrow', text: '‹', attr: { 'aria-label': 'Previous plant', title: 'Previous plant' } });
    const label = row.createDiv('popup-label');
    label.setAttribute('aria-live', 'polite');
    const next = row.createEl('button', { cls: 'popup-arrow', text: '›', attr: { 'aria-label': 'Next plant', title: 'Next plant' } });

    const kanban = footer.createEl('details', { cls: 'popup-kanban' });
    const kanbanSummary = kanban.createEl('summary', { cls: 'popup-kanban-summary' });
    kanbanSummary.createSpan({ text: 'Kanban' });
    kanbanSummary.createSpan({ cls: 'popup-kanban-chevron', text: '›' });
    const kanbanBody = kanban.createDiv('popup-kanban-body');

    const actions = scene.createDiv('popup-actions');
    const openPanel = actions.createEl('button', { cls: 'popup-action', attr: { 'aria-label': 'Open side panel', title: 'Open side panel' } });
    const openGarden = actions.createEl('button', { cls: 'popup-action', attr: { 'aria-label': 'Open garden in new tab', title: 'Open garden in new tab' } });
    const svg = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    setIcon(openPanel, `<svg ${svg}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg>`);
    setIcon(openGarden, `<svg ${svg}><path d="M14 3h7v7M21 3l-11 11M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></svg>`);

    let index = readIndex();

    const syncKanbanOpenClass = () => {
        document.documentElement.classList.toggle('popup-kanban-open', kanban.open);
        kanbanSummary.setAttribute('aria-label', kanban.open ? 'Hide Kanban' : 'Show Kanban');
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
    kanbanSummary.addEventListener('click', (e) => {
        e.preventDefault();
        kanban.open = !kanban.open;
        // Persist in the click itself: a toolbar popup can close immediately.
        syncKanbanOpenClass();
    });
    kanban.addEventListener('toggle', syncKanbanOpenClass);

    prev.onclick = () => show(index - 1);
    next.onclick = () => show(index + 1);
    document.addEventListener('keydown', (e) => {
        if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"], .modal, .garden-context-menu')) return;
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        if (e.key === 'ArrowLeft') show(index - 1);
        if (e.key === 'ArrowRight') show(index + 1);
    });

    if (inExtension) {
        // Resolve the window before the click, so sidePanel.open keeps the user gesture.
        let windowId: number | undefined;
        void chrome.windows.getCurrent().then((win) => { windowId = win.id; });
        openGarden.onclick = () => {
            void chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
            window.close();
        };
        openPanel.onclick = () => {
            if (windowId !== undefined) void chrome.sidePanel.open({ windowId }).then(() => window.close());
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
