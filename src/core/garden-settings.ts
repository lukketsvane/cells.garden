/**
 * What the garden settings do to the picture: the sky at an hour, the sky's
 * day as a gradient, and how faint each mineral is. Pure, no DOM, covered by
 * garden-settings.test.ts.
 */
import { DEFAULT_SKY_NODES, type GardenSettings } from './model';

/** How far the stars come out on a black sky, as they always have at night. */
const NIGHT_STARS = 0.35;

type Rgb = [number, number, number];

function rgbOf(hex: string): Rgb | null {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

/**
 * Stars follow how dark a node's colour is: all of them (0.35) on black, fading
 * out as the colour lightens, none once its luminance reaches a quarter. The
 * default day's night nodes are black and its others are well above a
 * quarter, so it keeps the stars it always had.
 */
export function starsFor(color: Rgb): number {
    const luminance = (0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]) / 255;
    return NIGHT_STARS * Math.max(0, 1 - luminance / 0.25);
}

/** The nodes that parse, or the default day when none do (a garden from a newer or broken client). */
function nodesOf(settings: Pick<GardenSettings, 'skyNodes'>): { hour: number; color: Rgb }[] {
    const nodes = (Array.isArray(settings.skyNodes) ? settings.skyNodes : [])
        .map(n => ({ hour: Number(n?.hour), color: rgbOf(String(n?.color)) }))
        .filter((n): n is { hour: number; color: Rgb } => n.color !== null && n.hour >= 0 && n.hour <= 24);
    return nodes.length > 0 ? nodes : nodesOf({ skyNodes: [...DEFAULT_SKY_NODES] });
}

/**
 * The sky at `hour` (0 to 24): its colour and how far the stars are out.
 * Cycle mixes the two nodes the hour falls between, going round past midnight;
 * static is node 1 all day.
 */
export function skyAt(settings: Pick<GardenSettings, 'skyMode' | 'skyNodes'>, hour: number): { skyColor: string; starOpacity: number } {
    const nodes = nodesOf(settings);
    let from = nodes[0];
    let to = nodes[0];
    let t = 0;
    if (settings.skyMode !== 'static') {
        const sorted = [...nodes].sort((a, b) => a.hour - b.hour);
        const next = sorted.findIndex(n => n.hour > hour);
        to = sorted[next === -1 ? 0 : next];
        from = sorted[((next === -1 ? sorted.length : next) - 1 + sorted.length) % sorted.length];
        // Plain differences unless they cross midnight, so the default day rounds exactly as it always has.
        const wrap = (d: number) => (d < 0 ? d + 24 : d);
        const span = wrap(to.hour - from.hour);
        t = span > 0 ? wrap(hour - from.hour) / span : 0;
    }
    const mix = (a: number, b: number) => a + (b - a) * t;
    return {
        skyColor: `rgb(${from.color.map((c, i) => Math.round(mix(c, to.color[i]))).join(', ')})`,
        starOpacity: mix(starsFor(from.color), starsFor(to.color)),
    };
}

/** The sky's whole day left to right, midnight to midnight, as a CSS background. */
export function skyGradient(settings: Pick<GardenSettings, 'skyMode' | 'skyNodes'>): string {
    const edge = skyAt(settings, 0).skyColor;
    if (settings.skyMode === 'static') return `linear-gradient(to right, ${edge}, ${edge})`;
    const stops = nodesOf(settings)
        .sort((a, b) => a.hour - b.hour)
        .map(n => `rgb(${n.color.join(', ')}) ${(n.hour / 24) * 100}%`);
    return `linear-gradient(to right, ${edge} 0%, ${stops.join(', ')}, ${edge} 100%)`;
}

/**
 * How opaque mineral `index` (0 is the top one) of `total` is. With fading on,
 * minerals above number `mineralFadeFrom` stay whole; from it down they fade
 * evenly, the last one at `mineralFadeMin` percent.
 */
export function mineralOpacity(settings: Pick<GardenSettings, 'mineralFade' | 'mineralFadeFrom' | 'mineralFadeMin'>, index: number, total: number): number {
    if (!settings.mineralFade) return 1;
    const from = Math.max(1, Math.round(settings.mineralFadeFrom) || 1);
    const number = index + 1;
    if (number < from) return 1;
    const lowest = Math.min(100, Math.max(0, settings.mineralFadeMin)) / 100;
    return 1 - (1 - lowest) * (number - from + 1) / (total - from + 1);
}

/** 6.5 as '06:30', for a time field. */
export function timeOf(hour: number): string {
    const minutes = Math.round(hour * 60) % (24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** '06:30' as 6.5; null when the field is empty or not a time. */
export function hourOf(time: string): number | null {
    const m = /^(\d{1,2}):(\d{2})/.exec(time);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
    return Number(m[1]) + Number(m[2]) / 60;
}
