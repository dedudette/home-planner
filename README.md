# CleanFlow

A personalized home-cleaning and daily-discipline planner. You describe your home, people, pets, time and energy; a rule-based
engine builds a realistic plan, with tiny-step and "just 5 minutes" modes for overwhelmed days.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 102 domain tests (engine, scheduler, modes, learning, reducer)
npm run build      # typecheck + production build into dist/
npm run e2e        # browser walkthrough (dev server must be running; set CHROME_PATH if needed)
```

No account or backend: data lives in `localStorage`. The Welcome screen (and Settings) can load four demo homes.

## Architecture

```
src/domain      pure TypeScript, no React
  types.ts        data model: User, Home, Room, Task, CleaningSession, Schedule(TaskState/PlanMeta), Progress, Supply, Preferences
  context.ts      Home + Preferences → rooms, zones, floors, planning context (visibility rules per home type)
  catalog.ts      ~100 task templates (rules, not tasks): scope, scaling, frequency step-ups, steps, tiny steps, reasons
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
src/domain/lifeCatalog.ts   ~80 templates, each with a progression ladder (walk 5→10→20→30 min) instead of near-duplicates
src/domain/life.ts          selection: focus → ladder step → daily time budget → per-weekday load check; challenges; rough-day reset
src/domain/scoring.ts       shared frequency ladder / priority / isLife()
```
- **Manageable:** a daily time budget (shared 40% with cleaning when both are on) and a task cap (3–8) decide what appears; each chosen goal is covered first.
- **Progressive:** `lifeLevel` 1–3. The next ladder step is an optional *challenge*, never scheduled. Level-up / ease-off are suggested from your history and only applied if you agree.
- **Safe:** fitness is filtered by fitness level and equipment (bodyweight by default), vigorous work is removed on low-energy days, volumes are modest, and fitness/breathing tasks always end with a safety line. No medical claims.
- **Separate from cleaning:** room mode, deep clean, reset sequence and supplies only use home tasks; life habits run every day, including non-cleaning days.
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
