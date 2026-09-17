/**
 * The owner's Share garden modal and the member's Leave confirmation (M4).
 */
import { avatarEl } from './avatar';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    clearInvite,
    getInvite,
    inviteUrl,
    listMembers,
    removeMember,
    renameGarden,
    renewInvite,
    type GardenMember,
} from './sharing';
import { Modal, Setting } from './ui';

async function copyText(text: string, fallback: HTMLInputElement): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        fallback.focus();
        fallback.select();
        return false;
    }
}

export class ShareGardenModal extends Modal {
    constructor(
        private readonly client: SupabaseClient,
        private readonly gardenId: string,
        private name: string,
        private readonly onRenamed: (name: string) => void,
    ) {
        super();
    }

    onOpen() {
        this.modalEl.addClass('share-modal');
        void this.render();
    }

    private async render(message = '') {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Share garden' });
        const status = contentEl.createDiv('auth-status');
        const say = (text: string) => status.setText(text);

        new Setting(contentEl)
            .setName('Name')
            .addText((text) => {
                text.setValue(this.name);
                text.inputEl.addEventListener('change', async () => {
                    const next = text.getValue().trim();
                    if (!next || next === this.name) return;
                    try {
                        await renameGarden(this.client, this.gardenId, next);
                        this.name = next;
                        this.onRenamed(next);
                        say('Name saved.');
                    } catch (e) {
                        say(`Could not rename: ${(e as Error).message}`);
                    }
                });
            });

        let token: string | null = null;
        let members: GardenMember[] = [];
        try {
            [token, members] = await Promise.all([
                getInvite(this.client, this.gardenId),
                listMembers(this.client, this.gardenId),
            ]);
        } catch (e) {
            say(`Could not load sharing: ${(e as Error).message}`);
            return;
        }

        const link = new Setting(contentEl)
            .setName('Invite link')
            .setDesc(token ? 'Anyone with the link can open and edit this garden.' : 'No link yet.');
        if (token) {
            const url = inviteUrl(token);
            const input = link.controlEl.createEl('input', { type: 'text', cls: 'share-link', value: url });
            input.readOnly = true;
            input.addEventListener('focus', () => input.select());
            link.addButton((b) => b.setButtonText('Copy').setCta().onClick(async () => {
                say(await copyText(url, input) ? 'Link copied.' : 'Select the link and copy it.');
            }));
            new Setting(contentEl)
                .addButton((b) => b.setButtonText('New link').onClick(async () => {
                    try {
                        await renewInvite(this.client, this.gardenId);
                        await this.render('New link made. The old one stops working.');
                    } catch (e) {
                        say(`Could not make a link: ${(e as Error).message}`);
                    }
                }))
                .addButton((b) => b.setButtonText('Turn off link').setWarning().onClick(async () => {
                    try {
                        await clearInvite(this.client, this.gardenId);
                        await this.render('Link turned off. People already here keep access.');
                    } catch (e) {
                        say(`Could not turn it off: ${(e as Error).message}`);
                    }
                }));
        } else {
            link.addButton((b) => b.setButtonText('Create link').setCta().onClick(async () => {
                try {
                    await renewInvite(this.client, this.gardenId);
                    await this.render('Link ready.');
                } catch (e) {
                    say(`Could not make a link: ${(e as Error).message}`);
                }
            }));
        }

        const people = contentEl.createDiv('share-people');
        people.createDiv({ cls: 'setting-item-name', text: 'People' });
        if (members.length === 0) {
            people.createDiv({ cls: 'setting-item-description', text: 'No one yet.' });
        }
        for (const member of members) {
            const row = new Setting(people).setName(member.name);
            row.nameEl.prepend(avatarEl(member.avatar, 20));
            row
                .addButton((b) => b.setButtonText('Remove').onClick(async () => {
                    try {
                        await removeMember(this.client, this.gardenId, member.userId);
                        await this.render(`Removed ${member.name}.`);
                    } catch (e) {
                        say(`Could not remove: ${(e as Error).message}`);
                    }
                }));
        }

        // Keep the status line last, where the eye lands after a button.
        contentEl.appendChild(status);
        say(message);
    }

    onClose() {
        this.contentEl.empty();
    }
}

export class LeaveGardenModal extends Modal {
    constructor(private readonly name: string, private readonly onLeave: () => void) {
        super();
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: `Leave ${this.name}?` });
        contentEl.createEl('p', { text: 'You can come back with a new link.' });
        new Setting(contentEl)
            .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
            .addButton((b) => b.setButtonText('Leave').setWarning().onClick(() => {
                this.close();
                this.onLeave();
            }));
    }

    onClose() {
        this.contentEl.empty();
    }
}
