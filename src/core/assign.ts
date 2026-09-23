/**
 * Assigning people to cells, the pure half: what a cell holds, what a tap in
 * the Assign panel changes and whom it tells. No DOM and no network; covered by
 * assign.test.ts. Who can be assigned, and their pictures, is people.ts; the
 * panel is in the cell's menu (garden.ts).
 */
import type { LayerItem } from './model';

/** At most this many pictures on a cell; the rest are a count. */
export const SHOWN_ASSIGNEES = 3;
/** An account id is a uuid; anything much longer is not one. */
const MAX_ID = 64;
/** More than a garden and a plant can hold together. */
const MAX_ASSIGNEES = 50;

/** The people a stored cell is assigned to: strings, each once, in the order added. Anything else is left out. */
export function assigneesOf(item: { assignees?: unknown } | null | undefined): string[] {
    const stored = item?.assignees;
    if (!Array.isArray(stored)) return [];
    const ids = new Set<string>();
    for (const id of stored as unknown[]) {
        if (typeof id === 'string' && id && id.length <= MAX_ID) ids.add(id);
    }
    return [...ids].slice(0, MAX_ASSIGNEES);
}

/** Write a cell's people; nobody leaves the field out, as a cell that never had any. */
export function setAssignees(item: LayerItem, ids: readonly string[]) {
    if (ids.length > 0) item.assignees = [...ids];
    else delete item.assignees;
}

/** Whether every cell of a selection is assigned to `userId`. */
export function allAssigned(items: readonly LayerItem[], userId: string): boolean {
    return items.length > 0 && items.every(item => assigneesOf(item).includes(userId));
}

/**
 * One tap on a person: assign them to every cell of the selection, or when
 * every cell has them already, take them off every one. Returns the cells
 * that gained them, the ones to tell them about.
 */
export function toggleAssignee(items: readonly LayerItem[], userId: string): LayerItem[] {
    const off = allAssigned(items, userId);
    const gained: LayerItem[] = [];
    for (const item of items) {
        const now = assigneesOf(item);
        if (off) {
            setAssignees(item, now.filter(id => id !== userId));
        } else if (!now.includes(userId)) {
            setAssignees(item, [...now, userId]);
            gained.push(item);
        } else {
            setAssignees(item, now);
        }
    }
    return gained;
}

/** People on `after` who were not on `before`, never yourself: whom an assignment tells. */
export function newlyAssigned(before: readonly string[], after: readonly string[], me: string): string[] {
    const had = new Set(before);
    return [...new Set(after)].filter(id => id && id !== me && !had.has(id));
}

/** One line of at most `limit` characters, cut with an ellipsis. */
export function clip(text: string, limit: number): string {
    const line = text.replace(/\s+/g, ' ').trim();
    return line.length <= limit ? line : line.slice(0, limit - 1).trimEnd() + '…';
}

/** What the notify function takes after an assignment is saved (supabase/functions/notify). */
export interface AssignNotice {
    recipients: string[];
    gardenId?: string;
    plantId?: string;
    projectId: string;
    itemId: string;
    /** The cell's text and the plant's name. The function reads both from the saved garden and uses those. */
    text: string;
    where: string;
}

/** The request for one cell, or null when there is nobody to tell. */
export function assignNotice(input: {
    me: string;
    added: readonly string[];
    gardenId?: string | null;
    plantId?: string | null;
    projectId: string;
    itemId: string;
    text: string;
    where: string;
}): AssignNotice | null {
    const recipients = newlyAssigned([], input.added, input.me);
    if (recipients.length === 0 || (!input.gardenId && !input.plantId)) return null;
    return {
        recipients,
        ...(input.gardenId ? { gardenId: input.gardenId } : {}),
        ...(input.plantId ? { plantId: input.plantId } : {}),
        projectId: input.projectId,
        itemId: input.itemId,
        text: clip(input.text, 140),
        where: clip(input.where, 80),
    };
}

/** "Assigned to Ana", "Assigned to Ana and Bo", "Assigned to Ana, Bo and Cy". */
export function assignedLabel(names: readonly string[]): string {
    if (names.length === 0) return '';
    if (names.length === 1) return `Assigned to ${names[0]}`;
    return `Assigned to ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
