/**
 * Taking the garden out of the app, and putting one back (M3).
 *
 * `vault.ts` decides what the files are and `zip.ts` packs them; this module is
 * only the part that touches the browser: a download, a file picker, a drop
 * target and the modal that ties them together.
 *
 * The button lives on the boot host rather than inside the view, because
 * `GardenView.onOpen()` empties and rebuilds its container on every render.
 */
import type { GardenApp } from './app';
import { Modal, Setting } from './ui';
import {
    archiveFileName,
    gardenToVaultFiles,
    mergeGarden,
    vaultFilesToGarden,
    type ImportMode,
    type ImportResult,
    type VaultFile,
} from './vault';
import { unzip, zip } from './zip';

/** A file the user handed over, with the path it had where it came from. */
interface PickedFile {
    path: string;
    file: File;
}

// --- Export ---------------------------------------------------------------

/** The current garden as a `.zip`, ready to be written to disk. */
export async function gardenArchive(app: GardenApp): Promise<{ name: string; bytes: Uint8Array }> {
    const files = gardenToVaultFiles(app.toGarden());
    const bytes = await zip(files.map(f => ({ name: f.path, bytes: f.bytes })));
    return { name: archiveFileName(), bytes };
}

function saveToDisk(name: string, bytes: Uint8Array) {
    // A standalone copy of the bytes: a Blob must not be handed a view onto a
    // buffer that something else may still be writing into.
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoking straight away can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// --- Reading what the user handed over -------------------------------------

/**
 * Turn picked files into vault files. A `.zip` is unpacked; anything else is
 * taken at face value, under the path it had in the folder it came from.
 */
async function toVaultFiles(picked: PickedFile[]): Promise<{ files: VaultFile[]; unreadable: string[] }> {
    const files: VaultFile[] = [];
    const unreadable: string[] = [];

    for (const { path, file } of picked) {
        let bytes: Uint8Array;
        try {
            bytes = new Uint8Array(await file.arrayBuffer());
        } catch {
            unreadable.push(path);
            continue;
        }

        if (/\.zip$/i.test(file.name)) {
            try {
                for (const entry of await unzip(bytes)) files.push({ path: entry.name, bytes: entry.bytes });
            } catch {
                // A damaged archive is reported rather than half-read.
                unreadable.push(path);
            }
        } else {
            files.push({ path, bytes });
        }
    }

    return { files, unreadable };
}

function pickedFromInput(input: HTMLInputElement): PickedFile[] {
    return Array.from(input.files ?? []).map((file) => ({
        path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
        file,
    }));
}

/**
 * Everything in a drop, folders included. `webkitGetAsEntry` is the only way to
 * see inside a dropped folder; without it a drop carries its loose files only.
 */
async function pickedFromDrop(transfer: DataTransfer): Promise<PickedFile[]> {
    // The item list is emptied once the event handler yields, so read it first.
    const entries: FileSystemEntry[] = [];
    for (const item of Array.from(transfer.items ?? [])) {
        const entry = item.webkitGetAsEntry?.();
        if (entry) entries.push(entry);
    }
    if (entries.length === 0) {
        return Array.from(transfer.files).map((file) => ({ path: file.name, file }));
    }

    const picked: PickedFile[] = [];
    for (const entry of entries) await walk(entry, '', picked);
    return picked;
}

async function walk(entry: FileSystemEntry, prefix: string, out: PickedFile[]): Promise<void> {
    if (entry.isFile) {
        const file = await new Promise<File | null>((resolve) =>
            (entry as FileSystemFileEntry).file(resolve, () => resolve(null)));
        if (file) out.push({ path: prefix + file.name, file });
        return;
    }
    if (!entry.isDirectory) return;

    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const childPrefix = `${prefix}${entry.name}/`;
    // readEntries hands over a batch at a time and signals the end with an
    // empty one, so it has to be called until it does.
    for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve) =>
            reader.readEntries(resolve, () => resolve([])));
        if (batch.length === 0) return;
        for (const child of batch) await walk(child, childPrefix, out);
    }
}

// --- What an import is about to do ----------------------------------------

function countLine(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
}

