/**
 * Notifications inside the app, in every build: someone assigned you a cell.
 *
 * They are rows of the `notifications` table (migration 0012), written only by
 * the notify function (supabase/functions/notify), which also pushes them to
 * the devices that asked (web-push.ts). Here the list is read, marked read,
 * and kept up to date over realtime while the app is open. Before the
 * migration there is no table, and the app shows no Notifications at all.
 */
import './shim';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { AssignNotice } from './assign';
import { avatarEl } from './avatar';
import { timeAgo, type CellTarget } from './notify-core';
import { NOBODY_AVATAR, type Person } from './people';
import { notThereYet } from './sharing';
import { Modal } from './ui';

export interface GardenNotification {
    id: string;
    actorId: string | null;
    title: string;
    body: string;
    createdAt: string;
    readAt: string | null;
    target: CellTarget;
}

interface NotificationRow {
    id: string;
    actor_id: string | null;
    garden_id: string | null;
    plant_id: string | null;
    project_id: string;
    item_id: string;
    title: string;
    body: string | null;
    created_at: string;
    read_at: string | null;
}

const COLUMNS = 'id, actor_id, garden_id, plant_id, project_id, item_id, title, body, created_at, read_at';
/** The newest this many; older ones stay in the table. */
const SHOWN = 50;

function fromRow(row: NotificationRow): GardenNotification {
    return {
        id: row.id,
        actorId: row.actor_id,
        title: row.title,
        body: row.body ?? '',
        createdAt: row.created_at,
        readAt: row.read_at,
        target: {
            itemId: row.item_id,
            projectId: row.project_id,
            ...(row.garden_id ? { gardenId: row.garden_id } : {}),
            ...(row.plant_id ? { plantId: row.plant_id } : {}),
        },
    };
}

let warned = false;

/**
 * Ask the notify function to tell the people just assigned. Nothing waits for
 * it, and a failure (the function not deployed yet, no network) only costs
 * the notification: the assignment is saved either way.
 */
export function sendAssignNotice(client: SupabaseClient, notice: AssignNotice) {
    client.functions.invoke('notify', { body: notice })
        .then(({ error }) => {
            if (error && !warned) {
                warned = true;
                console.warn('Garden Cells: could not notify', (error as Error).message);
            }
        })
        .catch(() => {});
}

export class NotificationCenter {
    list: GardenNotification[] = [];
    /** False until the table answers; stays false before migration 0012. */
    available = false;
    private channel: RealtimeChannel | null = null;
    private stopped = false;
    private readonly watchers = new Set<() => void>();

    constructor(
        private readonly client: SupabaseClient,
        private readonly userId: string,
        /** A new one came in while the app is open. */
        private readonly arrived: (notification: GardenNotification) => void,
    ) {}

    get unread(): number {
        return this.list.filter(n => !n.readAt).length;
    }

    /** Be told whenever the list or what is read changes. Returns the way to stop. */
    watch(fn: () => void): () => void {
        this.watchers.add(fn);
        return () => this.watchers.delete(fn);
    }

    private changed() {
        for (const fn of this.watchers) fn();
    }

    async start() {
        await this.load();
        if (!this.available || this.stopped) return;
        const filter = `user_id=eq.${this.userId}`;
        this.channel = this.client
            .channel(`notifications:${this.userId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter }, (payload) => {
                const row = payload.new as NotificationRow | undefined;
                if (!row?.id || this.list.some(n => n.id === row.id)) return;
                const notification = fromRow(row);
                this.list = [notification, ...this.list].slice(0, SHOWN);
                this.changed();
                this.arrived(notification);
            })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter }, (payload) => {
                const row = payload.new as NotificationRow | undefined;
                if (!row?.id) return;
                this.list = this.list.map(n => (n.id === row.id ? fromRow(row) : n));
                this.changed();
            })
            .subscribe();
    }

    stop() {
        this.stopped = true;
        this.watchers.clear();
        void this.channel?.unsubscribe();
        this.channel = null;
    }

    async load() {
        const { data, error } = await this.client
            .from('notifications')
            .select(COLUMNS)
            .eq('user_id', this.userId)
            .order('created_at', { ascending: false })
            .limit(SHOWN);
        if (this.stopped) return;
        if (error) {
            if (!notThereYet(error)) console.warn('Garden Cells: could not load notifications', error.message);
            return;
        }
        this.available = true;
        this.list = ((data ?? []) as NotificationRow[]).map(fromRow);
        this.changed();
    }

    /** Mark these read, here at once and then in the table. */
    async markRead(ids: string[]) {
        const unread = new Set(this.list.filter(n => !n.readAt && ids.includes(n.id)).map(n => n.id));
        if (unread.size === 0) return;
        const now = new Date().toISOString();
        this.list = this.list.map(n => (unread.has(n.id) ? { ...n, readAt: now } : n));
        this.changed();
        const { error } = await this.client
            .from('notifications')
            .update({ read_at: now })
            .eq('user_id', this.userId)
            .in('id', [...unread]);
        if (error) console.warn('Garden Cells: could not mark notifications read', error.message);
    }

    markAllRead() {
        return this.markRead(this.list.filter(n => !n.readAt).map(n => n.id));
    }
}

/** The list: who, what and when, newest first. Tapping one opens its cell. */
export class NotificationsModal extends Modal {
    private unwatch: (() => void) | null = null;

    constructor(
        private readonly center: NotificationCenter,
        private readonly person: (id: string) => Person | undefined,
        private readonly openTarget: (target: CellTarget) => void,
    ) {
        super();
    }

    onOpen() {
        this.modalEl.addClass('share-modal', 'garden-notifications-modal');
        this.unwatch = this.center.watch(() => this.render());
        this.render();
    }

    close() {
        this.unwatch?.();
        this.unwatch = null;
        super.close();
    }

    private render() {
        const { contentEl } = this;
        contentEl.empty();
        const head = contentEl.createDiv('garden-notifications-head');
        head.createEl('h2', { text: 'Notifications' });
        if (this.center.unread > 0) {
            head.createEl('button', { cls: 'garden-notifications-read', text: 'Mark all read', attr: { type: 'button' } })
                .addEventListener('click', () => void this.center.markAllRead());
        }
        if (this.center.list.length === 0) {
            contentEl.createEl('p', { cls: 'setting-item-description', text: 'Nothing yet. When someone assigns you a cell, it shows up here.' });
            return;
        }
        const list = contentEl.createDiv({ cls: 'garden-notifications', attr: { role: 'list' } });
        for (const n of this.center.list) {
            const row = list.createEl('button', { cls: 'garden-notification', attr: { type: 'button', role: 'listitem' } });
            row.toggleClass('is-unread', !n.readAt);
            const actor = n.actorId ? this.person(n.actorId) : undefined;
            row.appendChild(avatarEl(actor?.avatar ?? NOBODY_AVATAR, 28, 'garden-notification-avatar'));
            const text = row.createDiv('garden-notification-text');
            text.createDiv({ cls: 'garden-notification-title', text: n.title });
            if (n.body) text.createDiv({ cls: 'garden-notification-body', text: n.body });
            row.createDiv({ cls: 'garden-notification-time', text: timeAgo(new Date(n.createdAt)) });
            if (!n.readAt) row.setAttribute('aria-label', `Unread. ${n.title}. ${n.body}`);
            row.addEventListener('click', () => {
                void this.center.markRead([n.id]);
                this.close();
                this.openTarget(n.target);
            });
        }
    }
}
