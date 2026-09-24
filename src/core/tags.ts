/**
 * Plant tags: words a plant carries, so a group of plants can be hidden and
 * shown together. The tags are the plant's own (ProjectData.tags): they sync,
 * merge and travel with it like its name. Which of them are hidden is this
 * device's choice, kept on it like the board toggle, so hiding a group never
 * hides it for the people the garden or the plant is shared with.
 *
 * Tags are the same whatever their case: "Work" and "work" are one tag, shown
 * as it was first written. Pure, no DOM, covered by tags.test.ts; the app keeps
 * the hidden ones (GardenApp.hiddenTags).
 */
import type { ProjectData } from './model';

/** The longest a tag gets; the rest of a longer one is cut. */
export const MAX_TAG_LENGTH = 32;

/** A tag as it is kept: trimmed, one space between words, at most MAX_TAG_LENGTH long. '' is none. */
export function cleanTag(text: string): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH).trim();
}

/** What two spellings of one tag have in common. */
export function tagKey(tag: string): string {
    return cleanTag(tag).toLowerCase();
}

/** A plant's tags as stored, each once and clean. Anything else in the field is passed over. */
export function tagsOf(project: Pick<ProjectData, 'tags'>): string[] {
    const stored: unknown = project.tags;
    if (!Array.isArray(stored)) return [];
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const entry of stored as unknown[]) {
        if (typeof entry !== 'string') continue;
        const tag = cleanTag(entry);
        const key = tag.toLowerCase();
        if (!tag || seen.has(key)) continue;
        seen.add(key);
        tags.push(tag);
    }
    return tags;
}

export function hasTag(project: Pick<ProjectData, 'tags'>, tag: string): boolean {
    const key = tagKey(tag);
    return tagsOf(project).some(t => t.toLowerCase() === key);
}

/** Every tag in a garden, each once as it was first written, in alphabetical order. */
export function gardenTags(projects: readonly Pick<ProjectData, 'tags'>[]): string[] {
    const byKey = new Map<string, string>();
    for (const project of projects) {
        for (const tag of tagsOf(project)) {
            const key = tag.toLowerCase();
            if (!byKey.has(key)) byKey.set(key, tag);
        }
    }
    return [...byKey.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * Put `tag` on a plant, or take it off, in place. A plant without tags keeps
 * no empty list, so an untagged plant stores exactly what it did before tags.
 */
export function setTag(project: Pick<ProjectData, 'tags'>, tag: string, on: boolean) {
    const clean = cleanTag(tag);
    if (!clean || hasTag(project, clean) === on) return;
    const key = clean.toLowerCase();
    const rest = tagsOf(project).filter(t => t.toLowerCase() !== key);
    const next = on ? [...rest, clean] : rest;
    if (next.length > 0) project.tags = next;
    else delete project.tags;
}

/** Whether a plant is out of sight: it carries a hidden tag. */
export function isHidden(project: Pick<ProjectData, 'tags'>, hidden: ReadonlySet<string>): boolean {
    return hidden.size > 0 && tagsOf(project).some(t => hidden.has(t.toLowerCase()));
}
