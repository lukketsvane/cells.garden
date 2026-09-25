/**
 * Settings: the signed-in user's profile (picture and name), the choices that
 * stay on this device (the scene), and the garden's own settings, stored with
 * the garden and shared with everyone in it. Signed out, the profile is left out.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GardenApp } from './app';
import { avatarEl } from './avatar';
import { AccessibilityModal } from './accessibility';
import { AvatarEditorModal } from './avatar-editor';
import { hourOf, skyAt, skyGradient, timeOf } from './garden-settings';
import { ICONS } from './icons';
import { sameData } from './merge';
import { DEFAULT_SETTINGS, type GardenSettings, type SkyNode } from './model';
import { ShortcutsModal } from './modals';
import { currentScene, setScene, type Scene } from './scene';
import { attempt } from './share-ui';
import { getProfile, updateProfile } from './sharing';
import { Modal, Setting } from './ui';
import { pushSetting } from './web-push';

export interface SettingsAccount {
    client: SupabaseClient;
    userId: string;
    /** Tell the rest of the app the picture changed: a drawing or a seed. */
    onAvatar: (avatar: string) => void;
    /** And the name, which is how others see you on the cells they assign you. */
    onName?: (name: string) => void;
}

const randomSeed = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');

export class SettingsModal extends Modal {
    constructor(private readonly account: SettingsAccount | null, private readonly app: GardenApp) {
        super();
    }

    onOpen() {
        this.modalEl.addClass('share-modal');
        void this.render();
    }

    private async render() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Settings' });
        const status = contentEl.createDiv('auth-status');
        const say = (text: string) => status.setText(text);

        if (this.account) {
            const { client, userId, onAvatar } = this.account;
            try {
                const profile = await getProfile(client, userId);

                // Tapping a generated picture rolls a new one. Tapping a drawing
                // edits it instead, so one tap never throws a drawing away; the
                // editor's "Use generated" goes back to the rolled picture.
                let { seed, drawing } = profile;
                const picture = new Setting(contentEl).setName('Picture');
                picture.settingEl.addClass('settings-picture');
                const holder = picture.controlEl.createEl('button', { cls: 'settings-avatar', type: 'button' });
                const showPicture = () => {
                    const label = drawing ? 'Edit your drawing' : 'Roll a new picture';
                    picture.setDesc(drawing ? 'Tap it to edit your drawing.' : 'Tap it to roll a new one, or draw your own.');
                    holder.setAttribute('aria-label', label);
                    holder.title = label;
                    holder.replaceChildren(avatarEl(drawing ?? seed, 48));
                };
                const changed = () => {
                    showPicture();
                    onAvatar(drawing ?? seed);
                };
                const rollPicture = () => void attempt(say, 'save the picture', async () => {
                    const next = randomSeed();
                    await updateProfile(client, userId, { avatar: next });
                    seed = next;
                    changed();
                    say('');
                });
                const drawPicture = () => {
                    if (!profile.canDraw) {
                        say('Drawn pictures are not available yet.');
                        return;
                    }
                    new AvatarEditorModal({
                        seed,
                        drawing,
                        save: async (next) => {
                            await updateProfile(client, userId, { drawing: next });
                            drawing = next;
                            changed();
                            say('');
                        },
                    }).open();
                };
                holder.addEventListener('click', () => (drawing ? drawPicture() : rollPicture()));
                picture.addButton((b) => b.setButtonText('Draw').onClick(drawPicture));
                showPicture();

                let name = profile.name;
                new Setting(contentEl)
                    .setName('Name')
                    .setDesc('What friends see.')
                    .addText((t) => {
                        t.setValue(name);
                        t.onChange((v) => { name = v; });
                        t.inputEl.addEventListener('blur', () => {
                            const trimmed = name.trim();
                            if (!trimmed || trimmed === profile.name) return;
                            void attempt(say, 'save the name', async () => {
                                await updateProfile(client, userId, { name: trimmed });
                                profile.name = trimmed;
                                this.account?.onName?.(trimmed);
                                say('Name saved.');
                            });
                        });
                    });
            } catch (e) {
                say(`Could not load your profile: ${(e as Error).message}`);
            }
            // Pushes to this device; the web app alone has them.
            pushSetting(contentEl, client, userId);
        }

        const scene = new Setting(contentEl).setName('Scene').setDesc('On this device.');
        const select = scene.controlEl.createEl('select', { cls: 'dropdown' });
        for (const [value, label] of [['forest', 'Forest'], ['mountains', 'Mountains']] as [Scene, string][]) {
            const option = select.createEl('option', { text: label, attr: { value } });
            if (value === currentScene()) option.selected = true;
        }
        select.addEventListener('change', () => setScene(select.value as Scene));

