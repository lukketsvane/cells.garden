import './shim';
import type { GardenApp } from './app';
import type { GardenSettings } from './model';
import { Modal } from './ui';
import { CROW_PREVIEW_URL, mountCrowNPC } from './crow';

import swanSwimAtlasUrl from '../assets/pets/swan_swim_atlas.png';
import swanFlyAtlasUrl from '../assets/pets/swan_fly_atlas.png';
import swanPreviewUrl from '../assets/pets/swan_preview.png';
import gnomeUrl from '../assets/pets/gnome.png';
import pumpkinOffUrl from '../assets/pack/pumpkin/pumpkin_1_off.png';
import pumpkin1Url from '../assets/pack/pumpkin/pumpkin_1_on_1.png';
import pumpkin2Url from '../assets/pack/pumpkin/pumpkin_1_on_2.png';
import pumpkin3Url from '../assets/pack/pumpkin/pumpkin_1_on_3.png';

type PetSettingKey = 'petSwan' | 'petGnome' | 'petPumpkin' | 'petCrow';

const PETS: { key: PetSettingKey; label: string; preview: string }[] = [
    { key: 'petSwan', label: 'Swan', preview: swanPreviewUrl },
    { key: 'petGnome', label: 'Garden gnome', preview: gnomeUrl },
    { key: 'petPumpkin', label: 'Pumpkin', preview: pumpkin1Url },
    { key: 'petCrow', label: 'Crow', preview: CROW_PREVIEW_URL },
];

/** Main menu -> Pets. Each tile is an immediate on/off switch. */
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
        contentEl.createEl('p', {
            cls: 'setting-item-description',
            text: 'Off by default. Tap a pet to let it live in this garden.',
        });

        const grid = contentEl.createDiv('garden-pets-grid');
        for (const pet of PETS) {
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

function stopSceneGesture(el: HTMLElement, act: () => void) {
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener('touchstart', stop, { passive: true });
    el.addEventListener('mousedown', stop);
    el.addEventListener('click', (e) => {
        e.stopPropagation();
        act();
    });
    el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        act();
    });
}

function makePetButton(layer: HTMLElement, cls: string, label: string) {
    return layer.createEl('button', {
        cls: 'garden-pet ' + cls,
        attr: { type: 'button', 'aria-label': label },
    });
}

type SpriteStrip = {
    key: string;
    url: string;
    frames: number;
    frameMs: number;
};

/**
 * Safari can render optimized transparent GIF sub-rectangles as if each
 * sub-frame were a new image. A fixed-cell PNG strip avoids that entirely:
 * every frame is the same 68x42 canvas and only background-position changes.
 */
function runSpriteStrip(el: HTMLElement, getStrip: () => SpriteStrip) {
    const frameWidth = 68;
    const frameHeight = 42;
    let frame = 0;
    let stripKey = '';

    const tick = () => {
        if (!el.isConnected) return;
        const strip = getStrip();
        if (strip.key !== stripKey) {
            stripKey = strip.key;
            frame = 0;
        }
        el.style.backgroundImage = 'url("' + strip.url + '")';
        el.style.backgroundSize = (strip.frames * frameWidth) + 'px ' + frameHeight + 'px';
        el.style.backgroundPosition = (-frame * frameWidth) + 'px 0';
        frame = (frame + 1) % strip.frames;
        window.setTimeout(tick, strip.frameMs);
    };

    tick();
}

/** Add enabled NPCs to the world. Re-rendering removes disabled pets immediately. */
export function renderGardenPets(world: HTMLElement, settings: GardenSettings) {
    if (!settings.petSwan && !settings.petGnome && !settings.petPumpkin && !settings.petCrow) return;
    const layer = world.createDiv('garden-pets-layer');

    if (settings.petSwan) {
        layer.createDiv('garden-pet-pond');
        const swan = makePetButton(layer, 'garden-pet-swan', 'Swan. Tap to make it fly.');
        const sprite = swan.createDiv('garden-pet-swan-sprite');

        runSpriteStrip(sprite, () => swan.classList.contains('is-flying')
            ? { key: 'fly', url: swanFlyAtlasUrl, frames: 8, frameMs: 95 }
            : { key: 'swim', url: swanSwimAtlasUrl, frames: 10, frameMs: 145 });

        const fly = () => {
            if (swan.classList.contains('is-flying')) return;
            swan.classList.add('is-flying');
        };
        swan.addEventListener('animationend', (e) => {
            if ((e as AnimationEvent).animationName === 'garden-swan-flight') {
                swan.classList.remove('is-flying');
            }
        });
        stopSceneGesture(swan, fly);
    }

    if (settings.petCrow) {
        mountCrowNPC(layer);
    }

    if (settings.petGnome) {
        const gnome = makePetButton(layer, 'garden-pet-gnome', 'Garden gnome. Tap to make it hop.');
        gnome.style.setProperty('--gnome-image', 'url("' + gnomeUrl + '")');
        const hop = () => {
            if (gnome.classList.contains('is-startled')) return;
            gnome.classList.add('is-startled');
        };
        gnome.addEventListener('animationend', (e) => {
            if ((e as AnimationEvent).animationName === 'garden-gnome-hop') {
                gnome.classList.remove('is-startled');
            }
        });
        stopSceneGesture(gnome, hop);
    }

    if (settings.petPumpkin) {
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
        stopSceneGesture(pumpkin, pop);
    }
}
