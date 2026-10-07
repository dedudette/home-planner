# CleanFlow

A personalized home-cleaning and daily-discipline planner. You describe your home, people, pets, time and energy; a rule-based
engine builds a realistic plan, with tiny-step and "just 5 minutes" modes for overwhelmed days.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 248 tests: engine, scheduler, goals, budgets, progression, persistence, reducer, analytics
npm run build      # typecheck + production build into dist/
npm run check      # type-check + tests
npm run e2e        # three browser suites: flow, responsive (7 widths), integrity (dev server must be running; set CHROME_PATH if needed)
```

No account or backend: data lives in `localStorage`. The Welcome screen (and Settings) can load four demo homes.

## Architecture

```
src/domain      pure TypeScript, no React
  types.ts        data model: User, Home, Room, Task, CleaningSession, Schedule(TaskState/PlanMeta), Progress, Supply, Preferences
  context.ts      Home + Preferences → rooms, zones, floors, planning context (visibility rules per home type)
  catalog.ts      130 home task templates (rules, not tasks): scope, scaling, frequency step-ups, steps, tiny steps, reasons
  engine.ts       instantiate → scale → step frequencies → split → fit to weekly capacity → explain (PlanNote[])
  planner.ts      scheduler: reset phase first, habits, weekday-balanced slotting grouped by zone/room
  schedule.ts     recurrence, overdue rolling, complete/skip/snooze/move transitions, overrides
  view.ts modes.ts micro.ts learning.ts progress.ts supplies.ts timer.ts   selectors and features
src/storage     Repository interface + LocalStorage adapter (swap for a real DB here)
src/state       reducer (pure), store (React context, timer, toasts, undo), chime
src/features    onboarding, today, plan, schedule, progress, home, supplies, modes, tasks, settings
```

### Life layer (discipline & lifestyle)
Beyond cleaning, CleanFlow can build small daily habits across nine areas: fitness, breathing, personal care, mind & focus,
digital discipline, life admin, learning, outdoors and sleep. It is opt-in: onboarding starts with **"What do you want to improve?"**
(`Preferences.focus`); home questions are skipped if you don't want a cleaning plan, and older saved data defaults to home-only.

```
src/domain/lifeCatalog.ts   86 templates, each with a progression ladder (walk 5→10→20→30 min) instead of near-duplicates, plus redundancy groups so near-duplicates never share a plan
src/domain/goals.ts         what it takes for a task to really serve a goal (not just carry its tag)
src/domain/progression.ts   when someone is ready for more (or less): distinct days over a minimum period at the current level
src/domain/life.ts          selection: focus → ladder step → daily time budget → per-weekday load check; challenges; rough-day reset
src/domain/scoring.ts       shared frequency ladder / priority / isLife()
```
- **Manageable:** ONE daily time budget, the number the user chose. Cleaning and habits share it 60/40 when both are on (each gets all of it when alone), so Today never promises 30 minutes and shows 45. A task cap (3–8) keeps the list short.
- **Honest about goals:** a goal counts as covered only when a chosen task is really about it and long enough to matter. Goals that do not fit are listed as *deferred*, with the reason, on Today and Plan.
- **Time-aware:** Today splits habits into Now (this part of the day plus anytime habits), Later today, This evening and Earlier today, so an evening routine is never presented as a morning task.
- **Progressive:** `lifeLevel` 1–3. The next ladder step is an optional *challenge*, never scheduled. A step up is suggested only after three weeks at a level with habits done on 15+ distinct days across the week; easing off needs 10+ days and real evidence. Fitness starts at the user's fitness level (beginner / intermediate / advanced), moved by their chosen pace. Nothing changes without a yes.
- **Safe:** fitness is filtered by fitness level and equipment (bodyweight by default), vigorous work is removed on low-energy days, volumes are modest, and fitness/breathing tasks always end with a safety line. No medical claims.
- **Separate from cleaning:** room mode, deep clean, reset sequence and supplies only use home tasks; life habits run every day, including non-cleaning days. People who do not choose a cleaning plan get no home screens at all ("My goals" instead of "My Home", no supplies, no home reset).
- **Rough-day reset** ("Back on track"): up to four tiny, gentle actions, never more than ~12 minutes.

### How personalization works
1. **Context** – size class, rooms (per floor), people/kids tier, pets, mess level, energy, blockers, goals, active days, chunk size.
2. **Instantiate** – each template applies per room/floor/home only if the home has that space (dorm ≠ garage).
3. **Scale & step** – minutes scale with room area and household size; frequency steps up for people, kids, shedding pets.
4. **Split** – tasks longer than the session/energy limit become "part 1 of N".
5. **Fit** – weekly load is fitted to `session × days`: relax low-value tasks (max 1–2 levels), park the rest in a backlog. Essentials never relax.
6. **Schedule** – reset tasks first (maintenance deferred for messy homes), daily habits run even on rest days, the rest is balanced by weekday and grouped by zone.
7. **Explain** – every adaptation is recorded and shown ("Why this plan?").

Learning is rule-based and always asks first (shorter sessions, repeated skips, steady routines).

## Safety
The Supplies screen shows a permanent chemical-safety warning (never mix products, especially bleach with ammonia or acids) and warns when the user's own stash contains dangerous pairs. The app never gives mixing instructions.

## Data safety
- **Saved data is never silently destroyed.** `src/storage/schema.ts` validates and repairs on load (bad fields are repaired, bad list items dropped and counted) and migrates by version (`SCHEMA_VERSION = 2`). A file from a newer version is read as far as possible and backed up. Data that cannot be understood is kept as raw text and shown on a **recovery screen** (download it, restore an automatic backup, or start fresh, which keeps a copy first).
- **An error boundary** wraps the app (full recovery screen) and every page (the navigation keeps working).
- **Anything that replaces your data asks first** (demo, restore from file or backup, erase) and takes an **automatic backup** (last three, listed in Settings). Erase offers a download first and deletes the backups too.
- **Exports are versioned envelopes** (`{ app, exportVersion, schemaVersion, data }`); imports also accept the bare files older versions wrote, and show a summary before replacing anything.
- **Saves are revision-checked.** Two tabs cannot overwrite each other: the stale tab takes the newer data and replays its own unsaved actions on top. Saves flush on `pagehide`. A full disk or blocked storage shows a banner instead of failing silently.
- **Actions are idempotent and individually undoable.** Every logged action has an `entryId`; completing the same thing twice never double-counts, and Undo removes exactly its own entry (and restores that task's state only if nothing newer touched it).
- A running timer carries its task, so a "Just 5 minutes" habit finished after a reload is still logged as that habit.

## Analytics foundation (data only, no analytics UI yet)
Every logged entry now records the template, level, difficulty, intensity, planned time of day, goals, plan version, day energy, local hour, timezone offset and, for moves and snoozes, where the task was due and where it went. Each day's scheduled tasks are recorded (`exposures`), so a task that was shown and ignored is visible. Day energy is kept per day (`energyLog`), plan inputs get a stable `planVersion`, and suggestions emit `recEvents` (shown / accepted / dismissed, with a reason code and the numbers behind it). Nothing leaves the device.

## Testing
`npm test` covers the pure domain, the reducer and the storage layer. `npm run e2e` drives a real browser: `flow.mjs` (the main journey), `responsive.mjs` (every screen, sheet and onboarding step at 320, 360, 390, 430, 768, 1024 and 1366 px, with overflow and accessibility checks) and `integrity.mjs` (recovery, confirmation, duplicates, two tabs, closing mid-save, timers, time-aware Today, life-only users, goal coverage).
