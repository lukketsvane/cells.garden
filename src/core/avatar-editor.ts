/**
 * The picture editor: paint the 7 by 7 pixels of a profile picture in the
 * palette every picture shares, and see it at the sizes the app shows it. It
 * starts from the current picture, a drawing or the generated one. It knows
 * nothing about accounts: whoever opens it says how to keep the result, so it
 * opens on its own too.
 */
import './shim';
import { avatarEl, decodeDrawing, encodeDrawing, fromSeed, GRID, isMirrored, PALETTE } from './avatar';
import { setIcon } from './icons';
import { attempt } from './share-ui';
import { Modal, Setting } from './ui';

export interface AvatarEditorOptions {
    /** The generated picture's seed, drawn from when there is no drawing yet. */
    seed: string;
    /** The drawing to go on with, or null to start from the generated picture. */
    drawing: string | null;
    /**
     * Keep the result: a drawing, or null to go back to the generated picture.
     * A failure keeps the editor open and is said on its status line.
     */
    save: (drawing: string | null) => Promise<void>;
}

/** The sizes the app shows pictures at: Settings, lists, the pill. */
const PREVIEW_SIZES = [48, 24, 18];

/** The corners the circle cuts off, darkened over the grid. The view is the 7 by 7 inside the 9 by 9 picture. */
const MASK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="1 1 7 7" aria-hidden="true">'
    + '<path fill="currentColor" fill-rule="evenodd" d="M1 1h7v7H1z M0 4.5a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0z"/></svg>';

const LEAF = 7;

const STEPS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

export class AvatarEditorModal extends Modal {
    private bg: number;
    private cells: number[];
    private brush: number;
    private mirror: boolean;
    private cursor = Math.floor((GRID * GRID) / 2);
    private busy = false;

    private cellEls: HTMLElement[] = [];
    private swatchEls: HTMLElement[] = [];
    private previewsEl: HTMLElement | null = null;
    private bgSwatchEl: HTMLElement | null = null;
    private bgButtonEl: HTMLButtonElement | null = null;

    constructor(private readonly options: AvatarEditorOptions) {
        super();
        const start = decodeDrawing(options.drawing) ?? fromSeed(options.seed);
        this.bg = start.bg;
        this.cells = start.cells;
        this.mirror = isMirrored(start.cells);
        this.brush = mostUsed(start.cells, start.bg) ?? LEAF;
    }

    onOpen() {
        this.modalEl.addClass('avatar-editor-modal');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Draw your picture' });
        const editor = contentEl.createDiv('avatar-editor');

        const stage = editor.createDiv('avatar-editor-stage');
        this.buildGrid(stage.createDiv({
            cls: 'avatar-editor-grid',
            attr: { tabindex: '0', role: 'group', 'aria-label': 'Picture, 7 by 7 pixels' },
        }));
        this.previewsEl = stage.createDiv({ cls: 'avatar-editor-previews', attr: { 'aria-label': 'Preview' } });

        const palette = editor.createDiv({ cls: 'avatar-editor-palette', attr: { role: 'group', 'aria-label': 'Colours' } });
        this.swatchEls = PALETTE.map((colour, i) => {
            const swatch = palette.createEl('button', {
                cls: i === 0 ? 'avatar-swatch is-empty' : 'avatar-swatch',
                type: 'button',
                attr: { 'aria-label': i === 0 ? 'Erase' : colour.name, title: i === 0 ? 'Erase' : colour.name },
            });
            if (i > 0) swatch.style.backgroundColor = colour.hex;
            swatch.addEventListener('click', () => {
                this.brush = i;
                this.drawSwatches();
            });
            return swatch;
        });

        // The switch sits before its name, and the name flips it too.
        const tools = new Setting(editor).setName('Mirror');
        tools.settingEl.addClass('avatar-editor-tools');
        tools.addToggle((t) => {
            t.setValue(this.mirror).onChange((on) => { this.mirror = on; });
            t.toggleEl.setAttribute('aria-label', 'Mirror');
            tools.nameEl.prepend(t.toggleEl);
            tools.nameEl.addEventListener('click', (e) => {
                if (e.target === tools.nameEl) t.toggleEl.click();
            });
        });
        tools.addButton((b) => {
            b.setButtonText('Background').onClick(() => {
                if (this.brush === 0) return;
                this.bg = this.brush;
                this.drawAll();
            });
            b.buttonEl.setAttribute('title', 'Fill the background with the chosen colour');
            this.bgSwatchEl = createSpan('avatar-editor-bg-swatch');
            b.buttonEl.prepend(this.bgSwatchEl);
            this.bgButtonEl = b.buttonEl;
        });
        tools.addButton((b) => b.setButtonText('Clear').onClick(() => {
            this.cells.fill(0);
            this.drawAll();
        }));

        const status = contentEl.createDiv('auth-status');
        const say = (text: string) => status.setText(text);
        const keep = (drawing: string | null) => {
            if (this.busy) return;
            this.busy = true;
            void attempt(say, 'save the picture', async () => {
                await this.options.save(drawing);
                this.close();
            }).finally(() => { this.busy = false; });
        };

        const actions = new Setting(contentEl);
        actions.settingEl.addClass('avatar-editor-actions');
        if (this.options.drawing) {
            actions.addButton((b) => {
                b.setButtonText('Use generated').onClick(() => keep(null));
                b.buttonEl.addClass('avatar-editor-generated');
            });
        }
        actions
            .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
            .addButton((b) => b.setButtonText('Save').setCta().onClick(() => keep(encodeDrawing({ bg: this.bg, cells: this.cells }))));

        this.drawAll();
    }