        gardenSettings(contentEl.createDiv(), this.app);

        new Setting(contentEl).setName('Accessibility')
            .setDesc('Contrast and requests for this device.')
            .addButton(b => b.setButtonText('Open').onClick(() => new AccessibilityModal().open()));

        new Setting(contentEl)
            .setName('Keyboard shortcuts')
            .addButton((b) => b.setButtonText('Show').onClick(() => {
                this.close();
                new ShortcutsModal().open();
            }));

        contentEl.appendChild(status);
    }
}

/** The silhouette colour a plant in standby has always had, for the colour well to show. */
const SILHOUETTE_GREEN = '#1f3e3b';
const MAX_FIREFLIES = 64;

/**
 * The garden's settings, drawn into `el` (the Settings modal, or the Obsidian
 * plugin's settings tab). A change is saved with the garden and shown at once.
 * A change from someone else redraws it, so no row acts on a node that moved.
 * `heading` is off in Obsidian, whose settings tab takes no top heading.
 */
export function gardenSettings(el: HTMLElement, app: GardenApp, heading = true) {
    el.addClass('garden-settings');
    let drawn = app.settings;
    const watch = () => {
        if (!el.isConnected) app.settingsWatchers.delete(watch);
        else if (!sameData(app.settings, drawn)) draw();
    };
    app.settingsWatchers.add(watch);
    const draw = () => drawGardenSettings(el, app, heading, (settings) => { drawn = settings; }, draw);
    draw();
}

