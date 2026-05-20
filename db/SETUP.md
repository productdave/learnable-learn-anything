# Supabase Setup — Phase 2.2

What you do once, while I keep building. After this is done, paste me the project URL + anon key and I'll wire the client.

## 1. Create the project

1. Go to https://supabase.com/dashboard
2. Click **New Project**
3. Settings:
   - **Name:** `learnable`
   - **Database password:** pick something secure (save it to your password manager)
   - **Region:** pick closest to you (e.g. Sydney for AU)
   - **Plan:** Free tier is fine for MVP
4. Wait ~2 minutes for provisioning.

## 2. Run the schema

1. In your project, go to **SQL Editor** in the left sidebar.
2. Click **New query**.
3. Open `db/01-schema.sql` from this repo. Copy the entire file. Paste into the editor. Click **Run** (or ⌘+Enter).
4. You should see "Success. No rows returned" for each statement.
5. Create another new query. Open `db/02-rls.sql`. Copy/paste/run.
6. Verify: in the left sidebar, click **Table Editor**. You should see 7 tables under `public`:
   - `courses`
   - `generation_jobs`
   - `learner_profiles`
   - `learning_events`
   - `modules`
   - `progress`
   - `topics`

## 3. Configure auth

For MVP, just enable **Email magic-link** auth (no password, no Google OAuth yet — those are Phase 3 upgrades).

1. In the left sidebar, click **Authentication** → **Providers**.
2. **Email** should already be enabled. Keep "Confirm email" turned on.
3. Scroll down. **Anonymous sign-ins** — leave OFF.
4. Optional now / later: **Google OAuth** under Providers → Google. Requires creating a Google Cloud OAuth client. Skip for first MVP — magic-link is enough for you + 3-5 testers.

### Restrict signups to an allowlist (private MVP)

Until you want public signups, lock it down:

1. **Authentication** → **Policies** → toggle **Enable sign-ups** OFF.
2. To add yourself + testers: **Authentication** → **Users** → **Add user** → enter their email, check "Auto-confirm user". They can then sign in via magic link.

## 4. Grab the keys I need

In **Project Settings** → **API**:

- **Project URL** — e.g. `https://xyzabcde.supabase.co`
- **anon public key** — long string starting with `eyJ...`

These two values go into the frontend as plain config — they're safe to expose publicly (RLS protects everything).

Also grab (but DO NOT share publicly):

- **service_role key** — used only by Vercel serverless functions, never sent to the browser. Goes into Vercel env vars when we wire Phase 2.3.

## 5. Send them to me

Paste in the next chat message:

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJI...
```

(The service_role key stays with you for now. I'll ask for it when we wire the API.)

I'll write the Supabase client wrapper, plumb auth into the library page (magic-link login), and have the existing learners-progress logic mirror to Supabase.

## What lands after this

- Magic-link login on the library page
- A returning user lands on the library logged in, their progress restored across devices
- Generated courses get saved to their account (when Phase 2.3 ships the API)
- `learning_events` rows start landing on every quiz answer, topic completion, flashcard review — building the substrate for Phase 3.5 recommendations

## Troubleshooting

- **"permission denied for schema public" when running SQL** — make sure you're using the SQL Editor (which runs as service role), not the Supabase JS client.
- **"role 'authenticated' does not exist"** — Supabase auto-creates this. If missing, your project might still be provisioning — wait a minute and retry.
- **RLS feels too strict** — for development, you can `alter table X disable row level security;` temporarily, but turn it back on before going live with multiple users.
