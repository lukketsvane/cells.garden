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
import { avatarEl } from './avatar';
import {
    clearPlantInvite,
    createSharedPlant,
    deleteSharedPlant,
    getPlantInvite,
    listFriends,
    listPlantMembers,
    offerPlant,
    pendingOffersFor,
    plantInviteUrl,
    plantOwner,
    removePlantMember,
    renewPlantInvite,
} from './sharing';
import { inviteSection } from './share-ui';
import { Modal, Setting } from './ui';

export class SharePlantModal extends Modal {
    constructor(
        private readonly client: SupabaseClient,
        private readonly userId: string,
        private readonly app: GardenApp,
        private readonly sync: PlantSync,
        /** Opened from a plant's card: straight to that plant, sharing it first if need be. */
        private readonly projectId: string | null = null,
    ) {
        super();
    }

    onOpen() {
        this.modalEl.addClass('share-modal');
        if (this.projectId) void this.openOne(this.projectId);
        else this.showList();
    }

    private async openOne(projectId: string) {
        const project = this.live(projectId);
        if (!project) return this.close();
        if (project.sharedPlantId) return this.showPlant(projectId);
        this.contentEl.empty();
        this.contentEl.createEl('h2', { text: project.seed || project.name });
        const status = this.contentEl.createDiv({ cls: 'auth-status', text: 'Sharing…' });
        await this.startSharing(projectId, (text) => status.setText(text));
    }

    /** Make the plants row, link this plant to it and give it its first link. */
    private async startSharing(projectId: string, say: (text: string) => void) {
        const project = this.live(projectId);
        if (!project) return;
        try {
            const created = await createSharedPlant(this.client, this.userId, plantData(project));
            project.sharedPlantId = created.id;
            this.sync.adopt(created);
            await this.app.saveGardenData();
            await renewPlantInvite(this.client, created.id);
            await this.showPlant(projectId, 'Link ready.');
        } catch (e) {
            say(`Could not share: ${(e as Error).message}`);
        }
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
                    await this.startSharing(project.id, (text) => status.setText(text));
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
            inviteSection(contentEl, {
                token: await getPlantInvite(this.client, plantId).catch(() => null),
                url: plantInviteUrl,
                desc: 'Anyone with the link gets this plant in their garden and can edit it.',
                say,
                renew: () => renewPlantInvite(this.client, plantId),
                clear: () => clearPlantInvite(this.client, plantId),
                again: (message) => this.showPlant(projectId, message),
            });
        }

        const people = contentEl.createDiv('share-people');
        people.createDiv({ cls: 'setting-item-name', text: 'People' });
        let memberIds = new Set<string>([owner]);
        try {
            const members = await listPlantMembers(this.client, plantId);
            memberIds = new Set([owner, ...members.map(m => m.userId)]);
            if (members.length === 0) people.createDiv({ cls: 'setting-item-description', text: 'No one yet.' });
            for (const member of members) {
                const row = new Setting(people).setName(member.userId === this.userId ? `${member.name} (you)` : member.name);
                row.nameEl.prepend(avatarEl(member.avatar, 20));
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

        // Friends who do not have it yet: send it straight to them.
        try {
            const friends = (await listFriends(this.client)).filter(f => !memberIds.has(f.userId));
            if (friends.length > 0) {
                const sent = await pendingOffersFor(this.client, plantId).catch(() => new Set<string>());
                const box = contentEl.createDiv('share-people');
                box.createDiv({ cls: 'setting-item-name', text: 'Friends' });
                for (const friend of friends) {
                    const row = new Setting(box).setName(friend.name);
                    row.nameEl.prepend(avatarEl(friend.avatar, 20));
                    if (sent.has(friend.userId)) {
                        row.setDesc('Sent');
                    } else {
                        row.addButton((b) => b.setButtonText('Send').onClick(() => void attempt('send it', async () => {
                            await offerPlant(this.client, plantId, friend.userId);
                            await this.showPlant(projectId, `Sent to ${friend.name}.`);
                        })));
                    }
                }
            }
        } catch {
            // Before migration 0009 there are no friends to list; the link still works.
        }

        const footer = new Setting(contentEl);
        if (!this.projectId) footer.addButton((b) => b.setButtonText('Back').onClick(() => this.showList()));
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
