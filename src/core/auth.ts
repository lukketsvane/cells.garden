/**
 * Sign-in UI (M1): a small pill in the corner and a sign-in modal.
 * Only mounted when the build has Supabase config.
 *
 * Email and password is the way in, because it costs no email at all. The
 * free Supabase tier sends very few messages before it starts refusing, so a
 * flow that needs a message per sign-in runs out; a password does not.
 * It needs "Confirm email" turned OFF in Supabase → Authentication → Email,
 * otherwise a sign-up still waits for a message. See supabase/README.md.
 *
 * The emailed link is kept as the second way in, for anyone who would rather
 * not have a password, and as the way back when one is forgotten. It finishes
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
import { openMenu, type MenuItem } from './menu';
import { Modal, Setting } from './ui';

export interface AuthOptions {
    /** Where the magic link should land. Defaults to the current page. */
    redirectTo?: string;
    /** One extra line under the heading, e.g. why sign-in is being asked for. */
    note?: string;
}

/** Checked when a password is chosen, never when one is typed to sign in. */
const MIN_PASSWORD_LENGTH = 8;

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

/** What the owner has to fix, said once where the owner will see it. */
const CONFIRMATION_IS_ON =
    'Garden Cells: this sign-up tried to send a confirmation email. The app sends none of its own, ' +
    'so "Confirm email" is still on in Supabase (Authentication, Email). Turn it off, or set up custom SMTP.';

/** What a visitor sees when that happens. They cannot act on the cause. */
const SIGN_UP_UNAVAILABLE = 'Sign-up is not working just now. Try the emailed link instead.';

/**
 * Sign-up failures worth explaining. A rate limit here always means the project
 * is still trying to send a confirmation email: the app itself sends none, and
 * the built-in mail service allows only a handful an hour.
 */
function signUpProblem(message: string): string {
    if (/already registered|already exists/i.test(message)) return 'That address already has an account. Sign in instead.';
    if (/rate limit|too many requests/i.test(message)) {
        console.error(CONFIRMATION_IS_ON);
        return SIGN_UP_UNAVAILABLE;
    }
    return `Could not create the account: ${message}`;
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
                setTimeout(() => text.inputEl.focus(), 50);
            });
    }

    /** The default way in: email and password, no message sent either way. */
    private showPasswordStep() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Sign in' });
        if (this.options.note) contentEl.createEl('p', { cls: 'auth-note', text: this.options.note });
        contentEl.createEl('p', { text: 'Syncs to every device you sign in on. New here? Pick a password and press Create account.' });

        let password = '';
        const status = contentEl.createDiv('auth-status');

        const submit = async (mode: 'in' | 'up') => {
            const email = validEmail(this.email, status);
            if (!email) return;
            if (!password) {
                status.setText('Type a password too.');
                return;
            }
            if (mode === 'up' && password.length < MIN_PASSWORD_LENGTH) {
                status.setText(`A new password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
                return;
            }

            if (mode === 'in') {
                status.setText('Signing in…');
                const { error } = await this.client.auth.signInWithPassword({ email, password });
                if (!error) {
                    this.close();
                    return;
                }
                // Supabase deliberately gives one answer for a wrong password and
                // for an address it has never seen, so the message covers both.
                status.setText(/invalid login credentials/i.test(error.message)
                    ? 'Wrong password, or no account yet. Create account makes one.'
                    : `Could not sign in: ${error.message}`);
                return;
            }

            status.setText('Creating your account…');
            const { data, error } = await this.client.auth.signUp({ email, password });
            if (error) {
                status.setText(signUpProblem(error.message));
                return;
            }
            if (data.session) {
                this.close();
                return;
            }
            // Supabase hides an address that already has an account by handing
            // back a user with no identities.
            if (data.user?.identities?.length === 0) {
                status.setText('That address already has an account. Sign in instead.');
                return;
            }
            // No session and a real user means the project still has email
            // confirmation switched on. The account exists either way, so try
            // the password straight away; it works whenever confirmation was
            // the only thing standing in the way.
            const retry = await this.client.auth.signInWithPassword({ email, password });
            if (!retry.error) {
                this.close();
                return;
            }
            console.error(CONFIRMATION_IS_ON);
            status.setText(SIGN_UP_UNAVAILABLE);
        };

        this.emailField(() => void submit('in'));
        new Setting(contentEl)
            .setName('Password')
            .addText((text) => {
                text.setPlaceholder('••••••••');
                text.inputEl.type = 'password';
                text.inputEl.autocomplete = 'current-password';
                text.onChange((v) => { password = v; });
                onEnter(text.inputEl, () => void submit('in'));
            });

        new Setting(contentEl)
            .addButton((btn) => btn.setButtonText('Create account').onClick(() => void submit('up')))
            .addButton((btn) => btn.setButtonText('Sign in').setCta().onClick(() => void submit('in')));

        const alt = contentEl.createDiv('auth-alt');
        alt.createEl('button', { type: 'button', cls: 'auth-link', text: 'Email me a link instead' })
            .addEventListener('click', () => this.showLinkStep());
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
                options: { emailRedirectTo: redirectTo },
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
                setTimeout(() => text.inputEl.focus(), 50);
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
            this.showMenu();
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
