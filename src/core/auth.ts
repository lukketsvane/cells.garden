/**
 * Sign-in UI (M1): a small pill in the corner and a magic-link modal.
 * Only mounted when the build has Supabase config.
 */
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { Modal, Setting } from './ui';

class SignInModal extends Modal {
    constructor(private readonly client: SupabaseClient) {
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
            const { error } = await this.client.auth.signInWithOtp({
                email: value,
                options: { emailRedirectTo: window.location.origin + window.location.pathname },
            });
            if (error) {
                status.setText(`Could not send the link: ${error.message}`);
                return;
            }
            contentEl.empty();
            contentEl.createEl('h2', { text: '📬 Check your email' });
            contentEl.createEl('p', { text: `We sent a sign-in link to ${value}. Open it on this device and the garden will sync.` });
            new Setting(contentEl).addButton((btn) => btn.setButtonText('Close').setCta().onClick(() => this.close()));
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

    onClose() {
        this.contentEl.empty();
    }
}

export class AuthPill {
    el: HTMLElement;
    private session: Session | null = null;

    constructor(private readonly client: SupabaseClient, host: HTMLElement) {
        this.el = host.createEl('button', { cls: 'auth-pill', attr: { type: 'button', title: 'Sign in to sync your garden' } });
        this.el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.session) this.showMenu();
            else new SignInModal(this.client).open();
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
