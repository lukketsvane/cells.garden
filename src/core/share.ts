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
import { attempt, inviteSection } from './share-ui';
import { Modal, Setting } from './ui';

export class ShareGardenModal extends Modal {
    constructor(
        private readonly client: SupabaseClient,
        private readonly gardenId: string,
        private name: string,
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
                text.inputEl.addEventListener('change', () => {
                    const next = text.getValue().trim();
                    if (!next || next === this.name) return;
                    void attempt(say, 'rename', async () => {
                        await renameGarden(this.client, this.gardenId, next);
                        this.name = next;
                        say('Name saved.');
                    });
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

        inviteSection(contentEl, {
            token,
            url: inviteUrl,
            desc: 'Anyone with the link can open and edit this garden.',
            say,
            renew: () => renewInvite(this.client, this.gardenId),
            clear: () => clearInvite(this.client, this.gardenId),
            again: (message) => this.render(message),
        });

        const people = contentEl.createDiv('share-people');
        people.createDiv({ cls: 'setting-item-name', text: 'People' });
        if (members.length === 0) {
            people.createDiv({ cls: 'setting-item-description', text: 'No one yet.' });
        }
        for (const member of members) {
            const row = new Setting(people).setName(member.name);
            row.nameEl.prepend(avatarEl(member.avatar, 20));
            row.addButton((b) => b.setButtonText('Remove').onClick(() => void attempt(say, 'remove', async () => {
                await removeMember(this.client, this.gardenId, member.userId);
                await this.render(`Removed ${member.name}.`);
            })));
        }

        // Keep the status line last, where the eye lands after a button.
        contentEl.appendChild(status);
        say(message);
    }
}

/** Leave a garden, or delete a space: one question, one button that means it. */
export class GardenQuestionModal extends Modal {
    constructor(
        private readonly title: string,
        private readonly body: string,
        private readonly action: string,
        private readonly onYes: () => unknown,
    ) {
        super();
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: this.title });
        contentEl.createEl('p', { text: this.body });
        new Setting(contentEl)
            .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
            .addButton((b) => b.setButtonText(this.action).setWarning().onClick(() => {
                this.close();
                this.onYes();
            }));
    }
}

/** Name a new garden space. */
export class NewSpaceModal extends Modal {
    constructor(private readonly onCreate: (name: string) => unknown) {
        super();
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'New garden space' });
        contentEl.createEl('p', { text: 'A garden of its own, to share with others.' });
        let name = '';
        const create = () => {
            if (!name.trim()) return;
            this.close();
            this.onCreate(name.trim());
        };
        new Setting(contentEl).setName('Name').addText((t) => {
            t.onChange((v) => { name = v; });
            t.inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
            window.setTimeout(() => t.inputEl.focus(), 50);
        });
        new Setting(contentEl)
            .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
            .addButton((b) => b.setButtonText('Create').setCta().onClick(create));
    }
}