/** The plain-language version of an import, shown before anything is applied. */
export function describeImport(result: ImportResult, unreadable: string[]): string[] {
    const lines: string[] = [];
    lines.push(result.projects.length
        ? `Found ${countLine(result.projects.length, 'plant', 'plants')}.`
        : 'No plants in these files.');
    if (result.settings) lines.push('Settings included.');
    if (result.assets.size) {
        // Nothing stores user art yet, so say so rather than dropping it quietly.
        lines.push(`${countLine(result.assets.size, 'custom image', 'custom images')} cannot be kept yet; those cells stay blank.`);
    }
    if (unreadable.length) lines.push(`${countLine(unreadable.length, 'file', 'files')} could not be read.`);
    if (result.skipped.length) lines.push(`${countLine(result.skipped.length, 'other file was', 'other files were')} ignored.`);
    return lines;
}

/** Fold an import into the open garden and save the result. */
export async function applyImport(app: GardenApp, result: ImportResult, mode: ImportMode): Promise<string> {
    const { garden, summary } = mergeGarden(app.toGarden(), result, mode);
    await app.replaceGarden(garden);

    if (mode === 'replace') {
        return `Replaced. ${countLine(summary.added, 'plant', 'plants')}.`;
    }
    const parts: string[] = [];
    if (summary.added) parts.push(`planted ${countLine(summary.added, 'plant', 'plants')}`);
    if (summary.updated) parts.push(`updated ${countLine(summary.updated, 'plant', 'plants')}`);
    if (parts.length === 0) return 'Nothing changed.';
    const sentence = parts.join(', ');
    return sentence[0].toUpperCase() + sentence.slice(1) + '.';
}

// --- The modal -------------------------------------------------------------

class GardenFilesModal extends Modal {
    private status: HTMLElement | null = null;
    private busy = false;

    constructor(private readonly app: GardenApp) {
        super();
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('garden-files-modal');
        contentEl.createEl('h2', { text: 'Garden files' });
        contentEl.createEl('p', { text: 'One markdown file per plant. Unzip into a vault and the Obsidian plugin reads it as is.' });

        new Setting(contentEl)
            .setName('Download a copy')
            .setDesc('Plants and settings.')
            .addButton((btn) => btn.setButtonText('Download .zip').setCta().onClick(() => void this.download(btn.buttonEl)));

        contentEl.createEl('hr');
        contentEl.createEl('h3', { text: 'Import' });

        const drop = contentEl.createDiv('garden-drop');
        drop.createEl('p', { text: 'Drop a .zip, a folder or a .md file.' });

        const fileInput = drop.createEl('input', { type: 'file', cls: 'garden-file-input' });
        fileInput.multiple = true;
        fileInput.accept = '.zip,.md,.json,.png,.gif,.webp,.jpg,.jpeg,.svg';
        fileInput.addEventListener('change', () => void this.read(pickedFromInput(fileInput)));

        const folderInput = drop.createEl('input', { type: 'file', cls: 'garden-file-input' });
        folderInput.webkitdirectory = true;
        folderInput.addEventListener('change', () => void this.read(pickedFromInput(folderInput)));

        const buttons = drop.createDiv('garden-drop-buttons');
        buttons.createEl('button', { type: 'button', text: 'Files…' })
            .addEventListener('click', () => fileInput.click());
        buttons.createEl('button', { type: 'button', text: 'Folder…' })
            .addEventListener('click', () => folderInput.click());

        for (const type of ['dragenter', 'dragover'] as const) {
            drop.addEventListener(type, (e: DragEvent) => {
                e.preventDefault();
                drop.addClass('is-over');
            });
        }
        for (const type of ['dragleave', 'dragend'] as const) {
            drop.addEventListener(type, () => drop.removeClass('is-over'));
        }
        drop.addEventListener('drop', (e: DragEvent) => {
            e.preventDefault();
            drop.removeClass('is-over');
            if (e.dataTransfer) void this.readDrop(e.dataTransfer);
        });

        this.status = contentEl.createDiv('garden-files-status');
    }

    private setStatus(lines: string[]) {
        if (!this.status) return;
        this.status.empty();
        for (const line of lines) this.status.createEl('p', { text: line });
        return this.status;
    }

