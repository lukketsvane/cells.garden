/**
 * Share a plant: pick one of the garden's plants, get a link for it, see who has
 * it. The owner can turn the link off, remove people or stop sharing; someone who
 * joined can leave. Leaving or stopping keeps each person's own copy.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GardenApp } from './app';
import { plantData } from './merge';
import type { ProjectData } from './model';
import type { PlantSync } from './plants';
import {
    clearPlantInvite,
    createSharedPlant,
    deleteSharedPlant,
    getPlantInvite,
    listPlantMembers,
    plantInviteUrl,
    plantOwner,
    removePlantMember,
    renewPlantInvite,
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

export class SharePlantModal extends Modal {
    constructor(
        private readonly client: SupabaseClient,
        private readonly userId: string,
        private readonly app: GardenApp,
        private readonly sync: PlantSync,
    ) {
        super();
    }

    onOpen() {
        this.modalEl.addClass('share-modal');
        this.showList();
    }

    private live(projectId: string): ProjectData | undefined {
        return this.app.gardenData.find(p => p.id === projectId);
    }

    private showList(message = '') {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Share a plant' });
        const status = contentEl.createDiv('auth-status');
        if (this.app.gardenData.length === 0) {
            contentEl.createEl('p', { text: 'Plant a seed first.' });
        }
        for (const project of this.app.gardenData) {
            const row = new Setting(contentEl).setName(project.seed || project.name);
            row.settingEl.addClass('share-plant-row');
            if (project.sharedPlantId) {
                row.setDesc('Shared');
                row.addButton((b) => b.setButtonText('Open').onClick(() => void this.showPlant(project.id)));
            } else {
                row.addButton((b) => b.setButtonText('Share').onClick(async () => {
                    status.setText('Sharing…');
                    try {
                        const live = this.live(project.id);
                        if (!live) return;
                        const created = await createSharedPlant(this.client, this.userId, plantData(live));
                        live.sharedPlantId = created.id;
                        this.sync.adopt(created);
                        await this.app.saveGardenData();
                        await renewPlantInvite(this.client, created.id);
                        await this.showPlant(project.id, 'Link ready.');
                    } catch (e) {
                        status.setText(`Could not share: ${(e as Error).message}`);
                    }
                }));
            }
        }
        contentEl.appendChild(status);
        status.setText(message);
    }

    private async showPlant(projectId: string, message = '') {
        const { contentEl } = this;
        const project = this.live(projectId);
        const plantId = project?.sharedPlantId;
        if (!project || !plantId) {
            this.showList();
            return;
        }

        contentEl.empty();
        contentEl.createEl('h2', { text: project.seed || project.name });
        const status = contentEl.createDiv('auth-status');
        const say = (text: string) => status.setText(text);
        const attempt = async (what: string, run: () => Promise<void>) => {
            try {
                await run();
            } catch (e) {
                say(`Could not ${what}: ${(e as Error).message}`);
            }
        };

        const unlink = async (text: string) => {
            const live = this.live(projectId);
            if (live) delete live.sharedPlantId;
            this.sync.forget(plantId);
            await this.app.saveGardenData();
            this.showList(text);
        };

        let owner: string | null;
        try {
            owner = await plantOwner(this.client, plantId);
        } catch (e) {
            say(`Could not load: ${(e as Error).message}`);
            return;
        }

        if (owner === null) {
            contentEl.createEl('p', { text: 'This plant is no longer shared with you. Your copy stays.' });
            new Setting(contentEl)
                .addButton((b) => b.setButtonText('Back').onClick(() => this.showList()))
                .addButton((b) => b.setButtonText('Keep my copy').setCta().onClick(() => void unlink('Kept your copy.')));
            contentEl.appendChild(status);
            return;
        }

        const isOwner = owner === this.userId;
        if (isOwner) {
            const token = await getPlantInvite(this.client, plantId).catch(() => null);
            const link = new Setting(contentEl)
                .setName('Invite link')
                .setDesc(token ? 'Anyone with the link gets this plant in their garden and can edit it.' : 'No link.');
            if (token) {
                const url = plantInviteUrl(token);
                const input = link.controlEl.createEl('input', { type: 'text', cls: 'share-link', value: url });
                input.readOnly = true;
                input.addEventListener('focus', () => input.select());
                link.addButton((b) => b.setButtonText('Copy').setCta().onClick(async () => {
                    say(await copyText(url, input) ? 'Link copied.' : 'Select the link and copy it.');
                }));
                new Setting(contentEl)
                    .addButton((b) => b.setButtonText('New link').onClick(() => void attempt('make a link', async () => {
                        await renewPlantInvite(this.client, plantId);
                        await this.showPlant(projectId, 'New link made. The old one stops working.');
                    })))
                    .addButton((b) => b.setButtonText('Turn off link').setWarning().onClick(() => void attempt('turn it off', async () => {
                        await clearPlantInvite(this.client, plantId);
                        await this.showPlant(projectId, 'Link turned off. People who have it keep it.');
                    })));
            } else {
                link.addButton((b) => b.setButtonText('Create link').setCta().onClick(() => void attempt('make a link', async () => {
                    await renewPlantInvite(this.client, plantId);
                    await this.showPlant(projectId, 'Link ready.');
                })));
            }
        }

        const people = contentEl.createDiv('share-people');
        people.createDiv({ cls: 'setting-item-name', text: 'People' });
        try {
            const members = await listPlantMembers(this.client, plantId);
            if (members.length === 0) people.createDiv({ cls: 'setting-item-description', text: 'No one yet.' });
            for (const member of members) {
                const row = new Setting(people).setName(member.userId === this.userId ? `${member.name} (you)` : member.name);
                if (isOwner) {
                    row.addButton((b) => b.setButtonText('Remove').onClick(() => void attempt('remove', async () => {
                        await removePlantMember(this.client, plantId, member.userId);
                        await this.showPlant(projectId, `Removed ${member.name}.`);
                    })));
                }
            }
        } catch (e) {
            say(`Could not load people: ${(e as Error).message}`);
        }

        const footer = new Setting(contentEl)
            .addButton((b) => b.setButtonText('Back').onClick(() => this.showList()));
        if (isOwner) {
            footer.addButton((b) => b.setButtonText('Stop sharing').setWarning().onClick(() => void attempt('stop sharing', async () => {
                await deleteSharedPlant(this.client, plantId);
                await unlink('Stopped sharing. Everyone keeps their own copy.');
            })));
        } else {
            footer.addButton((b) => b.setButtonText('Leave').setWarning().onClick(() => void attempt('leave', async () => {
                await removePlantMember(this.client, plantId, this.userId);
                await unlink('Left. Your copy stays in your garden.');
            })));
        }

        contentEl.appendChild(status);
        say(message);
    }

    onClose() {
        this.contentEl.empty();
    }
}
