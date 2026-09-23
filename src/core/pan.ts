/**
 * Pan view, for fingers: the garden alone on the whole screen, where a drag
 * pans it, a pinch zooms it and no touch reaches the page around it. Obsidian's
 * mobile app turns a sideways swipe into another tab or a sidebar, and a phone
 * browser turns one from the edge into back or forward; in pan view neither
 * happens.
 *
 * The button shows on touch screens only. It lifts the view's content into a
 * layer on the body: position: fixed alone stays trapped inside a transformed
 * or contained ancestor, which an Obsidian workspace leaf can be. The X sits
 * exactly where the button is, and it or Escape puts the content back where it
 * came from.
 */
import './shim';
import { ICONS, setIcon } from './icons';

/** The view's part in a move: what it notes before, and what it puts right after. */
export interface PanViewHooks {
    /** Just before the content moves, into the layer or back. */
    beforeMove(entering: boolean): void;
    /** Just after it moved, laid out at its new size. */
    afterMove(entering: boolean): void;
}

/** Everything a finger sends. In pan view it all ends at the layer. */
const GESTURES = ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel'];

/**
 * The garden already handles each of these itself. Past the layer they would
 * reach the host, which may swipe for them whatever the garden prevented.
 */
function keepGesture(e: Event) {
    e.stopPropagation();
    if (e.type === 'touchmove' && e.cancelable) e.preventDefault();
}

/** One per garden view: its pan button, the layer the button opens, and the way back. */
export class PanView {
    /** The corner button that opens pan view, on the host so the view's re-renders leave it be. */
    readonly button: HTMLButtonElement;
    private layer: HTMLElement | null = null;
    private exitButton: HTMLButtonElement | null = null;
    /** Keeps the content's place in the host while it is away. */
    private marker: Comment | null = null;

    constructor(private host: HTMLElement, private content: HTMLElement, private hooks: PanViewHooks) {
        this.button = host.createEl('button', {
            cls: 'garden-pan-toggle',
            attr: { type: 'button', title: 'Pan view', 'aria-label': 'Pan view' },
        });
        setIcon(this.button, ICONS.pan);
        this.button.addEventListener('click', (e) => {
            e.stopPropagation();
            this.enter();
        });
    }

    get active(): boolean {
        return this.marker !== null;
    }

    enter() {
        if (this.active || !this.content.parentNode) return;
        const doc = this.host.ownerDocument;
        // A cell being written in would lose its caret to the move without saving.
        const focused = doc.activeElement as HTMLElement | null;
        if (focused && this.content.contains(focused)) focused.blur();

        this.hooks.beforeMove(true);
        const layer = this.layer ?? this.buildLayer();
        this.marker = doc.createComment('cells.garden pan view');
        this.content.before(this.marker);
        layer.prepend(this.content);
        doc.body.appendChild(layer);
        this.placeExit();
        doc.defaultView?.addEventListener('resize', this.placeExit);
        this.hooks.afterMove(true);
    }

    exit() {
        const marker = this.marker;
        if (!marker) return;
        this.hooks.beforeMove(false);
        marker.replaceWith(this.content);
        this.marker = null;
        this.layer?.remove();
        this.host.ownerDocument.defaultView?.removeEventListener('resize', this.placeExit);
        this.hooks.afterMove(false);
    }

    private buildLayer(): HTMLElement {
        const layer = createDiv('garden-pan-layer');
        for (const type of GESTURES) layer.addEventListener(type, keepGesture, { passive: false });

        const exit = layer.createEl('button', {
            cls: 'garden-pan-exit',
            attr: { type: 'button', title: 'Exit pan view', 'aria-label': 'Exit pan view' },
        });
        setIcon(exit, ICONS.close);
        exit.addEventListener('click', (e) => {
            e.stopPropagation();
            this.exit();
        });

        this.layer = layer;
        this.exitButton = exit;
        return layer;
    }

    /**
     * The X goes exactly where the pan button is, which the layer covers but
     * leaves laid out, so a turn of the phone moves both alike. Without the
     * button on screen, the X keeps to its corner in chrome.css.
     */
    private placeExit = () => {
        const layer = this.layer;
        const exit = this.exitButton;
        if (!layer || !exit) return;
        const at = this.button.getBoundingClientRect();
        const frame = layer.getBoundingClientRect();
        const shown = at.width > 0 && at.height > 0;
        exit.setCssProps({
            '--pan-exit-top': shown ? `${at.top - frame.top}px` : '',
            '--pan-exit-right': shown ? `${frame.right - at.right}px` : '',
        });
    };
}
