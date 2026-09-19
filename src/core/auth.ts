/**
 * Sign-in UI (M1): a small pill in the corner and a sign-in modal.
 * Only mounted when the build has Supabase config.
 *
 * Existing password accounts can sign in with email + password. New accounts
 * are created only through Google or the emailed link/OTP, so the person must
 * prove control of the identity before the account can hold garden data.
 *
 * The emailed link is also the passwordless way back in. It finishes
 * either by:
 *  1. Clicking the link. It lands on `redirectTo` (the web app by default,
 *     the extension's own page inside Chrome) and the session is picked up
 *     from the URL.
 *  2. Typing the 6-digit code. Works anywhere, no redirect needed. Needs
 *     `{{ .Token }}` in the Supabase "Magic Link" email template.
 */
import type { SyncState } from './app';
import { avatarEl } from './avatar';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { ICONS, setIcon } from './icons';
import { openMenu, type MenuItem } from './menu';
import { Modal, Setting } from './ui';

export interface AuthOptions {
    /** Where email links land. Defaults to the current page. */
    redirectTo?: string;
    /** Optional Google-specific return URL. Falls back to redirectTo. */
    oauthRedirectTo?: string;
    /** How to open Google's sign-in page. Defaults to going there in this page. */
    openOAuth?: (url: string) => void;
    /** Handed the client once it exists, for hosts that finish sign-in themselves (Obsidian). */
    onClient?: (client: SupabaseClient) => void;
    /** One extra line under the heading, e.g. why sign-in is being asked for. */
    note?: string;
}

/** The typed address trimmed, or null after saying on `status` that it is not one. */
function validEmail(value: string, status: HTMLElement): string | null {
    const email = value.trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return email;
    status.setText('That does not look like an email address.');
    return null;
}

/** Enter in a field does what the step's main button does. */
function onEnter(input: HTMLInputElement, run: () => void) {
    input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            run();
        }
    });
}

class SignInModal extends Modal {
    /** Shared by every step, so switching between them never retypes it. */
    private email = '';

    constructor(private readonly client: SupabaseClient, private readonly options: AuthOptions) {
        super();
    }

    onOpen() {
        this.showPasswordStep();
    }

    /** The Email field of both ways in; Enter runs `submit`. */
    private emailField(submit: () => void) {
        new Setting(this.contentEl)
            .setName('Email')
            .addText((text) => {
                text.setPlaceholder('you@example.com');
                text.setValue(this.email);
                text.inputEl.type = 'email';
                text.inputEl.autocomplete = 'email';
                text.onChange((v) => { this.email = v; });
                onEnter(text.inputEl, submit);
                window.setTimeout(() => text.inputEl.focus(), 50);
            });
    }

    /** The default way in: email and password, no message sent either way. */
    private showPasswordStep() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Sign in' });
        if (this.options.note) contentEl.createEl('p', { cls: 'auth-note', text: this.options.note });
        contentEl.createEl('p', { text: 'Syncs to every device you sign in on.' });

        const status = contentEl.createDiv('auth-status');
        // One button for signing in and signing up: Google says who it is, the account follows.
        const google = contentEl.createEl('button', { type: 'button', cls: 'auth-google' });
        setIcon(google.createSpan('auth-google-mark'), ICONS.google);
        google.createSpan({ text: 'Continue with Google' });
        google.addEventListener('click', () => void this.continueWithGoogle(status));
        contentEl.createDiv({
            cls: 'auth-or',
            text: 'or sign in with an existing email + password. New account? Use Google or the emailed link so your address is verified.',
        });
        contentEl.appendChild(status);

        let password = '';

        const submit = async () => {
            const email = validEmail(this.email, status);
            if (!email) return;
            if (!password) {
                status.setText('Type a password too.');
                return;
            }
            status.setText('Signing in…');
            const { error } = await this.client.auth.signInWithPassword({ email, password });
            if (!error) {
                this.close();
                return;
            }
            status.setText(/invalid login credentials/i.test(error.message)
                ? 'Wrong password, or this account has no password. Use Google or the emailed link.'
                : `Could not sign in: ${error.message}`);
        };

        this.emailField(() => void submit());
        new Setting(contentEl)
            .setName('Password')
            .addText((text) => {
                text.setPlaceholder('••••••••');
                text.inputEl.type = 'password';
                text.inputEl.autocomplete = 'current-password';
                text.onChange((v) => { password = v; });
                onEnter(text.inputEl, () => void submit());
            });

        new Setting(contentEl)
            .addButton((btn) => btn.setButtonText('Sign in').setCta().onClick(() => void submit()));

