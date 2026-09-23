/**
 * The item layer: things that stand in the garden, put there from the Items
 * menu. A gnome just stands; a pumpkin stands too, and lights up at night.
 * Neither is alive: an item never moves by itself and a tap does nothing. It
 * drags along the ground with a mouse or a finger, and a right-click or a
 * hold offers Remove.
 *
 * Items are garden settings (GardenItem in model.ts), so everyone who shares
 * the garden sees them where they were put. Only a build with the extras
 * (extras.ts) draws them or offers the menu.
 */
import './shim';
import type { GardenApp } from './app';
import { openMenu } from './menu';
import type { GardenItem, GardenSettings, ItemKind } from './model';
import { pictureTile } from './tiles';
import { Modal } from './ui';

import gnomeUrl from '../assets/pets/gnome.png';
import pumpkinOffUrl from '../assets/pack/pumpkin/pumpkin_1_off.png';
import pumpkinOn1Url from '../assets/pack/pumpkin/pumpkin_1_on_1.png';
import pumpkinOn2Url from '../assets/pack/pumpkin/pumpkin_1_on_2.png';
import pumpkinOn3Url from '../assets/pack/pumpkin/pumpkin_1_on_3.png';

/** A kind of item: its name and its sprite. */
export interface ItemType {
    kind: ItemKind;
    label: string;
    sprite: string;
    /** At night the sprite gives way to these, shown in turn (a lit pumpkin). Each the sprite's size. */
    lit?: string[];
    /** The picture on its tile in the Items menu. */
    preview: string;
}

/** Every item. A new one is its art and one more entry here (and its kind in ItemKind). */
export const ITEM_TYPES: ItemType[] = [
    { kind: 'gnome', label: 'Garden gnome', sprite: gnomeUrl, preview: gnomeUrl },
    {
        kind: 'pumpkin',
        label: 'Pumpkin',
        sprite: pumpkinOffUrl,
        lit: [pumpkinOn1Url, pumpkinOn2Url, pumpkinOn3Url],
        preview: pumpkinOn1Url,
    },
];

const typeOf = (kind: string) => ITEM_TYPES.find(type => type.kind === kind);

/** The items this client draws: those of a kind it knows. */
export function shownItems(settings: GardenSettings): GardenItem[] {
    return settings.items.filter(item => typeOf(item.kind));
}

/** What the item layer needs from the garden view. */
export interface ItemGround {
    /** The world's width, in world px. Items stand inside it. */
    width: number;
    /** An item's x (plant slots, see GardenItem) in world px, and back. */
    toWorld(x: number): number;
    toSlot(worldX: number): number;
    /** A sprite's size in the world: its own size times PIXEL_SCALE. */
    spriteSize(url: string): Promise<{ width: number; height: number }>;
    /** Told when a drag starts (with the item) and ends (null): the view holds its redraws meanwhile. */
    onDrag(item: HTMLElement | null): void;
}

/** A finger held this long without moving opens the item's menu on release, as on a cell. */
const HOLD_MS = 450;
/** A press that moves further than this, in screen px, is a drag. */
const MOVE_TOLERANCE = 8;
/** How long one round of a lit item's frames takes, in seconds; each starts at a different point of it. */
const FLICKER_SECONDS = 1.2;

/** An x as stored: a thousandth of a slot is a third of a world pixel, plenty. */
const storedX = (x: number) => Math.round(x * 1000) / 1000;

function saveItems(app: GardenApp, items: GardenItem[]) {
    app.settings = { ...app.settings, items };
    void app.saveGardenData();
}

/** Put a new item on the ground in the middle of the camera's view, where no plant hides it (GardenView.itemSpot). */
export function placeItem(app: GardenApp, kind: ItemKind) {
    const id = kind + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const x = app.view?.itemSpot(app.settings.items.map(item => item.x)) ?? 0;
    saveItems(app, [...app.settings.items, { id, kind, x: storedX(x) }]);
    app.view?.scheduleRender();
}

function moveItem(app: GardenApp, id: string, x: number) {
    saveItems(app, app.settings.items.map(item => (item.id === id ? { ...item, x: storedX(x) } : item)));
}

function removeItem(app: GardenApp, id: string) {
    saveItems(app, app.settings.items.filter(item => item.id !== id));
    app.view?.scheduleRender();
}

/**
 * Draw the garden's items into `world` and return their layer, which the view
 * marks `is-night` while the stars are out. Each sprite is measured first, so
 * it stands at its own size times PIXEL_SCALE with its feet on the horizon.
 */
export async function renderGardenItems(world: HTMLElement, app: GardenApp, ground: ItemGround): Promise<HTMLElement> {
    const layer = world.createDiv('garden-items-layer');
    const items = shownItems(app.settings);
    const sizes = new Map<string, { width: number; height: number }>();
    await Promise.all(ITEM_TYPES
        .filter(type => items.some(item => item.kind === type.kind))
        .map(async type => { sizes.set(type.kind, await ground.spriteSize(type.sprite)); }));

    for (const item of items) {
        const type = typeOf(item.kind);
        const size = sizes.get(item.kind);
        if (type && size) drawItem(layer, item, type, size, app, ground);
    }
    return layer;
}

