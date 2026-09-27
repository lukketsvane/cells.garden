/**
 * Profile pictures. Every account gets one generated from a seed, random when
 * the account is made, so the same person looks the same on every device: a
 * small pixel sprite in the garden's style, mirrored like a seed head, inside a
 * circle. Anyone may draw their own instead (avatar-editor.ts); a drawing is
 * shown wherever the seed would be. The pixels themselves are avatar-pixels.ts.
 */
import './shim';
import { avatarSvg } from './avatar-pixels';
import { setIcon } from './icons';

export {
    DRAWING_FORMAT,
    GRID,
    PALETTE,
    PICTURE_GRID,
    blankOf,
    decodeDrawing,
    encodeDrawing,
    fromSeed,
    gridOf,
    isDrawing,
    isMirrored,
    paletteFor,
    toTwelve,
    type Drawing,
} from './avatar-pixels';

let clips = 0;

/** An element holding the picture, for lists and the pill. `avatar` is a drawing or a seed. */
export function avatarEl(avatar: string, size = 24, cls = 'garden-avatar'): HTMLElement {
    const el = createSpan(cls);
    setIcon(el, avatarSvg(avatar, size));
    // A circle of its own for each picture. With the one id every picture's
    // markup carries, all of them were cut by the first in the page, and none
    // showed while that one was hidden (a cell's, with the board hidden).
    const clip = el.querySelector('clipPath');
    const group = el.querySelector('g[clip-path]');
    if (clip && group) {
        clip.id = `garden-avatar-clip-${++clips}`;
        group.setAttribute('clip-path', `url(#${clip.id})`);
    }
    return el;
}
