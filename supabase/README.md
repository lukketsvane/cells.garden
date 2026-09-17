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

## Sync model

- Signed out: `LocalStore` (localStorage).
- Signed in: `SupabaseStore`. On first sign-in the local garden is uploaded if the cloud garden is empty; otherwise the newer `updatedAt` wins. Every save writes the whole blob. Realtime on `gardens` re-renders other open devices.
- Sign out keeps the local copy so the garden never disappears from the device.
