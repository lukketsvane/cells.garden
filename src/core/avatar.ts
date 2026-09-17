/**
 * Generated profile pictures. Every account gets one from its user id, which is
 * random when the account is made, so nobody picks or uploads anything and the
 * same person looks the same on every device. The picture is a small pixel
 * sprite in the garden's style, mirrored like a seed head, inside a circle.
 */

/** A string to a 32-bit seed (FNV-1a). */
function hash(text: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** A small deterministic generator (mulberry32). */
function generator(seed: number) {
    let a = seed;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const GRID = 7;

/** The avatar as an SVG string, `size` pixels across. */
export function avatarSvg(seed: string, size = 24): string {
    const rand = generator(hash(seed || 'someone'));
    const hue = Math.floor(rand() * 360);
    const accent = (hue + 40 + Math.floor(rand() * 80)) % 360;
    const bg = `hsl(${hue} 35% 22%)`;
    const fg = `hsl(${hue} 55% 62%)`;
    const hi = `hsl(${accent} 70% 72%)`;

    const cells: string[] = [];
    const half = Math.ceil(GRID / 2);
    for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < half; x++) {
            const r = rand();
            // Denser toward the middle, so the shape reads as one thing in a circle.
            const centre = 1 - (Math.abs(x - (half - 1)) + Math.abs(y - (GRID - 1) / 2)) / GRID;
            if (r > 0.25 + (1 - centre) * 0.55) continue;
            const colour = rand() < 0.18 ? hi : fg;
            for (const cx of x === GRID - 1 - x ? [x] : [x, GRID - 1 - x]) {
                cells.push(`<rect x="${cx + 1}" y="${y + 1}" width="1" height="1" fill="${colour}"/>`);
            }
        }
    }

    const view = GRID + 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${view} ${view}" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true">`
        + `<clipPath id="a"><circle cx="${view / 2}" cy="${view / 2}" r="${view / 2}"/></clipPath>`
        + `<g clip-path="url(#a)"><rect width="${view}" height="${view}" fill="${bg}"/>${cells.join('')}</g></svg>`;
}

/** An element holding the avatar, for lists and the pill. */
export function avatarEl(seed: string, size = 24, cls = 'garden-avatar'): HTMLElement {
    const el = document.createElement('span');
    el.className = cls;
    el.innerHTML = avatarSvg(seed, size);
    return el;
}
