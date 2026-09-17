/**
 * Sign-in UI (M1): a small pill in the corner and a magic-link modal.
 * Only mounted when the build has Supabase config.
 *
 * Two ways to finish signing in, both from the same email:
 *  1. Click the magic link. It lands on `redirectTo` (the web app by default,
 *     the extension's own page inside Chrome) and the session is picked up
 *     from the URL.
 *  2. Type the 6-digit code. Works anywhere, no redirect needed. Needs
 *     `{{ .Token }}` in the Supabase "Magic Link" email template.
 */
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { Modal, Setting } from './ui';

export interface AuthOptions {
    /** Where the magic link should land. Defaults to the current page. */
    redirectTo?: string;
}

class SignInModal extends Modal {
    constructor(private readonly client: SupabaseClient, private readonly options: AuthOptions) {
        super();
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: '🔑 Sign in' });
        contentEl.createEl('p', { text: 'Enter your email and we send you a link. No password. Your garden syncs to every device you sign in on.' });

        let email = '';
        const status = contentEl.createDiv('auth-status');

        const submit = async () => {
            const value = email.trim();
            if (!value || !value.includes('@')) {
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
                text.inputEl.type = 'email';
                text.inputEl.autocomplete = 'email';
                text.onChange((v) => { email = v; });
                text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        void submit();
                    }
                });
                setTimeout(() => text.inputEl.focus(), 50);
            });

        new Setting(contentEl)
            .addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()))
            .addButton((btn) => btn.setButtonText('Send link').setCta().onClick(() => void submit()));
    }

    private showCodeStep(email: string) {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: '📬 Check your email' });
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
