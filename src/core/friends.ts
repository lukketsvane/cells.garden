/**
 * Friends: the people you grow things with. Anyone who shares a garden or a
 * plant with you is here, with what you share. Plants a friend has sent wait at
 * the top until you take them into your garden or turn them down.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { avatarEl } from './avatar';
import {
    acceptPlantOffer,
    declinePlantOffer,
    listFriends,
    listPlantOffers,
    type SharedPlantRow,
} from './sharing';
import { attempt } from './share-ui';
import { Modal, Setting } from './ui';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export class FriendsModal extends Modal {
    constructor(
        private readonly client: SupabaseClient,
        private readonly userId: string,
        /** Put an accepted plant into the garden. */
        private readonly plant: (row: SharedPlantRow) => Promise<void>,
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
        contentEl.createEl('h2', { text: 'Friends' });
        const status = contentEl.createDiv({ cls: 'auth-status', text: message });
        const say = (text: string) => status.setText(text);

        try {
            const offers = await listPlantOffers(this.client);
            if (offers.length > 0) {
                const box = contentEl.createDiv('share-people');
                box.createDiv({ cls: 'setting-item-name', text: 'Sent to you' });
                for (const offer of offers) {
                    const row = new Setting(box).setName(offer.seed).setDesc(`from ${offer.fromName}`);
                    row.nameEl.prepend(avatarEl(offer.fromAvatar, 20));
                    row.addButton((b) => b.setButtonText('Not now').onClick(() => void attempt(say, 'turn it down', async () => {
                        await declinePlantOffer(this.client, offer.plantId, this.userId);
                        await this.render('Turned down.');
                    })));
                    row.addButton((b) => b.setButtonText('Plant it').setCta().onClick(() => void attempt(say, 'plant it', async () => {
                        await this.plant(await acceptPlantOffer(this.client, offer.plantId));
                        await this.render(`Planted ${offer.seed}.`);
                    })));
                }
            }
        } catch {
            // Before migration 0009: no offers.
        }

        const box = contentEl.createDiv('share-people');
        try {
            const friends = await listFriends(this.client);
            if (friends.length === 0) {
                box.createEl('p', { cls: 'setting-item-description', text: 'Share a plant or a garden, and the people who join show up here.' });
            }
            for (const friend of friends) {
                const shared = [
                    friend.plants ? plural(friend.plants, 'plant') : '',
                    friend.gardens ? plural(friend.gardens, 'garden') : '',
                ].filter(Boolean).join(', ');
                const row = new Setting(box).setName(friend.name).setDesc(shared);
                row.nameEl.prepend(avatarEl(friend.avatar, 24));
            }
        } catch (e) {
            say(`Could not load friends: ${(e as Error).message}`);
        }
    }
}
