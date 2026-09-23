/**
 * The people cells are assigned to: who they are, for their pictures on a
 * cell, and who could be, for the Assign panel. One directory per signed-in
 * account, kept on the device so the pictures show at once and offline, and
 * brought up to date with one request as the account opens. Who can see a
 * garden or a plant is asked when its first cell menu opens and remembered for
 * a minute, so drawing the board never asks anything.
 */
import './shim';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assignedLabel, SHOWN_ASSIGNEES } from './assign';
import { avatarEl } from './avatar';
import { gardenPeople, getProfile, listFriends, plantPeople } from './sharing';
import { LOCAL_KEY, readJson, writeJson } from './store';

export interface Person {
    id: string;
    name: string;
    /** A drawing or a seed (avatar.ts). */
    avatar: string;
}

/**
 * Someone the directory does not know, such as a person who left the garden:
 * a plain figure on the garden's deep blue, the same for everyone.
 */
export const NOBODY_AVATAR = 'd1:3' + '0000000' + '0088800' + '0088800' + '0008000' + '0888880' + '8888888' + '8888888';

/** A picture on a cell, in CSS pixels: two to each of its nine art pixels, so they stay crisp. */
const ASSIGNEE_SIZE = 18;
/** How far each next picture starts from the one before it: they overlap a third. */
const ASSIGNEE_STEP = 12;
const SEEING_MS = 60_000;
const KEPT = 200;

const peopleKey = (userId: string) => `${LOCAL_KEY}/people/${userId}`;

const isPerson = (p: unknown): p is Person =>
    !!p && typeof p === 'object' && ['id', 'name', 'avatar'].every(k => typeof (p as Record<string, unknown>)[k] === 'string');

/**
 * The pictures of a cell's people at its trailing edge: the first few,
 * overlapping, then "+n" for the rest. Named in full for a screen reader and
 * a hovering pointer. An id nobody knows shows the plain figure.
 */
export function assigneeStack(ids: readonly string[], person: (id: string) => Person | undefined, me: string | null): HTMLElement {
    const stack = createSpan({ cls: 'garden-assignees', attr: { role: 'img', contenteditable: 'false' } });
    const shown = ids.slice(0, SHOWN_ASSIGNEES);
    for (const id of shown) stack.appendChild(avatarEl(person(id)?.avatar ?? NOBODY_AVATAR, ASSIGNEE_SIZE, 'garden-assignee'));
    const more = ids.length - shown.length;
    // The count is drawn from the attribute, so it is never part of the cell's text.
    if (more > 0) stack.createSpan({ cls: 'garden-assignee garden-assignees-more', attr: { 'data-more': `+${more}` } });
    const label = assignedLabel(ids.map(id => (id === me ? 'you' : person(id)?.name || 'someone')));
    stack.setAttribute('aria-label', label);
    stack.title = label;
    return stack;
}

/** The width the pictures take, for the cell to keep its text clear of them. */
export function assigneeRoom(count: number): number {
    const circles = Math.min(count, SHOWN_ASSIGNEES) + (count > SHOWN_ASSIGNEES ? 1 : 0);
    return circles === 0 ? 0 : ASSIGNEE_SIZE + (circles - 1) * ASSIGNEE_STEP;
}

/** A garden and a plant are asked about apart, and remembered apart. */
function keysOf(gardenId: string | null, plantId: string | null): string[] {
    return [...(gardenId ? [`g:${gardenId}`] : []), ...(plantId ? [`p:${plantId}`] : [])];
}

export class People {
    private known = new Map<string, Person>();
    private seeing = new Map<string, { at: number; ids: string[] }>();
    private asking = new Map<string, Promise<string[]>>();

    constructor(
        private readonly client: SupabaseClient,
        readonly userId: string,
        /** Someone's name or picture changed: pictures already drawn may be out of date. */
        private readonly changed: () => void,
    ) {
        for (const p of readJson<unknown[]>(peopleKey(userId)) ?? []) if (isPerson(p)) this.known.set(p.id, p);
    }

    get(id: string): Person | undefined {
        return this.known.get(id);
    }

    /** You, as far as known: before the profile loads, the picture every account starts with. */
    me(): Person {
        return this.known.get(this.userId) ?? { id: this.userId, name: 'You', avatar: this.userId };
    }

    /** Take in what was learnt about people. True when something shown changed. */
    private learn(people: Person[]): boolean {
        let changed = false;
        for (const p of people) {
            const had = this.known.get(p.id);
            if (had && had.name === p.name && had.avatar === p.avatar) continue;
            this.known.set(p.id, p);
            changed = true;
        }
        if (changed) writeJson(peopleKey(this.userId), [...this.known.values()].slice(-KEPT));
        return changed;
    }

    /** You and everyone you share a garden or a plant with: one request each, as the account opens. */
    async refresh(): Promise<void> {
        const [profile, friends] = await Promise.all([
            getProfile(this.client, this.userId).catch(() => null),
            listFriends(this.client).catch(() => []),
        ]);
        const people: Person[] = friends.map(f => ({ id: f.userId, name: f.name, avatar: f.avatar }));
        if (profile) people.push({ id: this.userId, name: profile.name || 'You', avatar: profile.avatar });
        if (this.learn(people)) this.changed();
    }

    /** Your own picture or name changed (Settings). */
    updateMe(changes: Partial<Omit<Person, 'id'>>) {
        if (this.learn([{ ...this.me(), ...changes }])) this.changed();
    }

    /**
     * Everyone who can see a cell in `gardenId`'s garden and on `plantId`'s
     * plant, you first: remembered from the last time they were asked, or
     * null when they never were.
     */
    cached(gardenId: string | null, plantId: string | null): Person[] | null {
        const lists = keysOf(gardenId, plantId).map(key => this.seeing.get(key));
        if (lists.some(list => !list)) return null;
        return this.everyoneOf(lists.flatMap(list => list?.ids ?? []));
    }

    /** The same, asked of the server when it was not asked in the last minute. */
    async load(gardenId: string | null, plantId: string | null): Promise<Person[]> {
        await Promise.all(keysOf(gardenId, plantId).map(key => this.ask(key)));
        return this.cached(gardenId, plantId) ?? [this.me()];
    }

    private ask(key: string): Promise<string[]> {
        const hit = this.seeing.get(key);
        if (hit && Date.now() - hit.at <= SEEING_MS) return Promise.resolve(hit.ids);
        const running = this.asking.get(key);
        if (running) return running;
        const id = key.slice(2);
        const job = (key.startsWith('g:') ? gardenPeople(this.client, id) : plantPeople(this.client, id))
            .then((members) => {
                const people = members.map(m => ({ id: m.userId, name: m.name, avatar: m.avatar }));
                if (this.learn(people)) this.changed();
                const ids = people.map(p => p.id);
                this.seeing.set(key, { at: Date.now(), ids });
                return ids;
            })
            .finally(() => this.asking.delete(key));
        this.asking.set(key, job);
        return job;
    }

    /** You first, then the others in the order they were found, each once. */
    private everyoneOf(ids: string[]): Person[] {
        const others = [...new Set(ids)].filter(id => id !== this.userId);
        return [this.me(), ...others.map(id => this.known.get(id) ?? { id, name: 'someone', avatar: NOBODY_AVATAR })];
    }
}
