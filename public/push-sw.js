/*
 * cells.garden: Web Push in the service worker. The Workbox worker that
 * precaches the app loads this file (importScripts in vite.config.ts); it only
 * adds the two events below and leaves the precache and updates alone.
 *
 * A push is JSON from the notify function (supabase/functions/notify):
 * { title, body, url, tag, badge }. Every push shows a notification, whatever
 * it holds: iOS takes the subscription away from a web app that receives
 * pushes without showing them. Tapping one opens its cell, in the app already
 * open when there is one.
 */

const OPEN_MESSAGE = 'cells-garden:open';

/** A same-origin address inside the app, or the app's start. Anything else in a push is ignored. */
function appUrl(value) {
    try {
        const url = new URL(typeof value === 'string' && value ? value : './', self.registration.scope);
        if (url.origin === self.location.origin) return url.href;
    } catch {
        // Not an address: the start below.
    }
    return self.registration.scope;
}

self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch {
        data = { body: event.data ? event.data.text() : '' };
    }
    if (!data || typeof data !== 'object') data = {};

    const title = typeof data.title === 'string' && data.title ? data.title.slice(0, 120) : 'cells.garden';
    const options = {
        body: typeof data.body === 'string' ? data.body.slice(0, 300) : '',
        icon: 'icon-192.png',
        badge: 'badge-96.png',
        data: { url: appUrl(data.url) },
    };
    // One notification per cell: a second one about it replaces the first.
    if (typeof data.tag === 'string' && data.tag) options.tag = data.tag.slice(0, 100);

    const shown = self.registration.showNotification(title, options);
    const badge = Number.isInteger(data.badge) && data.badge >= 0 && self.navigator.setAppBadge
        ? (data.badge > 0 ? self.navigator.setAppBadge(data.badge) : self.navigator.clearAppBadge()).catch(() => {})
        : Promise.resolve();
    event.waitUntil(Promise.all([shown, badge]));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = appUrl(event.notification.data && event.notification.data.url);
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const open = windows.filter((client) => new URL(client.url).origin === self.location.origin);
        const client = open.find((c) => c.focused) || open.find((c) => c.visibilityState === 'visible') || open[0];
        if (client) {
            // The app on screen opens the cell itself: no reload, nothing lost.
            try {
                await client.focus();
            } catch {
                // Some systems do not let a worker focus a window; the message still arrives.
            }
            client.postMessage({ type: OPEN_MESSAGE, url });
            return;
        }
        await self.clients.openWindow(url);
    })());
});
