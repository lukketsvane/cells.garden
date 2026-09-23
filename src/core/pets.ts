import './shim';
import type { GardenApp } from './app';
import type { GardenSettings } from './model';
import { Modal } from './ui';
import { CROW_PREVIEW_URL, mountCrowNPC } from './crow';

import gnomeUrl from '../assets/pets/gnome.png';
import pumpkinOffUrl from '../assets/pack/pumpkin/pumpkin_1_off.png';
import pumpkin1Url from '../assets/pack/pumpkin/pumpkin_1_on_1.png';
import pumpkin2Url from '../assets/pack/pumpkin/pumpkin_1_on_2.png';
import pumpkin3Url from '../assets/pack/pumpkin/pumpkin_1_on_3.png';

type PetSettingKey = 'petGnome' | 'petPumpkin' | 'petCrow';

/** `available: false` keeps a pet in the grid, greyed out, and out of the scene. */
type PetOption = { key: PetSettingKey; label: string; preview: string; available: boolean };

const PETS: PetOption[] = [
    { key: 'petGnome', label: 'Garden gnome', preview: gnomeUrl, available: false },
    { key: 'petPumpkin', label: 'Pumpkin', preview: pumpkin1Url, available: false },
    { key: 'petCrow', label: 'Crow', preview: CROW_PREVIEW_URL, available: false },
];

const isAvailable = (key: PetSettingKey) => PETS.some((pet) => pet.key === key && pet.available);

/** What the menu reports, so an unavailable pet never counts as on. */
export function activePetCount(settings: GardenSettings) {
    return PETS.filter((pet) => pet.available && settings[pet.key]).length;
}

export class PetsModal extends Modal {
    constructor(private readonly app: GardenApp) {
        super();
    }

    onOpen() {
        this.modalEl.addClass('share-modal');
        this.modalEl.addClass('garden-pets-modal');
        this.render();
    }

    private render() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Pets' });

        const grid = contentEl.createDiv('garden-pets-grid');
        for (const pet of PETS) {
            if (!pet.available) {
                const tile = grid.createEl('button', {
                    cls: 'garden-pet-tile is-unavailable',
                    attr: {
                        type: 'button',
                        disabled: 'true',
                        'aria-label': pet.label + ', unavailable',
                        'data-pet': pet.key,
                    },
                });
                const preview = tile.createDiv('garden-pet-tile-preview');
                preview.createEl('img', { attr: { src: pet.preview, alt: '' } });
                tile.createSpan({ cls: 'garden-pet-tile-name', text: pet.label });
                tile.createSpan({ cls: 'garden-pet-tile-state', text: 'Unavailable' });
                continue;
            }

            const active = Boolean(this.app.settings[pet.key]);
            const tile = grid.createEl('button', {
                cls: 'garden-pet-tile',
                attr: {
                    type: 'button',
                    'aria-pressed': String(active),
                    'aria-label': pet.label + (active ? ', on' : ', off'),
                    'data-pet': pet.key,
                },
            });
            tile.toggleClass('is-active', active);

            const preview = tile.createDiv('garden-pet-tile-preview');
            preview.createEl('img', { attr: { src: pet.preview, alt: '' } });
            tile.createSpan({ cls: 'garden-pet-tile-name', text: pet.label });
            tile.createSpan({ cls: 'garden-pet-tile-state', text: active ? 'On' : 'Off' });

            tile.addEventListener('click', () => {
                const next = !this.app.settings[pet.key];
                this.app.settings = { ...this.app.settings, [pet.key]: next };
                this.app.view?.scheduleRender();
                void this.app.saveGardenData();
                this.render();
            });
        }
    }
}

function bindTap(el: HTMLElement, action: () => void) {
    let press: { x: number; y: number } | null = null;

    el.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    el.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
    el.addEventListener('touchend', (e) => e.stopPropagation(), { passive: true });

    el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        press = { x: e.clientX, y: e.clientY };
        el.setPointerCapture?.(e.pointerId);
    });

    el.addEventListener('pointerup', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const start = press;
        press = null;
        if (!start) return;
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 12) action();
    });

    el.addEventListener('pointercancel', () => { press = null; });
    el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        action();
    });
}

function makePetButton(layer: HTMLElement, cls: string, label: string) {
    return layer.createEl('button', {
        cls: 'garden-pet ' + cls,
        attr: { type: 'button', 'aria-label': label },
    });
}

/**
 * A pet that is greyed out in the grid never joins the scene either: a garden
 * saved while it was still switchable must not keep one standing there. Every
 * pet is unavailable at the moment, so this mounts nothing.
 */
export function renderGardenPets(world: HTMLElement, settings: GardenSettings) {
    const on = (key: PetSettingKey) => isAvailable(key) && Boolean(settings[key]);
    if (!on('petPumpkin') && !on('petCrow')) return;
    const layer = world.createDiv('garden-pets-layer');

    if (on('petCrow')) {
        mountCrowNPC(layer);
    }

    if (on('petPumpkin')) {
        const pumpkin = makePetButton(layer, 'garden-pet-pumpkin', 'Pumpkin. Tap to make it jump.');
        pumpkin.style.setProperty('--pumpkin-off', 'url("' + pumpkinOffUrl + '")');
        pumpkin.style.setProperty('--pumpkin-1', 'url("' + pumpkin1Url + '")');
        pumpkin.style.setProperty('--pumpkin-2', 'url("' + pumpkin2Url + '")');
        pumpkin.style.setProperty('--pumpkin-3', 'url("' + pumpkin3Url + '")');

        const pop = () => {
            if (pumpkin.classList.contains('is-startled')) return;
            pumpkin.classList.add('is-startled');
        };
        pumpkin.addEventListener('animationend', (e) => {
            if ((e as AnimationEvent).animationName === 'garden-pumpkin-pop') {
                pumpkin.classList.remove('is-startled');
            }
        });
        bindTap(pumpkin, pop);
    }
}
