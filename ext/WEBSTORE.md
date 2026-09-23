# Chrome Web Store submission

Canonical submission notes for the cells.garden Chrome extension.

- Item ID: `cighiofbnmdgppphnofkgfoneldalbbf`
- Publisher: `iverfinne`
- Current replacement release: `0.1.6`
- Privacy policy: `https://cells.garden/privacy.html`
- Homepage: `https://cells.garden`
- Support: `https://github.com/lukketsvane/cells.garden/issues`

## Review replacement

The original 0.1.0 submission entered review on 18 September 2026. When 0.1.6 is ready:

1. Open the item in the Chrome Web Store Developer Dashboard.
2. On **Store listing**, open the three-dot menu and choose **Cancel review**.
3. On **Package**, upload the 0.1.6 ZIP. `manifest.json` must be at the ZIP root.
4. Re-check Store listing and Privacy practices against the copy below.
5. Submit the 0.1.6 revision for review.

Do not submit 0.1.0 again.

## Single purpose

> Turn tasks into a pixel-art garden that is available on Chrome's New Tab page, in the Side Panel and in the toolbar popup, with optional account sync and sharing across the user's cells.garden devices.

## Short description

> Your tasks grow into a pixel-art garden: a board on every new tab, in the side panel and the toolbar, synced across devices.

## Store listing description

cells.garden turns a project board into a living pixel-art garden.

Each plant is a project. Its cells become stems, flowers, roots and minerals as the project grows. The same garden is available in three Chrome surfaces:

- New Tab: the full garden and project board.
- Side Panel: keep the garden open beside the page you are working on.
- Toolbar popup: focus on one plant at a time and jump to the full garden or side panel.

An account is optional. Without signing in, the garden stays on the device. Sign in only if you want the same garden on other devices or want to share gardens and plants with other people.

cells.garden has no ads, analytics or behavioural tracking. It does not read the pages you visit or your browsing history.

## Permissions justification

### sidePanel

> Required to provide the user-requested cells.garden Side Panel view.

### storage

> Used only by the extension service worker to temporarily store a short-lived OAuth intent nonce and the OAuth return result while optional Google sign-in moves between the extension and a browser tab. Garden content itself is not stored through this permission.

There are no host permissions and no content scripts.

## Remote code

Select:

> No, I am not using remote code.

All executable extension code is packaged in the Manifest V3 extension. The extension makes HTTPS/WSS requests to Supabase for optional authentication and sync, but does not download or execute remote JavaScript.

## Data disclosures

The extension handles user data because it has optional login and sync.

Disclose the categories that correspond to:

- **Personally identifiable information**: email address and, for Google sign-in, name/profile picture.
- **Authentication information**: Supabase session/authentication information required to keep the user signed in.
- **User-generated content**: garden names, plant/project names, task/cell text, layout and sharing metadata.

The extension does **not** collect browsing history, website content from pages the user visits, location, health information, financial/payment information or advertising identifiers.

Data is used only to provide, secure, sync and share the cells.garden features requested by the user. It is not sold or used for personalised advertising.

## Limited Use certification

The extension's use of user data is limited to its disclosed single purpose and related operational/security needs. User data is not sold or transferred for advertising. Humans do not read private user data except with the user's specific consent for support, when necessary for security, or when legally required.

## Reviewer notes

- Manifest V3.
- Chrome 116+.
- New Tab override, Side Panel and toolbar popup all run the same bundled core.
- No host permissions.
- No content scripts.
- No browsing-history access.
- No remote code.
- Optional account sync uses Supabase over HTTPS/WSS.
- Google sign-in uses a nonce-gated cells.garden web return bridge and `externally_connectable` restricted to `https://cells.garden/*`.
- The extension works locally without an account.
