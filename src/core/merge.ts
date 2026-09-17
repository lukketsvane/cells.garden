/**
 * Three-way merge of two versions of one garden (M4).
 *
 * `base` is the last version this device knows the server held, `local` is
 * what this device wants to write, `remote` is what the server holds now.
 * Plants and cells are matched by id, so two people editing different plants,
 * or different cells of one plant, both keep their work. What still loses:
 * the same field of the same cell changed on both sides (remote wins), and the
 * same list reordered differently on both sides (remote's order wins).
 *
 * With no base (an old offline copy with no snapshot) the merge is a union:
 * nothing is deleted and local wins field conflicts.
 *
 * Pure, no DOM, covered by merge.test.ts.
 */
import type { Garden, GardenSettings, LayerItem, LayerName, ProjectData } from './model';

type Prefer = 'local' | 'remote';

const LAYERS: LayerName[] = ['roots', 'stem', 'flowers', 'minerals'];
const PROJECT_FIELDS = ['name', 'seed', 'seedImagePath', 'standby', 'hue', 'plantType', 'sharedPlantId'] as const;

/** JSON with sorted keys, so two equal objects compare equal whatever their key order. */
function canonical(value: unknown): string {
    return JSON.stringify(value, (_key, v) => {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            const sorted: Record<string, unknown> = {};
            for (const k of Object.keys(v).sort()) sorted[k] = (v as Record<string, unknown>)[k];
            return sorted;
        }
        return v;
    });
}

function same(a: unknown, b: unknown): boolean {
    return canonical(a) === canonical(b);
}

/** Per key: the side that changed from base wins; both changed means `prefer` wins. */
function mergeFields<T extends object>(base: T | undefined, local: T, remote: T, prefer: Prefer, keys?: readonly string[]): T {
    const out: Record<string, unknown> = {};
    const all = keys ?? Array.from(new Set([...Object.keys(local), ...Object.keys(remote)]));
    const b = base as Record<string, unknown> | undefined;
    const l = local as Record<string, unknown>;
    const r = remote as Record<string, unknown>;
    for (const key of all) {
        let value: unknown;
        if (same(l[key], r[key])) value = r[key];
        else if (b && same(l[key], b[key])) value = r[key];
        else if (b && same(r[key], b[key])) value = l[key];
        else value = prefer === 'remote' ? r[key] : l[key];
        if (value !== undefined) out[key] = value;
    }
    return out as T;
}

/**
 * Merge two id-keyed lists. `mergeOne` decides the fields of an entry both sides
 * kept; `prefer` breaks ties in order and fields.
 */
function mergeList<T extends { id: string }>(
    base: T[] | null,
    local: T[],
    remote: T[],
    prefer: Prefer,
    mergeOne: (b: T | undefined, l: T, r: T, prefer: Prefer) => T,
): T[] {
    const bMap = new Map((base ?? []).map(x => [x.id, x]));
    const lMap = new Map(local.map(x => [x.id, x]));
    const rMap = new Map(remote.map(x => [x.id, x]));

    const kept = new Map<string, T>();
    for (const id of new Set([...lMap.keys(), ...rMap.keys()])) {
        const b = bMap.get(id);
        const l = lMap.get(id);
        const r = rMap.get(id);
        if (l && r) {
            kept.set(id, same(l, r) ? r : mergeOne(b, l, r, b ? prefer : (base ? 'remote' : prefer)));
        } else if (l) {
            // Remote deleted it, or local added it. An edit beats a delete.
            if (!b || base === null || !same(l, b)) kept.set(id, l);
        } else if (r) {
            if (!b || base === null || !same(r, b)) kept.set(id, r);
        }
    }

    // Order: compare how each side arranges the entries all three versions share.
    // If only local rearranged them, local's order leads; otherwise remote's.
    const idsOf = (xs: T[]) => xs.map(x => x.id);
    const inAll = (id: string) => bMap.has(id) && lMap.has(id) && rMap.has(id);
    const leadIsLocal = base
        ? !same(idsOf(local).filter(inAll), idsOf(base).filter(inAll)) && same(idsOf(remote).filter(inAll), idsOf(base).filter(inAll))
        : prefer === 'local';
    const lead = leadIsLocal ? local : remote;
    const other = leadIsLocal ? remote : local;

    const sequence = idsOf(lead).filter(id => kept.has(id));
    const otherIds = idsOf(other);
    // Walk backwards so each entry can anchor on one that is already placed.
    for (let index = otherIds.length - 1; index >= 0; index--) {
        const id = otherIds[index];
        if (!kept.has(id) || sequence.includes(id)) continue;
        // Place it before the entry that follows it on its own side; nothing follows: at the end.
        const next = otherIds.slice(index + 1).find(after => sequence.includes(after));
        sequence.splice(next === undefined ? sequence.length : sequence.indexOf(next), 0, id);
    }
    return sequence.map(id => kept.get(id) as T);
}

