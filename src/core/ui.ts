/**
 * Minimal stand-ins for Obsidian's Modal / Setting / component classes.
 * Only the surface Max's modals use is implemented.
 */
import './shim';
import { setIcon } from './icons';

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
        this.containerEl = createDiv('modal-container');

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
        this.containerEl.remove();
    }

    onOpen() {}
}

/** A text input or a textarea: the same four methods either way. */
class InputComponent<E extends HTMLInputElement | HTMLTextAreaElement> {
    constructor(public inputEl: E) {}
    getValue() { return this.inputEl.value; }
    setValue(value: string) { this.inputEl.value = value; return this; }
    setPlaceholder(placeholder: string) { this.inputEl.placeholder = placeholder; return this; }
    onChange(cb: (value: string) => void) {
        this.inputEl.addEventListener('input', () => cb(this.inputEl.value));
        return this;
    }
}

class ButtonComponent {
    buttonEl: HTMLButtonElement;
    constructor(containerEl: HTMLElement) {
        this.buttonEl = containerEl.createEl('button', { type: 'button' });
    }
    setButtonText(text: string) { this.buttonEl.setText(text); return this; }
    setCta() { this.buttonEl.addClass('mod-cta'); return this; }
    setWarning() { this.buttonEl.addClass('mod-warning'); return this; }
    onClick(cb: (evt: MouseEvent) => unknown) {
        this.buttonEl.addEventListener('click', cb);
        return this;
    }
}

/** A choice from a list, answered on change. */
class DropdownComponent {
    selectEl: HTMLSelectElement;
    constructor(containerEl: HTMLElement) {
        this.selectEl = containerEl.createEl('select', { cls: 'dropdown' });
    }
    addOption(value: string, display: string) { this.selectEl.createEl('option', { text: display, attr: { value } }); return this; }
    getValue() { return this.selectEl.value; }
    setValue(value: string) { this.selectEl.value = value; return this; }
    onChange(cb: (value: string) => void) {
        this.selectEl.addEventListener('change', () => cb(this.selectEl.value));
        return this;
    }
}

/** An on/off switch, marked up the way Obsidian's is so its styles apply there. */
class ToggleComponent {
    toggleEl: HTMLElement;
    private value = false;
    private listeners: ((value: boolean) => void)[] = [];
    constructor(containerEl: HTMLElement) {
        this.toggleEl = containerEl.createDiv({ cls: 'checkbox-container', attr: { role: 'switch', tabindex: '0' } });
        const flip = () => {
            this.setValue(!this.value);
            for (const cb of this.listeners) cb(this.value);
        };
        this.toggleEl.addEventListener('click', flip);
        this.toggleEl.addEventListener('keydown', (e) => {
            if (e.key !== ' ' && e.key !== 'Enter') return;
            e.preventDefault();
            flip();
        });
    }
    getValue() { return this.value; }
    setValue(on: boolean) {
        this.value = on;
        this.toggleEl.toggleClass('is-enabled', on);
        this.toggleEl.setAttribute('aria-checked', String(on));
        return this;
    }
    onChange(cb: (value: boolean) => void) { this.listeners.push(cb); return this; }
}

/** A colour well. Answers when a colour is chosen, not on every step of the drag. */
class ColorComponent {
    colorPickerEl: HTMLInputElement;
    constructor(containerEl: HTMLElement) {
        this.colorPickerEl = containerEl.createEl('input', { type: 'color' });
    }
    getValue() { return this.colorPickerEl.value; }
    setValue(hex: string) { this.colorPickerEl.value = hex; return this; }
    onChange(cb: (value: string) => void) {
        this.colorPickerEl.addEventListener('change', () => cb(this.colorPickerEl.value));
        return this;
    }
}

/** A small icon button beside the control, for revert and remove. Takes the SVG itself (see icons.ts). */
class ExtraButtonComponent {
    extraSettingsEl: HTMLElement;
    constructor(containerEl: HTMLElement) {
        this.extraSettingsEl = containerEl.createDiv({ cls: 'clickable-icon extra-setting-button', attr: { role: 'button', tabindex: '0' } });
    }
    setIcon(svg: string) { setIcon(this.extraSettingsEl, svg); return this; }
    setTooltip(tooltip: string) { this.extraSettingsEl.setAttribute('aria-label', tooltip); this.extraSettingsEl.title = tooltip; return this; }
    onClick(cb: () => unknown) {
        this.extraSettingsEl.addEventListener('click', () => cb());
        this.extraSettingsEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                cb();
            }
        });
        return this;
    }
}

export class Setting {
    settingEl: HTMLElement;
    nameEl: HTMLElement;
    descEl: HTMLElement;
    controlEl: HTMLElement;

    constructor(containerEl: HTMLElement) {
        const settingEl = this.settingEl = containerEl.createDiv('setting-item');
        const infoEl = settingEl.createDiv('setting-item-info');
        this.nameEl = infoEl.createDiv('setting-item-name');
        this.descEl = infoEl.createDiv('setting-item-description');
        this.controlEl = settingEl.createDiv('setting-item-control');
    }
    setName(name: string) { this.nameEl.setText(name); return this; }
    setDesc(desc: string) { this.descEl.setText(desc); return this; }
    addText(cb: (text: InputComponent<HTMLInputElement>) => void) { cb(new InputComponent(this.controlEl.createEl('input', { type: 'text' }))); return this; }
    addTextArea(cb: (text: InputComponent<HTMLTextAreaElement>) => void) { cb(new InputComponent(this.controlEl.createEl('textarea'))); return this; }
    addButton(cb: (button: ButtonComponent) => void) { cb(new ButtonComponent(this.controlEl)); return this; }
    addDropdown(cb: (dropdown: DropdownComponent) => void) { cb(new DropdownComponent(this.controlEl)); return this; }
    addToggle(cb: (toggle: ToggleComponent) => void) { cb(new ToggleComponent(this.controlEl)); return this; }
    addColorPicker(cb: (color: ColorComponent) => void) { cb(new ColorComponent(this.controlEl)); return this; }
    addExtraButton(cb: (button: ExtraButtonComponent) => void) { cb(new ExtraButtonComponent(this.controlEl)); return this; }
    setHeading() { this.settingEl.addClass('setting-item-heading'); return this; }
}
