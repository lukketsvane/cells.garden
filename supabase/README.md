# Supabase (M1)

Free tier. Auth via magic link, one row per garden in `gardens.data` (jsonb), RLS `user_id = auth.uid()`.

## Set up

1. Create a project at supabase.com.
2. SQL editor → paste `migrations/0001_init.sql` → run. Re-runnable.
3. Authentication → URL configuration: add the site URL (`https://<app>.vercel.app`) to **Site URL** and **Redirect URLs**. Magic links land on `/` and the client picks the session out of the URL.
4. Authentication → Email: keep "Confirm email" on; magic link is the only sign-in method the app uses.
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

## Sync model

- Signed out: `LocalStore` (localStorage, `cells.garden/v1`).
- Signed in: `SupabaseStore` is primary; a per-user `LocalStore` (`cells.garden/v1/user/<uid>`) mirrors every save as the offline copy. On sign-in the newer `updatedAt` of cloud vs. mirror wins. An account with no garden yet receives the device's anonymous garden, once (`cells.garden/v1/claimedBy` remembers which account took it), so a second account on the same device never inherits the first one's plants.
- Two pages signing in at the same moment (new tab + side panel) are serialised with `navigator.locks`; the store also re-checks for an existing row before inserting and follows the newest row per user in realtime.
- Sign-out shows the anonymous garden again and never writes the account's data into it.
