/**
 * The picture tiles of the Pets and Items menus: a sprite, its name and a word
 * on its state. The look lives in styles.css under "Pets and Items".
 */
import './shim';

export interface TileSpec {
    /** Which sprite this is; styles.css sizes the preview by it. */
    kind: string;
    label: string;
    preview: string;
    state: string;
    /** An on/off tile (a pet) says which it is; a plain button (an item) leaves this out. */
    pressed?: boolean;
    /** Shown greyed out and inert: not ready yet. */
    disabled?: boolean;
    onClick?: () => void;
}

export function pictureTile(grid: HTMLElement, spec: TileSpec): HTMLButtonElement {
    const tile = grid.createEl('button', {
        cls: 'garden-tile',
        attr: {
            type: 'button',
            'aria-label': spec.label + ', ' + spec.state.toLowerCase(),
            'data-kind': spec.kind,
        },
    });
    if (spec.pressed !== undefined) {
        tile.setAttribute('aria-pressed', String(spec.pressed));
        tile.toggleClass('is-active', spec.pressed);
    }
    if (spec.disabled) {
        tile.addClass('is-unavailable');
        tile.disabled = true;
    }

    const preview = tile.createDiv('garden-tile-preview');
    preview.createEl('img', { attr: { src: spec.preview, alt: '' } });
    tile.createSpan({ cls: 'garden-tile-name', text: spec.label });
    tile.createSpan({ cls: 'garden-tile-state', text: spec.state });

    const onClick = spec.onClick;
    if (onClick && !spec.disabled) tile.addEventListener('click', () => onClick());
    return tile;
}
