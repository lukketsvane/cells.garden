import { Modal, Setting } from './ui';

// --- The Confirm Delete Modal ---

export class ConfirmDeleteModal extends Modal {
    constructor(private plantName: string, private onSubmit: () => void) {
        super();
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Recycle plant?" });
        contentEl.createEl("p", {
            text: `Are you sure you want to recycle "${this.plantName}"? This will permanently delete the plant and all its tasks.`,
        });

        new Setting(contentEl)
            .addButton((btn) => {
                btn.setButtonText("Cancel").onClick(() => this.close());
            })
            .addButton((btn) => {
                btn.setButtonText("Recycle")
                    .setWarning()
                    .onClick(() => {
                        this.close();
                        this.onSubmit();
                    });
            });
    }
}

// --- The Create Project Modal ---

export class CreateProjectModal extends Modal {
    constructor(private onSubmit: (seed: string) => void) {
        super();
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Plant a new seed" });

        let projectSeed = "";
        const submit = () => {
            if (projectSeed.trim()) {
                this.close();
                this.onSubmit(projectSeed);
            }
        };

        new Setting(contentEl)
            .setName("Goal / Seed")
            .setDesc("This will also act as the plant's title.")
            .addTextArea((text) => {
                text.onChange((value) => { projectSeed = value; });
                text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Enter' && !e.shiftKey) { // Allow Shift+Enter for new lines!
                        e.preventDefault();
                        submit();
                    }
                });
                setTimeout(() => text.inputEl.focus(), 50);
            });

        new Setting(contentEl)
            .addButton((btn) => {
                btn.setButtonText("Cancel").onClick(() => this.close());
            })
            .addButton((btn) => {
                btn.setButtonText("Plant Seed")
                    .setCta()
                    .onClick(submit);
            });
    }
}

/** The keyboard shortcuts, opened with ? or from the pill menu. */
export class ShortcutsModal extends Modal {
    onOpen() {
        const { contentEl } = this;
        this.modalEl.addClass('garden-shortcuts-modal');
        contentEl.createEl('h2', { text: 'Keyboard shortcuts' });
        const rows: [string, string][] = [
            ['N', 'New plant'],
            ['F  S  R  M', 'New flower, stem, root, mineral'],
            ['Arrows', 'Move between cells'],
            ['Enter', 'Edit the selected cell'],
            ['Delete', 'Delete the selected cells'],
            ['Shift D', 'Duplicate'],
            ['Ctrl C  X  V', 'Copy, cut, paste'],
            ['Ctrl A', 'Select the whole zone'],
            ['B', 'Show or hide the board'],
            ['Esc', 'Deselect'],
            ['?', 'This list'],
        ];
        const table = contentEl.createDiv('garden-shortcuts');
        for (const [keys, what] of rows) {
            table.createEl('kbd', { text: keys });
            table.createSpan({ text: what });
        }
    }
}
