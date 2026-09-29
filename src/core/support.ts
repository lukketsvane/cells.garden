/** Help and project information shared by the web, extension and Obsidian. */
import { menuRow, type MenuItem } from './menu';
import { Modal } from './ui';

export const ISSUE_URL = 'https://github.com/lukketsvane/cells.garden/issues/new';
export const SUPPORT_EMAIL = 'cells.garden@proton.me';
export const ABOUT_URL = 'https://cells.garden/about/';

export function reportIssueItem(): MenuItem {
    return {
        label: 'Report issue',
        panel: (panel, menu) => {
            const github = menuRow(panel, { label: 'Open a GitHub issue' });
            github.onclick = () => {
                menu.close();
                window.open(ISSUE_URL, '_blank', 'noopener,noreferrer');
            };
            const email = menuRow(panel, { label: SUPPORT_EMAIL });
            email.onclick = () => {
                menu.close();
                window.open(`mailto:${SUPPORT_EMAIL}`, '_blank', 'noopener,noreferrer');
            };
        },
    };
}

/** Available offline in every distribution; the full project page is a normal link. */
export class AboutModal extends Modal {
    onOpen() {
        this.modalEl.addClass('share-modal');
        const content = this.contentEl;
        content.createEl('h2', { text: 'About cells.garden' });
        content.createEl('p', { text: 'This page is being prepared. More soon.' });
    }
}
