/** Personal display preferences. They never change a collaborator's garden. */
import { local } from './local';
import { Modal, Setting } from './ui';

const KEY = 'cells.garden/high-contrast';
export const ISSUE_URL = 'https://github.com/lukketsvane/cells.garden/issues/new';

export function applyAccessibility() {
    document.documentElement.toggleAttribute('data-high-contrast', local.get(KEY) === 'true');
}

export class AccessibilityModal extends Modal {
    onOpen() {
        this.modalEl.addClass('share-modal');
        this.contentEl.createEl('h2', { text: 'Accessibility' });
        this.contentEl.createEl('p', { text: 'Display choices for this device. Your garden stays the same for everyone else.' });
        new Setting(this.contentEl)
            .setName('High contrast')
            .setDesc('Darken the soil, outline minerals, and strengthen text and focus indicators. Layers keep their names and distinct icons, so color is never the only cue.')
            .addToggle(t => t.setValue(local.get(KEY) === 'true').onChange(on => {
                local.set(KEY, String(on));
                document.documentElement.toggleAttribute('data-high-contrast', on);
            }));
        this.contentEl.createEl('a', {
            text: 'Request an accessibility improvement',
            attr: { href: `${ISSUE_URL}?title=Accessibility%3A%20&body=What%20would%20make%20the%20garden%20easier%20to%20use%3F%0A%0A`, target: '_blank', rel: 'noopener noreferrer' },
        });
    }
}