    private async download(button: HTMLButtonElement) {
        if (this.busy) return;
        this.busy = true;
        button.disabled = true;
        this.setStatus(['Packing…']);
        try {
            const { name, bytes } = await gardenArchive(this.app);
            saveToDisk(name, bytes);
            this.setStatus([`Saved ${name}.`]);
        } catch (e) {
            console.error('Garden Cells: export failed', e);
            this.setStatus([`Could not build the archive: ${message(e)}`]);
        } finally {
            button.disabled = false;
            this.busy = false;
        }
    }

    private async readDrop(transfer: DataTransfer) {
        this.setStatus(['Reading…']);
        await this.read(await pickedFromDrop(transfer));
    }

    private async read(picked: PickedFile[]) {
        if (this.busy) return;
        if (picked.length === 0) return;
        this.busy = true;
        this.setStatus(['Reading…']);
        try {
            const { files, unreadable } = await toVaultFiles(picked);
            const result = vaultFilesToGarden(files);
            const status = this.setStatus(describeImport(result, unreadable));
            if (result.projects.length > 0 && status) this.offerModes(status, result);
        } catch (e) {
            console.error('Garden Cells: import failed', e);
            this.setStatus([`Could not read those files: ${message(e)}`]);
        } finally {
            this.busy = false;
        }
    }

    private offerModes(status: HTMLElement, result: ImportResult) {
        const current = this.app.gardenData.length;
        new Setting(status)
            .setName('Keep what is here?')
            .setDesc(current === 0
                ? 'The garden is empty, so either works.'
                : 'Merge updates matching plants and keeps the rest. Replace discards the open garden.')
            .addButton((btn) => btn.setButtonText('Merge').setCta().onClick(() => void this.apply(result, 'merge')))
            .addButton((btn) => btn.setButtonText('Replace').setWarning().onClick(() => void this.apply(result, 'replace')));
    }

    private async apply(result: ImportResult, mode: ImportMode) {
        if (this.busy) return;
        this.busy = true;
        this.setStatus(['Planting…']);
        try {
            this.setStatus([await applyImport(this.app, result, mode)]);
        } catch (e) {
            console.error('Garden Cells: import failed', e);
            this.setStatus([`Could not save the imported garden: ${message(e)}`]);
        } finally {
            this.busy = false;
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}

function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// --- Opening it, and the corner button ------------------------------------

/** Export or import, opened from a row in the pill menu. */
export function openGardenFiles(app: GardenApp) {
    new GardenFilesModal(app).open();
}

/**
 * The corner button that shows or hides the board under the garden. Mounted on
 * the boot host, so it survives the view's re-renders. The choice stays on this
 * device.
 */
export class BoardToggleButton {
    el: HTMLElement;
    private static readonly KEY = 'cells.garden/board';

    constructor(host: HTMLElement) {
        this.el = host.createEl('button', { cls: 'garden-board-toggle', attr: { type: 'button' } });
        this.el.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="1.3"/></svg>';
        let hidden = false;
        try {
            hidden = localStorage.getItem(BoardToggleButton.KEY) === 'hidden';
        } catch {
            // Blocked storage: the board starts shown.
        }
        this.apply(hidden);
        this.el.addEventListener('click', (e) => {
            e.stopPropagation();
            const next = document.documentElement.dataset.board !== 'hidden';
            try {
                localStorage.setItem(BoardToggleButton.KEY, next ? 'hidden' : 'shown');
            } catch {
                // The board still toggles for this visit.
            }
            this.apply(next);
        });
    }

    private apply(hidden: boolean) {
        document.documentElement.dataset.board = hidden ? 'hidden' : 'shown';
        const label = hidden ? 'Show the board' : 'Hide the board';
        this.el.title = label;
        this.el.setAttribute('aria-label', label);
        this.el.toggleClass('is-active', !hidden);
    }
}

/** Without an account there is no pill menu, so export and import keep a button. */
export class GardenFilesButton {
    el: HTMLElement;

    constructor(app: GardenApp, host: HTMLElement) {
        this.el = host.createEl('button', {
            cls: 'garden-files-button',
            text: 'Files',
            attr: { type: 'button', title: 'Export or import your garden' },
        });
        this.el.addEventListener('click', (e) => {
            e.stopPropagation();
            openGardenFiles(app);
        });
    }
}
