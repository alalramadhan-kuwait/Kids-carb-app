# وجباتنا — kids-carb-app

Arabic, mobile-first carb & meal planner for a child with type 1 diabetes. It counts carbohydrates and organises
food. It never calculates or suggests insulin doses.

## Rules the code enforces
- Commercial carbs come only from a registered, approved label (Total Carbohydrate). Nothing is guessed; a recipe
  with an unregistered product shows "هذا المنتج غير مسجل…" and is never suggested.
- Rice/pasta are weighed cooked. A pasta label describes dry pasta, so its measured `cooked_yield` is required.
- Every number (max 60 g, preferred 40–55 g, tablespoon size, category targets) lives in `carb.settings`.
- Levels: up to preferred max normal, up to max near limit, above max warning (never blocked).

## Data
Own schema `carb` in the Supabase project (no foreign keys into other apps; access only for rows in `carb.members`).
Schema + seed: `supabase/migrations/`. First parent enters the one-time setup code; the second is added from "المزيد".

**One dashboard step:** Supabase > Settings > API > Exposed schemas > add `carb`.

## Run
    cp .env.example .env.local   # URL + anon key
    npm install && npm run dev
    npm test                     # carb engine, suggestions, shopping list

## Deploy
Every push to `main` runs the tests, builds, and publishes to GitHub Pages
(`.github/workflows/deploy.yml`). One-time setting: Settings > Pages > Source: **GitHub Actions**.
The app is static, works under any sub-path (hash routing), and installs to a phone's home screen.
