# Supabase (M1)

Free tier. Auth by email and password (an emailed link is the fallback), one row per garden in `gardens.data` (jsonb), RLS `user_id = auth.uid()`.

## Set up

1. Create a project at supabase.com.
2. SQL editor → run every file in `migrations/` in order. Each one is re-runnable.
3. Authentication → URL configuration: **Site URL** `https://cells.garden/`; **Redirect URLs** `https://cells.garden/**`, `https://dev.cells.garden/**` the Chrome Web Store build's `chrome-extension://cighiofbnmdgppphnofkgfoneldalbbf/newtab.html`, Obsidian's `obsidian://cells-garden`, and `http://localhost:5173/**` and `5174` for development. **Google** is on under Sign In / Providers, with the OAuth client of the Google Cloud project `cells-garden` (consent screen in production, basic scopes only); its secret lives only in the Supabase dashboard. Magic links land on `/` and the client picks the session out of the URL.
4. Authentication → Email: keep **"Confirm email" ON**. Do not disable it. New accounts are created only through Google or the emailed link/OTP so the person proves control of the identity before the account can hold garden data. Existing accounts that already have a password can still use password sign-in. The "Magic Link" template needs `{{ .Token }}` for the 6-digit code to work. The hosted free-tier mailer is rate-limited, so use Google for the normal no-email path or configure custom SMTP before relying on email at scale.
5. Give the web build the two public values (never the secret key):

   | Vercel env var             | Supabase → Project settings → API |
   |----------------------------|-----------------------------------|
   | `VITE_SUPABASE_URL`        | Project URL                       |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key (`sb_publishable_…`) or the legacy anon key |

   The repo's `.env` already carries both values, so Vercel and `npm run dev` pick them up with no extra configuration. `vite.config.ts` also accepts `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` without the `VITE_` prefix, and real environment variables override the file.

   For local sign-in, also add `http://localhost:5173` to the Redirect URLs.

Without these two values the app builds and runs exactly as M0: localStorage only, no sign-in button.

## Migrations

Run them in order in the SQL editor. Each one is safe to run more than once.

| File | What it does |
|------|--------------|
| `migrations/0001_init.sql` | `profiles`, `gardens`, RLS, `updated_at` trigger, realtime publication |
| `migrations/0002_gardens_unique_user.sql` | removes duplicate garden rows and adds a unique index on `gardens(user_id)` |
| `migrations/0003_garden_assets_bucket.sql` | private `garden-assets` Storage bucket plus per-user RLS, for custom cell art (the app does not use it yet) |
| `migrations/0004_harden_functions.sql` | keeps `handle_new_user` off the REST surface and pins both trigger functions to an empty `search_path` |
| `migrations/0005_shared_gardens.sql` | `gardens.rev` bumped by a trigger that also freezes `user_id`, `garden_members`, `garden_invites`, `join_garden(token)`, member policies |
| `migrations/0006_private_policy_helpers.sql` | moves the policy helpers to a `private` schema so they are not API endpoints; `(select auth.uid())` in the older owner policies |
| `migrations/0007_shared_plants.sql` | `plants` (one shared plant, server revision), `plant_members`, `plant_invites`, `join_plant(token)`, policies, realtime |
| `migrations/0008_owner_rows_visible_on_insert.sql` | lets an owner read back a garden or plant row inside the insert that creates it |
| `migrations/0009_friends.sql` | `profiles.avatar_seed`, `friends()`, plant offers to friends |
| `migrations/0010_garden_spaces.sql` | garden spaces: rows with `owner_id` instead of `user_id`; ownership is `coalesce(user_id, owner_id)` everywhere |
| `migrations/0011_avatar_drawing.sql` | `profiles.avatar_drawing` (a drawn picture, format checked by a constraint); `friends()` and `plant_offers_for_me()` send it in place of the seed |

## Shared gardens (M4)

An owner shares their one garden by link. The link is `https://cells.garden/#join=<token>`; the token is a uuid stored in `garden_invites`, one per garden. `join_garden(token)` is the only way to become a member; it refuses a bad token, caps a garden at 20 members, and is a no-op for the owner.

- Members read and update the owner's row. Only the owner inserts or deletes it, makes or turns off the link, and removes people. A member can leave.
- `user_id` cannot change and `rev` cannot be forged: the update trigger sets both.
- People who share a garden can read each other's `profiles.display_name`, nothing else.
- Checked with simulated users against the live project: outsiders and anon see nothing, direct membership inserts and ownership changes are refused, members never see invite tokens.

In the app: the pill menu lists shared gardens and offers Share garden (owner) or Leave garden (member). The chosen garden is remembered per account on each device. A garden that is no longer reachable falls back to the user's own with a notice.

Garden spaces are gardens that belong to nobody's own account: New garden space in the pill menu makes one (`owner_id` set, `user_id` null), and its owner shares, renames or deletes it like any garden. Deleting takes its members and link with it.

Saves are compare-and-swap on `rev`. When someone wrote first, the client fetches their version and merges by plant and cell id (`src/core/merge.ts`), then retries. Still lost: the same field of the same cell changed by two people at once (the later save wins), and two different reorders of the same list.

## Collaborative plants

One plant shared by link (`https://cells.garden/#plant=<token>`) into other people's own gardens. The plant keeps its cells in a `plants` row; each garden that holds it keeps a copy in its blob, marked with `sharedPlantId`, so it still works offline. Everyone who has it edits the same row: compare-and-swap on `rev`, merged by cell id, pushed to the others over realtime. Where the plant stands is each garden's own.

In the app: the share icon on a plant's card. The owner gets a link, sees who has the plant, can remove people or stop sharing. Someone who joined can leave. Leaving or stopping keeps every copy.

## Sync model

The main README's Storage and sync covers the stores. On top of that:

- On sign-in the mirror (`cells.garden/v1/user/<uid>`) wins over the cloud only when this device edited offline, and is then merged over the last base it synced. `cells.garden/v1/claimedBy` remembers which account took the anonymous garden.
- Two pages signing in at the same moment (new tab + side panel) are serialised with `navigator.locks`; the store also re-checks for an existing row before inserting and follows the newest row per user in realtime.
- Sign-out shows the anonymous garden again and never writes the account's data into it.
