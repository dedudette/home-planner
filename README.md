# CleanFlow

A personalized home-cleaning and daily-discipline planner. You describe your home, people, pets, time and energy; a rule-based
engine builds a realistic plan, with tiny-step and "just 5 minutes" modes for overwhelmed days.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 451 tests at the time of writing: engine, scheduler, daily budget, low-energy safety, goal coverage, persistence, backups, retention, reducer, analytics
npm run build      # typecheck + production build into dist/
npm run check      # type-check + tests
npm run e2e        # five browser suites: flow, responsive (7 widths), integrity, sync (two tabs), behaviour (what a day records). The dev server must be running; set CHROME_PATH if needed
```

No account or backend: data lives in `localStorage`. The Welcome screen (and Settings) can load seven example profiles.

## Architecture

```
src/domain      pure TypeScript, no React
  types.ts        data model: User, Home, Room, Task, CleaningSession, Schedule(TaskState/PlanMeta), Progress, Supply, Preferences
  context.ts      Home + Preferences → rooms, zones, floors, planning context (visibility rules per home type)
  catalog.ts      130 home task templates (rules, not tasks): scope, scaling, frequency step-ups, steps, tiny steps, reasons
  engine.ts       instantiate → scale → step frequencies → split → fit to weekly capacity → explain (PlanNote[])
  planner.ts      scheduler: reset phase first, habits, weekday-balanced slotting grouped by zone/room
  schedule.ts     recurrence, overdue rolling, complete/skip/snooze/move transitions, overrides
  budget.ts       the one daily time budget and the single fit that decides what a day holds (Today, Tomorrow, Schedule)
  safety.ts       the one low-energy rule every list that suggests a task must use
  retention.ts    how much history fits in browser storage, and how the oldest is let go (never silently)
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
src/domain/goals.ts         an explicit rule, in words, for every goal: what counts as primary cover, how long a step must be, and why
src/domain/progression.ts   when someone is ready for more (or less): distinct days over a minimum period at the current level
src/domain/life.ts          selection: focus → ladder step → daily time budget → per-weekday load check; challenges; rough-day reset
src/domain/scoring.ts       shared frequency ladder / priority / isLife()
```
- **Manageable:** ONE daily time budget, the number the user chose. Cleaning and habits share it 60/40 when both are on (each gets all of it when alone), and unused minutes in one share go to the other. `fitDay` decides every day, for Today, Tomorrow and the whole schedule alike, so what is planned never adds up to more than the promise. The only exception is an urgent task the user added themselves: it is kept, the overage is shown as an exact number, and everything else is left out. Anything that does not fit is listed as *left out*, with the reason (time, low energy, or not a cleaning day), and stays due; a task that has waited two days moves ahead of newer work. A habit cap (3–8) keeps the list short.
- **Honest about goals:** a goal counts as covered only when a chosen task is *primary* for it: it passes the goal's own rule (for example, "Moves your body for 5 minutes or more") and the step is long enough. Related tasks are shown as *supporting*, with the reason they are not enough on their own. The Plan page names each goal's task, its minutes, whether it is primary or supporting, and why it counts. Goals that do not fit are *deferred*, and the reason is where the goal actually stopped being possible: not enough minutes (with the number needed), the habit cap, a safety limit, something missing (such as equipment), or no suitable task at the current level.
- **Time-aware:** Today splits habits and home routines into Now (this part of the day plus anytime tasks), Later today, This evening and Earlier today, so an evening routine is never presented as a morning task. Cleaning is not clock-driven: only the few tasks that belong to a time of day (making the bed, the evening dishes) are tucked away, never hidden.
- **Progressive:** `lifeLevel` 1–3. The next ladder step is an optional *challenge*, never scheduled. A step up is suggested only after three weeks at a level with habits done on 15+ distinct days across the week; easing off needs 10+ days and real evidence. Fitness starts at the user's fitness level (beginner / intermediate / advanced), moved by their chosen pace. Nothing changes without a yes.
- **Safe:** fitness is filtered by fitness level and equipment (bodyweight by default), volumes are modest, and fitness/breathing tasks always end with a safety line. No medical claims. On a day the user marks as low energy, hard and vigorous tasks are held back by *every* list that suggests something (Today, Quick wins, "I only have X minutes", Just 5 minutes, challenges, routines, room lists, the reset sequence), all through the same `energyOk` rule, and the day's minutes shrink to 60%. With very low energy no habit runs longer than 15 minutes.
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

Learning is rule-based and always asks first (shorter sessions, repeated skips, steady routines, a step up or an easier stretch). What each rule reads, and what it refuses to read, is under **Behaviour insights** below.

## Safety
The Supplies screen shows a permanent chemical-safety warning (never mix products, especially bleach with ammonia or acids) and warns when the user's own stash contains dangerous pairs. The app never gives mixing instructions.

## Data safety
- **Saved data is never silently destroyed.** `src/storage/schema.ts` validates and repairs on load (bad fields are repaired, bad list items dropped and counted) and migrates by version (`SCHEMA_VERSION = 2`). A file from a newer version is read as far as possible and backed up. Data that cannot be understood is kept as raw text and shown on a **recovery screen** (download it, restore an automatic backup, or start fresh, which keeps a copy first).
- **An error boundary** wraps the app (full recovery screen) and every page (the navigation keeps working).
- **Anything that replaces your data asks first** (demo, restore from file or backup, erase) and takes an **automatic backup** (last three, listed in Settings). Erase offers a download first and deletes the backups too.
- **Exports are versioned envelopes** (`{ app, exportVersion, schemaVersion, data }`); imports also accept the bare files older versions wrote, and show a summary before replacing anything.
- **Saves are revision-checked.** Two tabs cannot overwrite each other: the stale tab takes the newer data and replays its own unsaved actions on top. Only a real local change ever writes a new revision: adopting another tab's save does not, so two open tabs settle and then go quiet (the browser suite counts the writes). Saves flush on `pagehide` and bring the tab up to date with whatever it merged. A full disk or blocked storage shows a banner instead of failing silently.
- **A safety copy is verified before anything is replaced.** Replacing your data first brings in anything another tab saved, then copies and checks the copy. If there is no room for the copy, nothing is replaced until you have downloaded your own. Identical backups are kept once, and one of each kind is kept in preference to three of the same.
- **History is never dropped silently.** Storage holds about 5 million characters and a logged action costs about 500, so the limit is a few years away. At 2.2 M the Settings page suggests a download; at 3.0 M CleanFlow asks, offers a full download first, and only then keeps the newest history and removes the oldest, leaving a note in the data (`retention`) that says where the history now starts. The validator keeps the newest items of every list and says so whenever it has to drop any.
- **Actions are idempotent and individually undoable.** Every logged action has an `entryId`; completing the same thing twice never double-counts, and Undo removes exactly its own entry (and restores that task's state only if nothing newer touched it).
- A running timer carries its task, so a "Just 5 minutes" habit finished after a reload is still logged as that habit.

## Analytics foundation (data only, no analytics UI yet)
Every logged entry records the template, level, difficulty, intensity, planned time of day, goals, plan version, day energy, local hour, timezone offset and, for moves and snoozes, where the task was due and where it went. Day energy is kept per day (`energyLog`), plan inputs get a stable `planVersion` (and a snapshot of the goals that plan could not serve, with the reason), and suggestions emit `recEvents` (shown / accepted / dismissed, with a reason code and the numbers behind it), each recorded once however many times a screen renders. Nothing leaves the device.

### What a day's record says (contract 2)
Three different facts are kept apart, because mixing them is how "ignored" gets invented:
- **Selected**: what the planner put on the day (`exposures[].items`, with `selectedAt` and the energy it was selected under). Not the same as shown.
- **Left out**: due tasks the planner considered and did not select (`exposures[].left`), each with the planner's own reason (`not-enough-time`, `low-energy-day`, `not-a-cleaning-day`), the time, energy and budget at that moment. A left-out task is not an exposure and is never counted as skipped or failed.
- **Seen**: set by the Today screen, only while the page is visible, when the task is actually rendered (`seenAt`; for left-out tasks, when the "left out of today" list is opened). Rendered, not scrolled to or read. Opening Settings first records the day's selection and marks nothing seen.

A day record is written when the app is opened while visible, even if nothing is planned, so a day with no record between two records means the app was not opened. Before records began, in removed history, or under the older record format, a day is **unknown**, never "not opened". Records written before contract 2 keep their unknowns (no invented seen, no invented reasons), and a same-day old-format record is left exactly as it was. Re-renders, StrictMode, reloads and a second tab add nothing: first-seen times are never overwritten and a repeat adds no write.

Each entry also says which screen it came from (`surface`), whether the task was selected, left out, or not planned that day (`planned`; absent = unknown), the date the occurrence was due (`fromDue`; `null` for Just 5 minutes and rough-day steps), and which part of a split task it was (`part`).

## Behaviour insights
There is no Behaviour Analysis screen yet. The suggestions that exist read only what the person **did** (entries), and, where Today recorded it, what was shown. They share these rules (`src/domain/behaviour.ts`, `learning.ts`, `progression.ts`):
- "No completion" is never a skip. A skip is an explicit skip; a snooze, a move and a timer stopped early are each their own thing.
- Days the person declared low energy are not read as "this is too big". Just 5 minutes, the rough-day steps and the reset sequence are not the routines and are left out of routine evidence.
- A window that reaches into history removed to save space is not read at all (a short count there would look like a quiet stretch). Where the evidence is unreliable, the suggestion is withheld, not softened.
- Nothing says why anyone did or did not do something. Every suggestion is optional and shows its numbers. Only the step up adds work; it needs a yes, and it is held back on low-energy stretches, by missing history, and when most of what was shown went undone (judged only once ten days of that are known).

## ## Testing
`npm test` covers the pure domain, the reducer and the storage layer. `npm run e2e` drives a real browser: `flow.mjs` (the main journey), `responsive.mjs` (every screen, sheet, onboarding step and the newer states at 320, 360, 390, 430, 768, 1024 and 1366 px, with overflow and accessibility checks), `integrity.mjs` (recovery, confirmation, duplicates, closing mid-save, timers, time-aware Today and home routines, life-only users, goal coverage, budgets on Today / Tomorrow / the week, low energy, a three-year history) `sync.mjs` (two tabs on the same data: no write loop, both tabs' work survives, a stale tab backs up the latest state, no room for a backup) and `behaviour.mjs` (what a day records: selected vs left out vs seen, Settings-first opens, a background tab, two tabs, the fresh-start wording).
