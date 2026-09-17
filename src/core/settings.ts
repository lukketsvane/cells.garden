/**
 * Settings: the signed-in user's profile (picture and name) and the choices
 * that stay on this device (the scene). Signed out, only the device part shows.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { avatarEl } from './avatar';
import { ShortcutsModal } from './modals';
import { currentScene, setScene, type Scene } from './scene';
import { getProfile, updateProfile } from './sharing';
import { Modal, Setting } from './ui';

export interface SettingsAccount {
    client: SupabaseClient;
    userId: string;
    /** Tell the rest of the app the picture changed. */
    onAvatar: (seed: string) => void;
}

const randomSeed = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');

export class SettingsModal extends Modal {
    constructor(private readonly account: SettingsAccount | null) {
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
                let seed = profile.avatar;

                const picture = new Setting(contentEl).setName('Picture').setDesc('Made for you. Roll a new one if you like.');
                const holder = picture.controlEl.createDiv('settings-avatar');
                holder.appendChild(avatarEl(seed, 48));
                picture.addButton((b) => b.setButtonText('New picture').onClick(async () => {
                    const next = randomSeed();
                    try {
                        await updateProfile(client, userId, { avatar: next });
                        seed = next;
                        holder.empty();
                        holder.appendChild(avatarEl(seed, 48));
                        onAvatar(seed);
                        say('');
                    } catch (e) {
                        say(`Could not save the picture: ${(e as Error).message}`);
                    }
                }));

                let name = profile.name;
                new Setting(contentEl)
                    .setName('Name')
                    .setDesc('What friends see.')
                    .addText((t) => {
                        t.setValue(name);
                        t.onChange((v) => { name = v; });
                        t.inputEl.addEventListener('blur', async () => {
                            const trimmed = name.trim();
                            if (!trimmed || trimmed === profile.name) return;
                            try {
                                await updateProfile(client, userId, { name: trimmed });
                                profile.name = trimmed;
                                say('Name saved.');
                            } catch (e) {
                                say(`Could not save the name: ${(e as Error).message}`);
                            }
                        });
                    });
            } catch (e) {
                say(`Could not load your profile: ${(e as Error).message}`);
            }
        }

        const scene = new Setting(contentEl).setName('Scene').setDesc('On this device.');
        const select = scene.controlEl.createEl('select', { cls: 'dropdown' });
        for (const [value, label] of [['forest', 'Forest'], ['mountains', 'Mountains']] as [Scene, string][]) {
            const option = select.createEl('option', { text: label, attr: { value } });
            if (value === currentScene()) option.selected = true;
        }
        select.addEventListener('change', () => setScene(select.value as Scene));

        new Setting(contentEl)
            .setName('Keyboard shortcuts')
            .addButton((b) => b.setButtonText('Show').onClick(() => {
                this.close();
                new ShortcutsModal().open();
            }));

        contentEl.appendChild(status);
    }

    onClose() {
        this.contentEl.empty();
    }
}
