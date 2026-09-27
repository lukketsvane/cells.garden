import type { LayerName } from './model';
import flowersIconUrl from '../assets/pack/kanban_icons/flowers_icon.png';
import stemIconUrl from '../assets/pack/kanban_icons/stem_icon.png';
import rootsIconUrl from '../assets/pack/kanban_icons/roots_icon.png';
import mineralsIconUrl from '../assets/pack/kanban_icons/minerals_icon.png';

/**
 * The four zone icons, as drawn in src/assets/pack/kanban_icons: pixel art like
 * the garden they label, white on clear on a 9-square. They are masks, so they
 * take the colour of the text beside them, on a light theme too; redrawing one
 * is replacing its PNG.
 */
export const ZONE_ICONS: Record<LayerName, string> = {
    flowers: flowersIconUrl,
    stem: stemIconUrl,
    roots: rootsIconUrl,
    minerals: mineralsIconUrl,
};

/** A zone's icon, as a new span at the end of `parent`. */
export function zoneIcon(parent: HTMLElement, zone: LayerName, title?: string): HTMLElement {
    const icon = parent.createSpan({ cls: 'zone-icon', attr: title ? { title } : {} });
    icon.style.setProperty('--zone-icon', `url(${ZONE_ICONS[zone]})`);
    return icon;
}
