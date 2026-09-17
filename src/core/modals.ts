import { Modal, Setting } from './ui';

// --- The Confirm Delete Modal ---

export class ConfirmDeleteModal extends Modal {
    onSubmit: () => void;
    plantName: string;

    constructor(plantName: string, onSubmit: () => void) {
        super();
        this.onSubmit = onSubmit;
        this.plantName = plantName;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "♻️ Recycle Plant?" });
        contentEl.createEl("p", {
            text: `Are you sure you want to recycle "${this.plantName}"? This will permanently delete the plant and all its tasks.`,
            cls: "modal-warning-text"
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

    onClose() {
        this.contentEl.empty();
    }
}

// --- The Create Project Modal ---

export class CreateProjectModal extends Modal {
    onSubmit: (seed: string) => void;

    constructor(onSubmit: (seed: string) => void) {
        super();
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "🌱 Plant a New Seed" });

        let projectSeed = "";

        new Setting(contentEl)
            .setName("Goal / Seed")
            .setDesc("This will also act as the plant's title.")
            .addTextArea((text) => {
                text.onChange((value) => { projectSeed = value; });

                // --- THE SPELL ---
                text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Enter' && !e.shiftKey) { // Allow Shift+Enter for new lines!
                        e.preventDefault();
                        if (projectSeed.trim()) {
                            this.close();
                            this.onSubmit(projectSeed);
                        }
                    }
                });
                // ----------------

                setTimeout(() => text.inputEl.focus(), 50);
            });

        new Setting(contentEl)
            .addButton((btn) => {
                btn.setButtonText("Cancel").onClick(() => this.close());
            })
            .addButton((btn) => {
                btn.setButtonText("Plant Seed")
                    .setCta()
                    .onClick(() => {
                        if (projectSeed.trim()) {
                            this.close();
                            this.onSubmit(projectSeed);
                        }
                    });
            });
    }

    onClose() {
        this.contentEl.empty();
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

    onClose() {
        this.contentEl.empty();
    }
}
