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
    decodeDrawing,
    encodeDrawing,
    fromSeed,
    isDrawing,
    isMirrored,
    type Drawing,
} from './avatar-pixels';

/** An element holding the picture, for lists and the pill. `avatar` is a drawing or a seed. */
export function avatarEl(avatar: string, size = 24, cls = 'garden-avatar'): HTMLElement {
    const el = createSpan(cls);
    setIcon(el, avatarSvg(avatar, size));
    return el;
}