        const alt = contentEl.createDiv('auth-alt');
        alt.createEl('button', { type: 'button', cls: 'auth-link', text: 'Email me a link instead' })
            .addEventListener('click', () => this.showLinkStep());
    }

    private async continueWithGoogle(status: HTMLElement) {
        status.setText('Opening Google…');
        const redirectTo = this.options.oauthRedirectTo
            ?? this.options.redirectTo
            ?? (window.location.origin + window.location.pathname);
        const { data, error } = await this.client.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo, skipBrowserRedirect: true },
        });
        if (error || !data.url) {
            status.setText(`Could not reach Google: ${error?.message ?? 'no address to go to'}`);
            return;
        }
        (this.options.openOAuth ?? ((url: string) => window.location.assign(url)))(data.url);
    }

    /** The second way in, for anyone without a password, or who lost theirs. */
    private showLinkStep() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Sign in by email' });
        contentEl.createEl('p', { text: 'We send a link and a code. No password needed.' });

        const status = contentEl.createDiv('auth-status');

        const submit = async () => {
            const value = validEmail(this.email, status);
            if (!value) return;
            status.setText('Sending…');
            const redirectTo = this.options.redirectTo ?? (window.location.origin + window.location.pathname);
            const { error } = await this.client.auth.signInWithOtp({
                email: value,
                options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
            });
            if (error) {
                status.setText(`Could not send the link: ${error.message}`);
                return;
            }
            this.showCodeStep(value);
        };

        this.emailField(() => void submit());
        new Setting(contentEl)
            .addButton((btn) => btn.setButtonText('Back').onClick(() => this.showPasswordStep()))
            .addButton((btn) => btn.setButtonText('Send link').setCta().onClick(() => void submit()));
    }

    private showCodeStep(email: string) {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Check your email' });
        contentEl.createEl('p', { text: `We sent a sign-in link to ${email}. Open it on this device, or type the code from the email below.` });

        let code = '';
        const status = contentEl.createDiv('auth-status');

        const verify = async () => {
            const token = code.replace(/\s+/g, '');
            if (!/^\d{6,10}$/.test(token)) {
                status.setText('The code is the 6 digits from the email.');
                return;
            }
            status.setText('Checking…');
            const { error } = await this.client.auth.verifyOtp({ email, token, type: 'email' });
            if (error) {
                status.setText(`That code did not work: ${error.message}`);
                return;
            }
            this.close();
        };

        new Setting(contentEl)
            .setName('Code')
            .addText((text) => {
                text.setPlaceholder('123456');
                text.inputEl.inputMode = 'numeric';
                text.inputEl.autocomplete = 'one-time-code';
                text.onChange((v) => { code = v; });
                onEnter(text.inputEl, () => void verify());
                window.setTimeout(() => text.inputEl.focus(), 50);
            });

        new Setting(contentEl)
            .addButton((btn) => btn.setButtonText('Close').onClick(() => this.close()))
            .addButton((btn) => btn.setButtonText('Verify code').setCta().onClick(() => void verify()));
    }
}

export class AuthPill {
    el: HTMLElement;
    private session: Session | null = null;
    private label: string | null = null;
    private buildMenu: (() => MenuItem[] | Promise<MenuItem[]>) | null = null;

    constructor(private readonly client: SupabaseClient, host: HTMLElement, private readonly options: AuthOptions = {}) {
        this.el = host.createEl('button', { cls: 'auth-pill', attr: { type: 'button', title: 'Sign in to sync your garden' } });
        this.el.addEventListener('click', (e) => {
            e.stopPropagation();
            void this.showMenu();
        });
        this.render();
    }

    setSession(session: Session | null) {
        this.session = session;
        this.render();
    }

    /** Open the sign-in modal, with an optional line explaining why. */
    signIn(note?: string) {
        new SignInModal(this.client, { ...this.options, note }).open();
    }

    /** Rows shown between the email and Sign out. Built each time the menu opens. */
    setMenu(build: () => MenuItem[] | Promise<MenuItem[]>) {
        this.buildMenu = build;
    }

    private avatar: string | null = null;

    /** The seed of the signed-in user's picture, once the profile is loaded. */
    setAvatar(seed: string | null) {
        this.avatar = seed;
        this.render();
    }

    /** Shown instead of the email, e.g. the name of a shared garden. null: the email. */
    setLabel(label: string | null) {
        this.label = label;
        this.render();
    }

    setSyncState(state: SyncState) {
        this.el.dataset.sync = state;
        this.el.title = {
            local: 'Sign in to sync your garden',
            syncing: 'Syncing…',
            synced: 'Synced',
            error: 'Sync failed, changes are kept on this device',
        }[state];
    }

    private render() {
        this.el.empty();
        if (this.session) {
            const email = this.session.user.email ?? '';
            this.el.appendChild(avatarEl(this.avatar ?? this.session.user.id, 18, 'auth-pill-avatar'));
            this.el.createSpan({ cls: 'auth-pill-label', text: this.label ?? email });
            this.el.toggleClass('is-shared', this.label !== null);
        } else {
            this.el.createSpan({ cls: 'auth-pill-label', text: 'Sign in' });
        }
    }

    private async showMenu() {
        let items: MenuItem[] = [];
        try {
            items = this.buildMenu ? await this.buildMenu() : [];
        } catch (e) {
            console.error('Garden Cells: could not build the menu', e);
        }
        if (!this.session) {
            openMenu([{ label: 'Sign in', onClick: () => this.signIn() }, ...items], this.el);
            return;
        }
        const menu = openMenu([...items, { label: 'Sign out', onClick: () => void this.client.auth.signOut() }], this.el);
        const who = menu.createDiv({ cls: 'garden-menu-heading', text: this.session.user.email ?? '' });
        menu.prepend(who);
    }
}
