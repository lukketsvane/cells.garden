/** Small web pages around the garden. Ordinary links also work on reload and offline. */
import { GardenApp } from '../core/app';
import { AuthPill } from '../core/auth';
import { avatarEl } from '../core/avatar';
import { openMenu } from '../core/menu';
import { gardenPath } from '../core/routes';
import { applyScene } from '../core/scene';
import { SettingsModal } from '../core/settings';
import { getProfile, listFriends } from '../core/sharing';
import { LOCAL_KEY, LocalStore } from '../core/store';
import { createSupabase } from '../core/supabase';
import { installTouchAdapter } from '../core/touch';
import { tutorialGarden } from '../core/tutorial';
import { BoardToggleButton } from '../core/transfer';
import { forgetDevice } from '../core/web-push';

function link(host: HTMLElement, text: string, href: string) {
    return host.createEl('a', { text, attr: { href } });
}

function page(host: HTMLElement, title: string): HTMLElement {
    document.title = `${title} · cells.garden`;
    host.addClass('site-page');
    const content = host.createEl('main', { cls: 'site-content' });
    const nav = content.createEl('nav', { attr: { 'aria-label': 'Main navigation' } });
    link(nav, 'My garden', '/');
    link(nav, 'Tutorial', '/tutorial');
    link(nav, 'About', '/about/');
    content.createEl('h1', { text: title });
    return content;
}

export function missingPage(host: HTMLElement) {
    const content = page(host, 'This page is not here');
    content.createEl('p', { text: 'Check the address, or return to your garden. If this was an invitation, ask for a new link.' });
    link(content, 'Open my garden →', '/').addClass('site-action');
}

export async function tutorialPage(host: HTMLElement) {
    document.title = 'Tutorial garden · cells.garden';
    applyScene();
    const store = new LocalStore(`${LOCAL_KEY}/tutorial`, tutorialGarden);
    const app = new GardenApp(store);
    await app.mount(host);
    window.garden = app;
    installTouchAdapter(host);
    new BoardToggleButton(host);
    // The tutorial starts with its instructions visible, without changing the saved preference.
    document.documentElement.dataset.board = 'shown';
    const toggle = host.querySelector('.garden-board-toggle');
    toggle?.setAttribute('aria-label', 'Hide the board');
    toggle?.setAttribute('title', 'Hide the board');
    toggle?.classList.add('is-active');
    const menu = host.createEl('button', { cls: 'auth-pill', text: 'Tutorial garden', attr: { type: 'button' } });
    menu.addEventListener('click', () => openMenu([
        { label: 'Practice here. Changes stay on this device.', heading: true },
        { label: 'My garden', onClick: () => location.assign('/') },
        { label: 'About cells.garden', onClick: () => location.assign('/about/') },
    ], menu));
}

export function profilePage(host: HTMLElement, id: string) {
    const content = page(host, 'Gardener');
    const body = content.createDiv({ attr: { 'aria-live': 'polite' } });
    const client = createSupabase();
    if (!client) {
        body.createEl('p', { text: 'Profiles need an account. This build works locally.' });
        return;
    }
    const pill = new AuthPill(client, host);
    let generation = 0;
    client.auth.onAuthStateChange((_event, session) => {
        pill.setSession(session);
        const revision = ++generation;
        body.empty();
        pill.beforeSignOut = session ? () => forgetDevice(client, session.user.id) : null;
        if (!session) {
            body.createEl('p', { text: 'Sign in to see your profile and the people you share a garden or plant with.' });
            body.createEl('button', { text: 'Sign in to view profile', attr: { type: 'button' } })
                .addEventListener('click', () => pill.signIn('Sign in to view this profile.'));
            return;
        }
        body.createEl('p', { text: 'Loading profile…' });
        // Database calls must run outside the auth callback.
        window.setTimeout(() => {
            void (async () => {
                const own = session.user.id === id;
                const person = own ? await getProfile(client, id) : (await listFriends(client)).find(f => f.userId === id);
                if (revision !== generation) return;
                body.empty();
                if (!person) {
                    body.createEl('p', { text: 'This profile is unavailable. Profiles are visible to the people who share a garden or plant with them.' });
                    return;
                }
                body.appendChild(avatarEl(person.avatar, 64, 'profile-avatar'));
                body.createEl('h2', { text: person.name || 'Gardener' });
                if (own) {
                    body.createEl('p', { text: 'This is how you appear to the people you grow with.' });
                    body.createEl('button', { text: 'Edit profile', attr: { type: 'button' } }).addEventListener('click', () => {
                        new SettingsModal({
                            client, userId: id,
                            onName: (name) => body.querySelector('h2')?.setText(name || 'Gardener'),
                            onAvatar: (avatar) => { body.querySelector('.profile-avatar')?.remove(); body.prepend(avatarEl(avatar, 64, 'profile-avatar')); },
                        }).open();
                    });
                } else if ('gardens' in person) {
                    body.createEl('p', { text: `You share ${person.gardens} garden(s) and ${person.plants} plant(s).` });
                }
                link(body, 'Back to my garden →', '/').addClass('site-action');
            })().catch(() => {
                if (revision === generation) body.setText('Could not load this profile. Please try again.');
            });
        }, 0);
    });
}

/** Links for builds without the account menu. */
export function localNavigation(host: HTMLElement) {
    const nav = host.createEl('nav', { cls: 'local-navigation', attr: { 'aria-label': 'Garden navigation' } });
    link(nav, 'Tutorial', '/tutorial');
    link(nav, 'About', '/about/');
    if (location.pathname === '/') history.replaceState(null, '', gardenPath('local') + location.search + location.hash);
}
