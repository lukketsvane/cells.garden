/**
 * Minimal stand-ins for Obsidian's Modal / Setting / component classes.
 * Only the surface Max's modals use is implemented.
 */
import './shim';

/**
 * Obsidian's ItemView gave the garden a `containerEl` and a `contentEl`
 * (its `.view-content` child). Same shape, no workspace.
 */
export class View {
    containerEl: HTMLElement;
    contentEl: HTMLElement;

    constructor(containerEl: HTMLElement) {
        this.containerEl = containerEl;
        this.containerEl.addClass('view');
        this.contentEl = containerEl.createDiv('view-content');
    }
}

export class Modal {
    containerEl: HTMLElement;
    modalEl: HTMLElement;
    contentEl: HTMLElement;
    private _onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            this.close();
        }
    };

    constructor() {
        this.containerEl = document.createElement('div');
        this.containerEl.addClass('modal-container');

        const bg = this.containerEl.createDiv('modal-bg');
        bg.addEventListener('click', () => this.close());

        this.modalEl = this.containerEl.createDiv('modal');
        const closeBtn = this.modalEl.createDiv({ cls: 'modal-close-button', attr: { role: 'button', 'aria-label': 'Close' } });
        closeBtn.addEventListener('click', () => this.close());
        this.contentEl = this.modalEl.createDiv('modal-content');
    }

    open() {
        document.body.appendChild(this.containerEl);
        document.addEventListener('keydown', this._onKeyDown);
        this.onOpen();
    }

    close() {
        if (!this.containerEl.isConnected) return;
        document.removeEventListener('keydown', this._onKeyDown);
        this.onClose();
        this.containerEl.remove();
    }

    onOpen() {}
    onClose() {}
}

export class TextComponent {
    inputEl: HTMLInputElement;
    constructor(containerEl: HTMLElement) {
        this.inputEl = containerEl.createEl('input', { type: 'text' });
    }
    getValue() { return this.inputEl.value; }
    setValue(value: string) { this.inputEl.value = value; return this; }
    setPlaceholder(placeholder: string) { this.inputEl.placeholder = placeholder; return this; }
    onChange(cb: (value: string) => void) {
        this.inputEl.addEventListener('input', () => cb(this.inputEl.value));
        return this;
    }
}

export class TextAreaComponent {
    inputEl: HTMLTextAreaElement;
    constructor(containerEl: HTMLElement) {
        this.inputEl = containerEl.createEl('textarea');
    }
    getValue() { return this.inputEl.value; }
    setValue(value: string) { this.inputEl.value = value; return this; }
    setPlaceholder(placeholder: string) { this.inputEl.placeholder = placeholder; return this; }
    onChange(cb: (value: string) => void) {
        this.inputEl.addEventListener('input', () => cb(this.inputEl.value));
        return this;
    }
}

export class ButtonComponent {
    buttonEl: HTMLButtonElement;
    constructor(containerEl: HTMLElement) {
        this.buttonEl = containerEl.createEl('button', { type: 'button' });
    }
    setButtonText(text: string) { this.buttonEl.setText(text); return this; }
    setCta() { this.buttonEl.addClass('mod-cta'); return this; }
    setWarning() { this.buttonEl.addClass('mod-warning'); return this; }
    onClick(cb: (evt: MouseEvent) => void) {
        this.buttonEl.addEventListener('click', cb);
        return this;
    }
}

export class Setting {
    settingEl: HTMLElement;
    infoEl: HTMLElement;
    nameEl: HTMLElement;
    descEl: HTMLElement;
    controlEl: HTMLElement;

    constructor(containerEl: HTMLElement) {
        this.settingEl = containerEl.createDiv('setting-item');
        this.infoEl = this.settingEl.createDiv('setting-item-info');
        this.nameEl = this.infoEl.createDiv('setting-item-name');
        this.descEl = this.infoEl.createDiv('setting-item-description');
        this.controlEl = this.settingEl.createDiv('setting-item-control');
    }
    setName(name: string) { this.nameEl.setText(name); return this; }
    setDesc(desc: string) { this.descEl.setText(desc); return this; }
    addText(cb: (text: TextComponent) => void) { cb(new TextComponent(this.controlEl)); return this; }
    addTextArea(cb: (text: TextAreaComponent) => void) { cb(new TextAreaComponent(this.controlEl)); return this; }
    addButton(cb: (button: ButtonComponent) => void) { cb(new ButtonComponent(this.controlEl)); return this; }
}
