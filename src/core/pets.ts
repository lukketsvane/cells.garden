/**
 * The pet layer: animals living in the garden, one layer in front of its
 * items and behind the grass and the plants. Each kind moves in its own way,
 * written in a behaviour module of its own (the crow's is crow.ts). The Pets
 * menu switches each on or off per garden; after that it does its own thing.
 *
 * Only a build with the extras (extras.ts) has pets. Without them the Pets
 * menu shows what is coming, greyed out, as it has since before any was ready.
 */
import './shim';
import type { GardenApp } from './app';
import { CROW_PREVIEW_URL, mountCrow } from './crow';
import { EXTRAS } from './extras';
import { ITEM_TYPES } from './items';
import type { GardenSettings } from './model';
import { pictureTile } from './tiles';
import { Modal } from './ui';

/** What a pet knows of the garden around it, in world px. */
export interface PetScene {
    /** The world's width. A pet keeps inside it. */
    width: number;
    /** The ground line, down from the top of the world: where feet go. */
    horizon: number;
    /** The slice of the world the camera shows now, or null while nothing is laid out. */
    view(): { left: number; right: number } | null;
    /** The viewer asked for less motion: pets hold still. */
    reducedMotion: boolean;
}

/** Where a pet stood and which way it looked when the garden last redrew, so a redraw does not send it back to the start. */
export interface PetSpot {
    x: number;
    facing: 1 | -1;
}

/**
 * A pet in the garden. Building it starts nothing: it lives from start() until
 * stop(), which ends every timer and frame it runs and says where it got to.
 */
export interface PetLife {
    start(): void;
    stop(): PetSpot;
}

/** A kind of pet: its switch, its tile in the Pets menu, and the behaviour that brings it to life. */
interface PetType {
    /** The garden setting that switches it on. */
    key: `pet${string}`;
    /** Which sprite this is; styles.css sizes its preview by it. */
    kind: string;
    label: string;
    preview: string;
    /** Build the pet in `layer`, where `spot` says it last stood (null the first time). */
    mount(layer: HTMLElement, scene: PetScene, spot: PetSpot | null): PetLife;
}

/**
 * Every pet. A new one (a frog) is its art, a behaviour module that exports a
 * mount like mountCrow, and one more entry here. Its switch needs no other
 * home: a garden without it reads as off, and a merge keeps a key it has never
 * seen.
 */
const PETS: PetType[] = [
    { key: 'petCrow', kind: 'crow', label: 'Crow', preview: CROW_PREVIEW_URL, mount: mountCrow },
];

function isOn(settings: GardenSettings, key: PetType['key']): boolean {
    return EXTRAS && (settings as unknown as Record<string, unknown>)[key] === true;
}

/** What the menu reports: pets switched on in a build that has them. */
export function activePetCount(settings: GardenSettings) {
    return PETS.filter((pet) => isOn(settings, pet.key)).length;
}

export class PetsModal extends Modal {
    constructor(private readonly app: GardenApp) {
        super();
    }

    onOpen() {
        this.modalEl.addClass('share-modal');
        this.modalEl.addClass('garden-tiles-modal');
        this.render();
    }

    private render() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Pets' });
        const grid = contentEl.createDiv('garden-tiles');

        if (!EXTRAS) {
            // What is coming, greyed out. The gnome and the pumpkin are items
            // now, but this is where people have seen them waiting.
            for (const type of [...ITEM_TYPES, ...PETS]) {
                pictureTile(grid, { kind: type.kind, label: type.label, preview: type.preview, state: 'Unavailable', disabled: true });
            }
            return;
        }

        for (const pet of PETS) {
            const on = isOn(this.app.settings, pet.key);
            pictureTile(grid, {
                kind: pet.kind,
                label: pet.label,
                preview: pet.preview,
                state: on ? 'On' : 'Off',
                pressed: on,
                onClick: () => {
                    this.app.settings = { ...this.app.settings, [pet.key]: !on };
                    this.app.view?.scheduleRender();
                    void this.app.saveGardenData();
                    this.render();
                },
            });
        }
    }
}

/** The pets of one drawing of the garden. */
export interface GardenPets {
    start(): void;
    stop(): void;
}

/**
 * Build the pets switched on in `settings` into `world`, or null when none
 * is. They hold still until the view starts them, once the world is on
 * screen; stop() notes in `spots` where each got to, for the next drawing.
 */
export function renderGardenPets(
    world: HTMLElement,
    settings: GardenSettings,
    scene: PetScene,
    spots: Map<string, PetSpot>,
): GardenPets | null {
    const pets = PETS.filter((pet) => isOn(settings, pet.key));
    if (pets.length === 0) return null;
    const layer = world.createDiv('garden-pets-layer');
    const lives = pets.map((pet) => ({ key: pet.key, life: pet.mount(layer, scene, spots.get(pet.key) ?? null) }));
    return {
        start: () => {
            for (const { life } of lives) life.start();
        },
        stop: () => {
            for (const { key, life } of lives) spots.set(key, life.stop());
        },
    };
}