function drawItem(
    layer: HTMLElement,
    item: GardenItem,
    type: ItemType,
    size: { width: number; height: number },
    app: GardenApp,
    ground: ItemGround,
) {
    const el = layer.createEl('button', {
        cls: 'garden-scene-item',
        attr: { type: 'button', 'aria-label': type.label, 'data-kind': type.kind },
    });
    const props: Record<string, string> = {
        '--item-width': size.width + 'px',
        '--item-height': size.height + 'px',
        '--item-sprite': 'url("' + type.sprite + '")',
    };
    if (type.lit) {
        el.dataset.lit = '';
        type.lit.forEach((frame, i) => { props['--item-lit-' + (i + 1)] = 'url("' + frame + '")'; });
        // Two pumpkins side by side should not flicker in step.
        props['--item-flicker-delay'] = (-Math.random() * FLICKER_SECONDS).toFixed(2) + 's';
    }
    el.setCssProps(props);

    // Kept inside the world, so an item is never out in the void.
    const half = size.width / 2;
    const inWorld = (x: number) => Math.max(half, Math.min(ground.width - half, x));
    /** Where it stands, and where it stood before the drag under way. */
    let x = inWorld(ground.toWorld(item.x));
    let settled = x;
    const place = () => { el.style.left = x + 'px'; };
    place();

    let press: { pointer: number; x: number; y: number; at: number; from: number; scale: number; touch: boolean } | null = null;
    let dragging = false;

    const openItemMenu = (at: { x: number; y: number } | HTMLElement) => openMenu(
        [{ label: 'Remove', danger: true, onClick: () => removeItem(app, item.id) }],
        at,
        el.ownerDocument,
    );

    const endDrag = (keep: boolean) => {
        dragging = false;
        el.removeClass('is-dragging');
        ground.onDrag(null);
        if (keep) {
            settled = x;
            moveItem(app, item.id, ground.toSlot(x));
        } else {
            x = settled;
            place();
        }
    };

    // The item handles its own presses: the camera must not pan under a drag,
    // and the touch adapter and the garden's own menu must not see them.
    const keep = (e: Event) => e.stopPropagation();
    el.addEventListener('mousedown', keep);
    el.addEventListener('touchstart', keep, { passive: true });
    el.addEventListener('touchmove', keep, { passive: true });
    // No mouse events may follow a finger: they would close a menu a hold just opened.
    el.addEventListener('touchend', (e) => {
        e.stopPropagation();
        e.preventDefault();
    }, { passive: false });
    el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (dragging) return;
        // From the keyboard the event carries no point: open under the item.
        openItemMenu(e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : el);
    });

    el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || press) return;
        e.stopPropagation();
        const rect = layer.getBoundingClientRect();
        press = {
            pointer: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            at: performance.now(),
            from: x,
            // Screen px per world px: the camera's zoom.
            scale: rect.width / (layer.offsetWidth || rect.width || 1) || 1,
            touch: e.pointerType !== 'mouse',
        };
        el.setPointerCapture?.(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {
        if (!press || e.pointerId !== press.pointer) return;
        const dx = e.clientX - press.x;
        if (!dragging) {
            if (Math.hypot(dx, e.clientY - press.y) <= MOVE_TOLERANCE) return;
            dragging = true;
            el.addClass('is-dragging');
            ground.onDrag(el);
        }
        x = inWorld(press.from + dx / press.scale);
        place();
    });

    el.addEventListener('pointerup', (e) => {
        if (!press || e.pointerId !== press.pointer) return;
        e.stopPropagation();
        const { at, touch } = press;
        press = null;
        if (dragging) endDrag(true);
        else if (touch && performance.now() - at >= HOLD_MS) openItemMenu({ x: e.clientX, y: e.clientY });
        // A plain tap does nothing: an item is not alive.
    });

    const cancel = (e: PointerEvent) => {
        if (!press || e.pointerId !== press.pointer) return;
        press = null;
        if (dragging) endDrag(false);
    };
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('lostpointercapture', cancel);
}

/** Main menu -> Items: one tile per kind; a tap puts one in the garden. */
export class ItemsModal extends Modal {
    constructor(private readonly app: GardenApp) {
        super();
    }

    onOpen() {
        this.modalEl.addClass('share-modal');
        this.modalEl.addClass('garden-tiles-modal');
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Items' });

        const grid = contentEl.createDiv('garden-tiles');
        for (const type of ITEM_TYPES) {
            const count = this.app.settings.items.filter(item => item.kind === type.kind).length;
            pictureTile(grid, {
                kind: type.kind,
                label: type.label,
                preview: type.preview,
                state: count ? count + ' placed' : 'Add',
                onClick: () => {
                    placeItem(this.app, type.kind);
                    // Out of the way, so the new item shows where it landed.
                    this.close();
                },
            });
        }
    }
}
