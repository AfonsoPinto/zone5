# Zone5

Adaptive running plans in English and Portuguese: an onboarding quiz, a phased plan with paces from the VDOT model, run logging (Strava GPX, phone GPS or manual), automatic adjustments, strength sessions, a guided workout with voice cues, personal records, group leaderboards and Google Calendar sync.

A static site (one `index.html`) with no server of its own:

- **Hosting:** GitHub Pages
- **Accounts and data:** Supabase (Auth + Postgres with Row Level Security)
- **Calendar:** the Google Calendar API, called from the browser through Google Identity Services

## Setup

1. **Supabase**
   - Create a project and run `supabase.sql` in the SQL Editor.
   - Under *Authentication → Sign In / Providers → Email*, turn off "Confirm email" so friends can sign in straight away.
   - Under *Authentication → URL Configuration*, set "Site URL" to the site address.
   - Put the *Project URL* and the *anon public key* in `CONFIG` at the top of the script in `index.html`. The anon key is public by design: the RLS policies are what protect the data.
2. **Google Calendar**
   - In a Google Cloud project, enable the *Google Calendar API*.
   - Configure the OAuth consent screen (External, testing mode) with the scope `.../auth/calendar.app.created`.
   - Add each friend as a test user (up to 100).
   - Create a *Web application* OAuth client ID, with the site origin under "Authorized JavaScript origins".
   - Put the client ID in `CONFIG`.
3. **GitHub Pages**
   - Under *Settings → Pages*, deploy from the `main` branch, `/` folder.

## Privacy

Each person can only read and write their own plan. Group members see only a display name and a weekly summary: km, workouts done and workouts planned. Google access is requested in each person's browser and covers only the "Zone5 · training" calendar the app creates.
