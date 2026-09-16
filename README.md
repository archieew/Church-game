# Bible Quiz Battle

## Run locally

1. Install Node.js 18 or newer.
2. Open a terminal in this folder.
3. Run:

```bash
npm install
npm run dev
```

4. Open the local URL printed by Vite.

The app must run through Vite because Supabase is imported as an npm module.

## Supabase setup

1. Copy `.env.example` to `.env`.
2. Add the Supabase project URL and public anon/publishable key.
3. Run `supabase/schema.sql` in the Supabase SQL Editor.
4. Restart Vite after changing `.env`.

The prototype falls back to preview mode when Supabase environment variables are missing.

## Gemini question generation

The admin question maker uses the `generate-question` Supabase Edge Function. Set the
Gemini key as a Supabase secret, then deploy the function:

```bash
npx supabase login
npx supabase link --project-ref afrplpqjswocktkldmym
npx supabase secrets set GEMINI_API_KEY=your-gemini-key
npx supabase functions deploy generate-question
```

The admin creates a room first, then enters a topic in the room lobby. Gemini generates
10 questions for review; the admin clicks **Use these 10 questions** before starting the game.
The Gemini key is never sent to the browser.

## Game model

- The admin creates the room and shares its six-character code.
- Creating a room requires the admin password.
- A room has exactly two player slots.
- Players can only enter through the shared room code.
- Players see only a buzzer on their devices. The first player to tap is recorded server-side.
- The admin screen displays the question and choices on the TV and selects the answer for the player who buzzed first.
- The admin reveals after the first player buzzes and the host selects an answer.
- The admin can change or extend the active timer, including after it reaches zero.
