/**
 * The picture editor: paint the 7 by 7 pixels of a profile picture in the
 * palette every picture shares, and see it at the sizes the app shows it. It
 * starts from the current picture, a drawing or the generated one. It knows
 * nothing about accounts: whoever opens it says how to keep the result, so it
 * opens on its own too. A build trying out 12 by 12 pictures (PICTURE_GRID)
 * paints those, in their palette, and grows a 7 by 7 drawing to go on with.
 */
import './shim';
import { avatarEl, blankOf, decodeDrawing, encodeDrawing, fromSeed, gridOf, isMirrored, paletteFor, PICTURE_GRID, toTwelve } from './avatar';
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

/** The corners the circle cuts off, darkened over the grid. The view is the grid inside the picture, a pixel wider all round. */
function mask(grid: number): string {
    const r = (grid + 2) / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="1 1 ${grid} ${grid}" aria-hidden="true">`
        + `<path fill="currentColor" fill-rule="evenodd" d="M1 1h${grid}v${grid}H1z M0 ${r}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 -${2 * r} 0z"/></svg>`;
}

const LEAF = 7;

const STEPS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

export class AvatarEditorModal extends Modal {
    private bg: number;
    private cells: number[];
    /** The side of the picture being painted, and the palette it is painted from. */
    private readonly grid: number;
    private readonly palette: ReturnType<typeof paletteFor>;
    private brush: number;
    private mirror: boolean;
    private cursor: number;
    private busy = false;

    private cellEls: HTMLElement[] = [];
    private swatchEls: HTMLElement[] = [];
    private previewsEl: HTMLElement | null = null;
    private bgSwatchEl: HTMLElement | null = null;
    private bgButtonEl: HTMLButtonElement | null = null;

    constructor(private readonly options: AvatarEditorOptions) {
        super();
        const found = decodeDrawing(options.drawing) ?? fromSeed(options.seed);
        const start = PICTURE_GRID === 12 ? toTwelve(found) : found;
        this.bg = start.bg;
        this.cells = start.cells;
        this.grid = gridOf(start.cells);
        this.palette = paletteFor(this.grid);
        this.cursor = Math.floor((this.grid * this.grid) / 2);
        this.mirror = isMirrored(start.cells);
        this.brush = mostUsed(start.cells, start.bg, blankOf(start)) ?? LEAF;
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
            attr: { tabindex: '0', role: 'group', 'aria-label': `Picture, ${this.grid} by ${this.grid} pixels` },
        }));
        this.previewsEl = stage.createDiv({ cls: 'avatar-editor-previews', attr: { 'aria-label': 'Preview' } });

        const palette = editor.createDiv({ cls: 'avatar-editor-palette', attr: { role: 'group', 'aria-label': 'Colours' } });
        this.swatchEls = this.palette.map((colour, i) => {
            const swatch = palette.createEl('button', {
                cls: colour.hex ? 'avatar-swatch' : 'avatar-swatch is-empty',
                type: 'button',
                attr: { 'aria-label': colour.hex ? colour.name : 'Erase', title: colour.hex ? colour.name : 'Erase' },
            });
            if (colour.hex) swatch.style.backgroundColor = colour.hex;
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
                if (!this.palette[this.brush].hex) return;
                // In the avatar palette a blank pixel is one in the background's colour: those follow it.
                const blank = this.blank;
                this.bg = this.brush;
                if (blank !== 0) this.cells = this.cells.map(c => (c === blank ? this.bg : c));
                this.drawAll();
            });
            b.buttonEl.setAttribute('title', 'Fill the background with the chosen colour');
            this.bgSwatchEl = createSpan('avatar-editor-bg-swatch');
            b.buttonEl.prepend(this.bgSwatchEl);
            this.bgButtonEl = b.buttonEl;
        });
        tools.addButton((b) => b.setButtonText('Clear').onClick(() => {
            this.cells.fill(this.blank);
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
        const side = this.grid;
        grid.style.setProperty('--avatar-grid', String(side));
        this.cellEls = Array.from({ length: side * side }, () => grid.createDiv('avatar-editor-cell'));
        setIcon(grid.createDiv('avatar-editor-mask'), mask(side));

        const cellAt = (e: PointerEvent) => {
            const box = grid.getBoundingClientRect();
            const x = Math.floor(((e.clientX - box.left) / box.width) * side);
            const y = Math.floor(((e.clientY - box.top) / box.height) * side);
            return x >= 0 && x < side && y >= 0 && y < side ? y * side + x : -1;
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
            stroke ={ pointer: e.pointerId, value: this.cells[i] === this.brush ? this.blank : this.brush };
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
            const x = this.cursor % side;
            const y = Math.floor(this.cursor / side);
            const move = STEPS[e.key];
            if (move) {
                e.preventDefault();
                const nx = Math.min(side - 1, Math.max(0, x + move[0]));
                const ny = Math.min(side - 1, Math.max(0, y + move[1]));
                this.cursor = ny * side + nx;
                this.drawCells();
            } else if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                this.paint(this.cursor, this.cells[this.cursor] === this.brush ? this.blank : this.brush);
            }
        });
    }

    /** Set pixel `i`, and its twin across the middle when mirroring. */
    private paint(i: number, value: number) {
        const side = this.grid;
        const twin = Math.floor(i / side) * side + (side - 1 - (i % side));
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

    /** What a pixel with nothing on it holds (blankOf): the empty slot, or in the avatar palette the background. */
    private get blank(): number {
        return blankOf({ bg: this.bg, cells: this.cells });
    }

    private drawCells() {
        const bg = this.palette[this.bg].hex;
        const blank = this.blank;
        this.cellEls.forEach((el, i) => {
            el.style.backgroundColor = this.cells[i] === blank ? bg : this.palette[this.cells[i]].hex;
            el.toggleClass('is-cursor', i === this.cursor);
        });
    }

    private drawSwatches() {
        this.swatchEls.forEach((el, i) => {
            el.toggleClass('is-active', i === this.brush);
            el.setAttribute('aria-pressed', String(i === this.brush));
        });
        if (this.bgSwatchEl) this.bgSwatchEl.style.backgroundColor = this.palette[this.bg].hex;
        // Erasing leaves no colour to fill the background with.
        if (this.bgButtonEl) this.bgButtonEl.disabled = !this.palette[this.brush].hex;
    }

    private drawPreviews() {
        const el = this.previewsEl;
        if (!el) return;
        const drawing = encodeDrawing({ bg: this.bg, cells: this.cells });
        el.replaceChildren(...PREVIEW_SIZES.map(size => avatarEl(drawing, size, 'garden-avatar avatar-editor-preview')));
    }
}

/** The colour used most in a drawing, other than the background, or null for an empty one. */
function mostUsed(cells: readonly number[], bg: number, blank: number): number | null {
    const counts = new Map<number, number>();
    for (const c of cells) if (c !== blank && c !== bg) counts.set(c, (counts.get(c) ?? 0) + 1);
    let best: number | null = null;
    for (const [c, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = c;
    return best;
}