    /** The grid: drag to paint with a finger or the mouse; arrows and space with the keyboard. */
    private buildGrid(grid: HTMLElement) {
        this.cellEls = Array.from({ length: GRID * GRID }, () => grid.createDiv('avatar-editor-cell'));
        setIcon(grid.createDiv('avatar-editor-mask'), MASK);

        const cellAt = (e: PointerEvent) => {
            const box = grid.getBoundingClientRect();
            const x = Math.floor(((e.clientX - box.left) / box.width) * GRID);
            const y = Math.floor(((e.clientY - box.top) / box.height) * GRID);
            return x >= 0 && x < GRID && y >= 0 && y < GRID ? y * GRID + x : -1;
        };

        // A stroke paints the brush, or clears when it starts on a pixel already that colour.
        let stroke: { pointer: number; value: number } | null = null;
        grid.addEventListener('pointerdown', (e) => {
            const i = cellAt(e);
            if (e.button !== 0 || i < 0) return;
            e.preventDefault();
            try {
                grid.setPointerCapture(e.pointerId);
            } catch {
                // A pointer the browser no longer tracks: paint this pixel only.
            }
            stroke ={ pointer: e.pointerId, value: this.cells[i] === this.brush ? 0 : this.brush };
            this.cursor = i;
            this.paint(i, stroke.value);
        });
        grid.addEventListener('pointermove', (e) => {
            if (!stroke || e.pointerId !== stroke.pointer) return;
            const i = cellAt(e);
            if (i >= 0) this.paint(i, stroke.value);
        });
        const end = (e: PointerEvent) => {
            if (stroke?.pointer === e.pointerId) stroke = null;
        };
        grid.addEventListener('pointerup', end);
        grid.addEventListener('pointercancel', end);
        grid.addEventListener('lostpointercapture', end);

        grid.addEventListener('keydown', (e) => {
            const x = this.cursor % GRID;
            const y = Math.floor(this.cursor / GRID);
            const move = STEPS[e.key];
            if (move) {
                e.preventDefault();
                const nx = Math.min(GRID - 1, Math.max(0, x + move[0]));
                const ny = Math.min(GRID - 1, Math.max(0, y + move[1]));
                this.cursor = ny * GRID + nx;
                this.drawCells();
            } else if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                this.paint(this.cursor, this.cells[this.cursor] === this.brush ? 0 : this.brush);
            }
        });
    }

    /** Set pixel `i`, and its twin across the middle when mirroring. */
    private paint(i: number, value: number) {
        const twin = Math.floor(i / GRID) * GRID + (GRID - 1 - (i % GRID));
        let changed = false;
        for (const j of this.mirror ? [i, twin] : [i]) {
            if (this.cells[j] === value) continue;
            this.cells[j] = value;
            changed = true;
        }
        if (changed) this.drawAll();
        else this.drawCells();
    }

    private drawAll() {
        this.drawCells();
        this.drawSwatches();
        this.drawPreviews();
    }

    private drawCells() {
        const bg = PALETTE[this.bg].hex;
        this.cellEls.forEach((el, i) => {
            el.style.backgroundColor = this.cells[i] ? PALETTE[this.cells[i]].hex : bg;
            el.toggleClass('is-cursor', i === this.cursor);
        });
    }

    private drawSwatches() {
        this.swatchEls.forEach((el, i) => {
            el.toggleClass('is-active', i === this.brush);
            el.setAttribute('aria-pressed', String(i === this.brush));
        });
        if (this.bgSwatchEl) this.bgSwatchEl.style.backgroundColor = PALETTE[this.bg].hex;
        // Erasing leaves no colour to fill the background with.
        if (this.bgButtonEl) this.bgButtonEl.disabled = this.brush === 0;
    }

    private drawPreviews() {
        const el = this.previewsEl;
        if (!el) return;
        const drawing = encodeDrawing({ bg: this.bg, cells: this.cells });
        el.replaceChildren(...PREVIEW_SIZES.map(size => avatarEl(drawing, size, 'garden-avatar avatar-editor-preview')));
    }
}

/** The colour used most in a drawing, other than the background, or null for an empty one. */
function mostUsed(cells: readonly number[], bg: number): number | null {
    const counts = new Map<number, number>();
    for (const c of cells) if (c && c !== bg) counts.set(c, (counts.get(c) ?? 0) + 1);
    let best: number | null = null;
    for (const [c, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = c;
    return best;
}
