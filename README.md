# CleanFlow

A personalized home-cleaning planner. You describe your home, people, pets, time and energy; a rule-based
engine builds a realistic plan, with tiny-step and "just 5 minutes" modes for overwhelmed days.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 69 domain tests (engine, scheduler, modes, learning, reducer)
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
