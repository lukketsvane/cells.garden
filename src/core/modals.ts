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

// --- The Add Item Modal ---

export class AddItemModal extends Modal {
    onSubmit: (content: string) => void;
    title: string;
    placeholder: string;

    constructor(title: string, placeholder: string, onSubmit: (content: string) => void) {
        super();
        this.title = title;
        this.placeholder = placeholder;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: this.title });

        let itemContent = "";

        new Setting(contentEl)
            .addText((text) => {
                text.setPlaceholder(this.placeholder);
                text.onChange((value) => { itemContent = value; });

                // --- THE SPELL ---
                text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        if (itemContent.trim()) {
                            this.close();
                            this.onSubmit(itemContent);
                        }
                    }
                });
                // ----------------

                setTimeout(() => text.inputEl.focus(), 50);
            });
    }

    onClose() {
        this.contentEl.empty();
    }
}
