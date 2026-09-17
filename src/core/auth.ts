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
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { Modal, Setting } from './ui';

export interface AuthOptions {
    /** Where the magic link should land. Defaults to the current page. */
    redirectTo?: string;
}

/** Checked when a password is chosen, never when one is typed to sign in. */
const MIN_PASSWORD_LENGTH = 8;

function looksLikeEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Sign-up failures worth explaining. A rate limit here always means the project
 * is still trying to send a confirmation email: the app itself sends none, and
 * the free tier allows only a handful an hour.
 */
function signUpProblem(message: string): string {
    if (/already registered|already exists/i.test(message)) return 'That address already has an account. Sign in instead.';
    if (/rate limit|too many requests/i.test(message)) return 'The project is still sending confirmation emails. Turn "Confirm email" off in Supabase.';
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

    /** The default way in: email and password, no message sent either way. */
    private showPasswordStep() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Sign in' });
        contentEl.createEl('p', { text: 'Syncs to every device you sign in on. New here? Pick a password and press Create account.' });

        let password = '';
        const status = contentEl.createDiv('auth-status');

        const submit = async (mode: 'in' | 'up') => {
            const email = this.email.trim();
            if (!looksLikeEmail(email)) {
                status.setText('That does not look like an email address.');
                return;
            }
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
            // confirmation switched on. Nothing is sent here, so try the
            // password straight away; only a project misconfiguration lands
            // below, and it is the owner's to fix, not the visitor's.
            const retry = await this.client.auth.signInWithPassword({ email, password });
            if (!retry.error) {
                this.close();
                return;
            }
            status.setText('This project still requires email confirmation. Turn it off in Supabase to sign up here.');
        };

        new Setting(contentEl)
            .setName('Email')
            .addText((text) => {
                text.setPlaceholder('you@example.com');
                text.setValue(this.email);
                text.inputEl.type = 'email';
                text.inputEl.autocomplete = 'email';
                text.onChange((v) => { this.email = v; });
                text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        void submit('in');
                    }
                });
                setTimeout(() => text.inputEl.focus(), 50);
            });

        new Setting(contentEl)
            .setName('Password')
            .addText((text) => {
                text.setPlaceholder('••••••••');
                text.inputEl.type = 'password';
                text.inputEl.autocomplete = 'current-password';
                text.onChange((v) => { password = v; });
                text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        void submit('in');
                    }
                });
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
            const value = this.email.trim();
            if (!looksLikeEmail(value)) {
                status.setText('That does not look like an email address.');
                return;
            }
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

        new Setting(contentEl)
            .setName('Email')
            .addText((text) => {
                text.setPlaceholder('you@example.com');
                text.setValue(this.email);
                text.inputEl.type = 'email';
                text.inputEl.autocomplete = 'email';
                text.onChange((v) => { this.email = v; });
                text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        void submit();
                    }
                });
                setTimeout(() => text.inputEl.focus(), 50);
            });

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
                text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        void verify();
                    }
                });
                setTimeout(() => text.inputEl.focus(), 50);
            });

        new Setting(contentEl)
            .addButton((btn) => btn.setButtonText('Close').onClick(() => this.close()))
            .addButton((btn) => btn.setButtonText('Verify code').setCta().onClick(() => void verify()));
    }

    onClose() {
        this.contentEl.empty();
    }
}

export class AuthPill {
    el: HTMLElement;
    private session: Session | null = null;

    constructor(private readonly client: SupabaseClient, host: HTMLElement, private readonly options: AuthOptions = {}) {
        this.el = host.createEl('button', { cls: 'auth-pill', attr: { type: 'button', title: 'Sign in to sync your garden' } });
        this.el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.session) this.showMenu();
            else new SignInModal(this.client, this.options).open();
        });
        this.render();
    }

    setSession(session: Session | null) {
        this.session = session;
        this.render();
    }

    setSyncState(state: 'local' | 'syncing' | 'synced' | 'error') {
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
            const initial = (email[0] ?? '•').toUpperCase();
            this.el.createSpan({ cls: 'auth-pill-avatar', text: initial });
            this.el.createSpan({ cls: 'auth-pill-label', text: email });
            this.el.addClass('is-signed-in');
        } else {
            this.el.createSpan({ cls: 'auth-pill-label', text: 'Sign in' });
            this.el.removeClass('is-signed-in');
        }
    }

    private showMenu() {
        document.querySelector('.garden-context-menu')?.remove();
        const menu = document.createElement('div');
        menu.className = 'garden-context-menu';
        menu.style.cssText = 'position: fixed; z-index: 10000; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 4px 0; min-width: 160px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);';
        const menuStyle = 'display: block; width: 100%; padding: 6px 16px; text-align: left; background: none; border: none; cursor: pointer; font-size: 14px; color: var(--text-normal);';

        const who = document.createElement('div');
        who.textContent = this.session?.user.email ?? '';
        who.style.cssText = `${menuStyle} font-size: 11px; color: var(--text-faint); pointer-events: none; cursor: default;`;
        menu.appendChild(who);

        const out = document.createElement('button');
        out.textContent = 'Sign out';
        out.style.cssText = menuStyle;
        out.onmouseenter = () => { out.style.background = 'var(--background-modifier-hover)'; };
        out.onmouseleave = () => { out.style.background = 'none'; };
        out.onclick = async () => {
            menu.remove();
            await this.client.auth.signOut();
        };
        menu.appendChild(out);

        document.body.appendChild(menu);
        const rect = this.el.getBoundingClientRect();
        menu.style.left = `${rect.left}px`;
        menu.style.top = `${rect.bottom + 4}px`;

        const closeMenu = (ev: MouseEvent) => {
            if (!menu.contains(ev.target as Node)) {
                menu.remove();
                window.removeEventListener('mousedown', closeMenu, true);
            }
        };
        setTimeout(() => window.addEventListener('mousedown', closeMenu, true), 0);
    }
}
