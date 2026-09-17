/**
 * The parts the two share modals have in common: copying a link, and the
 * invite-link row itself, which reads the same whether it points at a garden
 * or at a single plant.
 */
import { Setting } from './ui';

/** Copy to the clipboard, or fall back to selecting the text so ⌘C works. */
export async function copyText(text: string, fallback: HTMLInputElement): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        fallback.focus();
        fallback.select();
        return false;
    }
}

export interface InviteSection {
    /** The link as it stands, or null when there is none yet. */
    token: string | null;
    /** The link as a URL the recipient can open. */
    url: (token: string) => string;
    /** What the link lets someone do, shown under its name. */
    desc: string;
    say: (text: string) => void;
    /** Make a new link, dropping the old one. Its token is read back by `again`. */
    renew: () => Promise<unknown>;
    clear: () => Promise<void>;
    /** Redraw the modal with this line at the bottom. */
    again: (message: string) => Promise<void>;
}

/**
 * The invite link: create it, copy it, replace it, turn it off. Each button
 * reports its own failure through `say` and leaves the modal as it was.
 */
export function inviteSection(parent: HTMLElement, s: InviteSection) {
    const attempt = (what: string, run: () => Promise<void>) => async () => {
        try {
            await run();
        } catch (e) {
            s.say(`Could not ${what}: ${(e as Error).message}`);
        }
    };

    const link = new Setting(parent).setName('Invite link').setDesc(s.token ? s.desc : 'No link yet.');
    if (!s.token) {
        link.addButton((b) => b.setButtonText('Create link').setCta().onClick(attempt('make a link', async () => {
            await s.renew();
            await s.again('Link ready.');
        })));
        return;
    }

    const url = s.url(s.token);
    const input = link.controlEl.createEl('input', { type: 'text', cls: 'share-link', value: url });
    input.readOnly = true;
    input.addEventListener('focus', () => input.select());
    link.addButton((b) => b.setButtonText('Copy').setCta().onClick(async () => {
        s.say(await copyText(url, input) ? 'Link copied.' : 'Select the link and copy it.');
    }));

    new Setting(parent)
        .addButton((b) => b.setButtonText('New link').onClick(attempt('make a link', async () => {
            await s.renew();
            await s.again('New link made. The old one stops working.');
        })))
        .addButton((b) => b.setButtonText('Turn off link').setWarning().onClick(attempt('turn it off', async () => {
            await s.clear();
            await s.again('Link turned off. People who have it keep it.');
        })));
}