function mergeItem(b: LayerItem | undefined, l: LayerItem, r: LayerItem, prefer: Prefer): LayerItem {
    return mergeFields(b, l, r, prefer);
}

function byOrder(projects: ProjectData[]): ProjectData[] {
    return [...projects].sort((a, b) => (a.order || 0) - (b.order || 0));
}

function mergeProject(b: ProjectData | undefined, l: ProjectData, r: ProjectData, prefer: Prefer): ProjectData {
    const fields = mergeFields(b, l, r, prefer, PROJECT_FIELDS);
    const merged: ProjectData = { ...r, ...fields, id: r.id, order: r.order };
    for (const key of PROJECT_FIELDS) {
        if (!(key in fields)) delete (merged as unknown as Record<string, unknown>)[key];
    }
    for (const layer of LAYERS) {
        merged[layer] = mergeList(b ? b[layer] : null, l[layer] ?? [], r[layer] ?? [], prefer, mergeItem);
    }
    return merged;
}

function mergeSettings(base: GardenSettings | undefined, local: GardenSettings, remote: GardenSettings, prefer: Prefer): GardenSettings {
    // viewState is per surface and never synced; keep whatever remote carries.
    const { viewState: _l, ...l } = local;
    const { viewState, ...r } = remote;
    const b = base ? (({ viewState: _b, ...rest }) => rest)(base) : undefined;
    const merged = mergeFields(b, l, r, prefer) as GardenSettings;
    return viewState === undefined ? merged : { ...merged, viewState };
}

/** The fields of a plant that are its own; where it stands in a garden is not. */
export type PlantData = Omit<ProjectData, 'order' | 'sharedPlantId'>;

/** A plant without the garden-specific fields, for sharing. */
export function plantData(project: ProjectData): PlantData {
    const { order: _order, sharedPlantId: _shared, ...data } = project;
    return data;
}

/**
 * Three-way merge of one shared plant. Same rules as a garden: cells matched by
 * id, the changed side wins, remote wins when both changed, no base is a union.
 */
export function mergePlant(base: PlantData | null, local: PlantData, remote: PlantData): PlantData {
    const asProject = (p: PlantData): ProjectData => ({ ...p, order: 0 });
    return plantData(mergeProject(base ? asProject(base) : undefined, asProject(local), asProject(remote), base ? 'remote' : 'local'));
}

/** Deep equality with sorted keys, for callers that need to know whether anything changed. */
export function sameData(a: unknown, b: unknown): boolean {
    return same(a, b);
}

export function mergeGardens(base: Garden | null, local: Garden, remote: Garden, now: () => string = () => new Date().toISOString()): Garden {
    const prefer: Prefer = base ? 'remote' : 'local';
    const projects = mergeList(
        base ? byOrder(base.projects) : null,
        byOrder(local.projects),
        byOrder(remote.projects),
        prefer,
        mergeProject,
    ).map((p, i) => (p.order === i ? p : { ...p, order: i }));
    const settings = mergeSettings(base?.settings, local.settings, remote.settings, prefer);

    const unchanged = same(projects, byOrder(remote.projects).map((p, i) => (p.order === i ? p : { ...p, order: i })))
        && same(settings, remote.settings);
    return {
        version: 1,
        projects,
        settings,
        updatedAt: unchanged ? remote.updatedAt : now(),
    };
}