function drawGardenSettings(el: HTMLElement, app: GardenApp, heading: boolean, shown: (s: GardenSettings) => void, redrawAll: () => void) {
    // The node editor is a disclosure, not the settings screen. Remember its
    // local open state when a setting redraws this block.
    const skyDetailsOpen = el.dataset.skyDetailsOpen === 'true';
    el.empty();
    const s = app.settings;
    shown(s);
    const set = (patch: Partial<GardenSettings>, redraw = false) => {
        app.settings = { ...app.settings, ...patch };
        shown(app.settings);
        app.view?.scheduleRender();
        void app.saveGardenData();
        if (redraw) redrawAll();
    };
    /** A whole number field that commits on change, clamped to its range. */
    const number = (setting: Setting, value: number, min: number, max: number, commit: (n: number) => void) =>
        setting.addText((t) => {
            t.inputEl.type = 'number';
            t.inputEl.min = String(min);
            t.inputEl.max = String(max);
            t.setValue(String(value));
            t.inputEl.addEventListener('change', () => {
                const n = Math.round(Number(t.getValue()));
                const next = t.getValue().trim() === '' || Number.isNaN(n) ? value : Math.min(max, Math.max(min, n));
                t.setValue(String(next));
                value = next;
                commit(next);
            });
        });
    const revert = (setting: Setting, reset: () => void) =>
        setting.addExtraButton((b) => b.setIcon(ICONS.reset).setTooltip('Revert to default').onClick(reset));

    if (heading) new Setting(el).setName('Garden').setDesc('Shared with everyone in this garden.').setHeading();
    else el.createEl('p', { cls: 'setting-item-description', text: 'Shared with everyone in this garden.' });

    number(new Setting(el).setName('Fireflies').setDesc('Fewer run lighter.'), s.fireflies, 0, MAX_FIREFLIES, (n) => set({ fireflies: n }));
    number(new Setting(el).setName('Fireflies on mobile').setDesc('Used on touch devices. Fewer run lighter.'), s.mobileFireflies, 0, MAX_FIREFLIES, (n) => set({ mobileFireflies: n }));

    // --- Sky ---
    const isStatic = s.skyMode === 'static';
    new Setting(el)
        .setName('Sky')
        .setDesc(isStatic ? 'Node 1 all day.' : 'Through the nodes by the clock.')
        .addDropdown((d) => d.addOption('cycle', 'Cycle').addOption('static', 'Static').setValue(s.skyMode)
            .onChange((mode) => set({ skyMode: mode === 'static' ? 'static' : 'cycle' }, true)));

    const details = el.createEl('details', { cls: 'garden-sky-details' });
    details.open = skyDetailsOpen;
    details.addEventListener('toggle', () => {
        el.dataset.skyDetailsOpen = String(details.open);
    });
    const summary = details.createEl('summary', { cls: 'garden-sky-summary' });
    summary.createSpan({ cls: 'garden-sky-summary-title', text: 'Sky details' });
    summary.createSpan({
        cls: 'garden-sky-summary-count',
        text: `${s.skyNodes.length} ${s.skyNodes.length === 1 ? 'node' : 'nodes'}`,
    });
    const preview = summary.createSpan('garden-sky-summary-preview');

    const day = details.createDiv('garden-sky-day');
    const bar = day.createDiv('garden-sky-bar');
    const marks = day.createDiv('garden-sky-marks');
    const drawBar = () => {
        const gradient = skyGradient(app.settings);
        bar.style.background = gradient;
        preview.style.background = gradient;
        marks.empty();
        app.settings.skyNodes.forEach((node, i) => {
            const mark = marks.createSpan({ cls: 'garden-sky-mark', text: String(i + 1) });
            mark.style.left = `${(node.hour / 24) * 100}%`;
            mark.toggleClass('is-dimmed', app.settings.skyMode === 'static' && i > 0);
        });
    };
    drawBar();

    const editNode = (i: number, patch: Partial<SkyNode>) => {
        set({ skyNodes: app.settings.skyNodes.map((n, j) => (j === i ? { ...n, ...patch } : n)) });
        drawBar();
    };
    s.skyNodes.forEach((node, i) => {
        const row = new Setting(details).setName(`Node ${i + 1}`);
        row.settingEl.addClass('garden-sky-node');
        row.settingEl.toggleClass('is-dimmed', isStatic && i > 0);
        row.addColorPicker((c) => c.setValue(node.color).onChange((color) => editNode(i, { color })));
        row.addText((t) => {
            t.inputEl.type = 'time';
            t.setValue(timeOf(node.hour));
            t.inputEl.addEventListener('change', () => {
                const hour = hourOf(t.getValue());
                if (hour === null) t.setValue(timeOf(app.settings.skyNodes[i]?.hour ?? node.hour));
                else editNode(i, { hour });
            });
        });
        if (i > 0) {
            row.addExtraButton((b) => b.setIcon(ICONS.close).setTooltip('Delete node')
                .onClick(() => set({ skyNodes: app.settings.skyNodes.filter((_, j) => j !== i) }, true)));
        }
    });
    new Setting(details)
        .addButton((b) => b.setButtonText('Add node').onClick(() => {
            // At noon, in the colour the sky already has then, so adding it changes nothing yet.
            const noon = skyAt({ ...app.settings, skyMode: 'cycle' }, 12).skyColor.match(/\d+/g) ?? [];
            const color = `#${noon.map(c => Number(c).toString(16).padStart(2, '0')).join('')}`;
            set({ skyNodes: [...app.settings.skyNodes, { color, hour: 12 }] }, true);
        }))
        .addButton((b) => b.setButtonText('Reset sky').onClick(() =>
            set({ skyMode: DEFAULT_SETTINGS.skyMode, skyNodes: DEFAULT_SETTINGS.skyNodes.map(n => ({ ...n })) }, true)));

    // --- Minerals ---
    const fadeRows: Setting[] = [];
    new Setting(el)
        .setName('Fade minerals')
        .setDesc('Deeper minerals grow fainter, to show priority.')
        .addToggle((t) => t.setValue(s.mineralFade).onChange((on) => {
            set({ mineralFade: on });
            for (const row of fadeRows) row.settingEl.toggleClass('is-dimmed', !on);
        }));
    fadeRows.push(number(new Setting(el).setName('Start fading at mineral'), s.mineralFadeFrom, 1, 999, (n) => set({ mineralFadeFrom: n })));
    const lowest = new Setting(el).setName('Lowest opacity').setDesc('Percent.');
    number(lowest, s.mineralFadeMin, 0, 100, (n) => set({ mineralFadeMin: n }));
    fadeRows.push(revert(lowest, () => set({ mineralFadeMin: DEFAULT_SETTINGS.mineralFadeMin }, true)));
    for (const row of fadeRows) row.settingEl.toggleClass('is-dimmed', !s.mineralFade);

    // --- Standby ---
    const opacity = new Setting(el).setName('Standby opacity').setDesc('Plant and seed silhouettes, in percent.');
    number(opacity, s.silhouetteOpacity, 0, 100, (n) => set({ silhouetteOpacity: n }));
    revert(opacity, () => set({ silhouetteOpacity: DEFAULT_SETTINGS.silhouetteOpacity }, true));
    const color = new Setting(el).setName('Standby color').setDesc('Stem and flower silhouettes.');
    color.addColorPicker((c) => c.setValue(s.silhouetteColor || SILHOUETTE_GREEN).onChange((hex) => set({ silhouetteColor: hex })));
    revert(color, () => set({ silhouetteColor: DEFAULT_SETTINGS.silhouetteColor }, true));
    new Setting(el)
        .setName('Hide minerals in standby')
        .addToggle((t) => t.setValue(s.standbyHidesMinerals).onChange((on) => set({ standbyHidesMinerals: on })));
}
