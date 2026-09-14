# Night mode & alarm — implementation plan

Status: **implemented.** All six phases shipped, and the `VISION.md` amendments in §9 are made.
Kept as the record of why the design is what it is — §2 and §8 in particular are the reasoning
behind decisions that would otherwise look arbitrary in the code.

Read `VISION.md` first. This feature deliberately amends two of its non-goals; §9 of this
document says exactly how, and that edit is part of the work, not an afterthought.

---

## 1. What this is

Two features that share one data model:

- **The alarm marker.** A draggable horizontal line on the day column that sets a wake time —
  an ordinary wall-clock time, snapped to a **5-minute grid**. You place it by eye against the
  bands, which is how "half an hour before sunrise" gets expressed.
- **Night mode.** A full-screen tent/nightstand clock that stays awake on a charger, shows the
  time in large drifting numerals against the *current light level's colour*, and sounds the
  alarm in the foreground.

The intended use is a phone plugged in overnight in a tent or on a nightstand, waking the
owner at first usable light.

## 2. Why the alarm fires in the foreground and nowhere else

A PWA cannot wake itself. `TimestampTrigger` never shipped past a flag, a service worker is
killed after ~30s idle and cannot schedule itself, and Periodic Background Sync is Chrome-only
with a ~12h floor. Any design that schedules a wake-up while the app is closed will silently
not fire, which is the same class of failure as printing a time that isn't real (`VISION.md`
success criterion #5).

Three honest options were considered. Handing the time to the OS Clock app (reliable, but a
manual step) and `.ics` calendar export (fires closed, but it is a *notification* — on iOS it
obeys Focus and the ringer switch, so it is a coin flip at 4am) were both set aside in favour
of the foreground alarm, because it is the only one where the app controls the sound and the
volume. Its cost — the screen must stay on all night on a charger — was accepted deliberately.

**This is not a regression to relitigate.** If a future session is tempted to "improve" this
with a service worker timer or the Notifications API, the answer is no.

## 3. Decisions already made

| Decision | Why |
|---|---|
| The alarm is an **absolute wall-clock time on a 5-minute grid** | An alarm clock is absolute: you want 06:00, not "whenever dawn happens to be". Snapping removes pixel precision from the problem — a ~700px column gives ~2.4px per slot, and the live readout makes the drag hunt-and-settle rather than a blind tap. "30m before sunrise" is then something you *eyeball against the bands*, which is what the bands are for. This deletes anchor resolution, offset arithmetic, and alarm-absence entirely. |
| **5 minutes**, not 10 | 5 is the granularity people think in for alarms. 10 would be ~4.9px per slot and easier to hit; it is a one-constant change (`STEP_MIN`) if 5 proves fiddly in the hand. |
| The alarm is **set by dragging on the day column**; night mode only displays and fires it | Keeps the setting gesture where the data is. Night mode stays a presentation surface with one job. |
| Night mode's background is **the current light level's colour** | It is the app's central claim ("the colour carries the meaning") sampled at *now* instead of across 24h. It also makes the screen genuinely dark at 03:00 without a separate dim setting. |
| The alarm tone is **generated with Web Audio**, not a shipped file | No new precache asset, offline by construction, keeps the 29KB budget. |
| Night mode **ignores `model.date`** | See §8. This is the most dangerous bug in the feature. |
| A spring-forward alarm **fires an hour late, not never** | See §8.3. Stated so it is a decision rather than an accident of the `Date` constructor. |

### Still open

Nothing blocking. The affordance for *creating* the first alarm (versus moving an existing one)
is left to implementation judgement — see §6, phase 2.

## 4. New files

```
src/alarm.ts    pure: the 5-minute slot grid, wall-clock resolution, firing state.
                No DOM, no Date.now()
src/night.ts    the night-mode overlay: tick loop, wake lock, audio, drift
```

`alarm.ts` joins `solar.ts` and `layout.ts` in the pure core and must be unit-testable with an
injected `now`. `night.ts` is a second DOM module alongside `render.ts`; `render.ts` is not
modified beyond drawing the marker. `main.ts` wires the toggle.

Note that `alarm.ts` needs a `SolarDay` only to *position* the marker on the column. Deciding
when the alarm fires needs no solar data at all.

## 5. Types

```ts
// src/alarm.ts
import type { LocalDate, SolarDay } from './solar'

export type Alarm = {
  /** Wall-clock minutes from local midnight. Always a multiple of STEP_MIN. */
  readonly minuteOfDay: number
  readonly enabled: boolean
}

/** One position on the drag grid. */
export type Slot = {
  readonly minuteOfDay: number
  /** Position in the column, 0..1. */
  readonly fraction: number
}

export type FiringState = 'pending' | 'due' | 'missed'

export const STEP_MIN = 5
```

Functions, all pure:

```ts
/**
 * The grid for a day, built by stepping epoch time from `day.start` and reading the
 * local clock — exactly as `hourMarks` does (`src/layout.ts:195`). A 23h day therefore
 * has 276 slots and a 25h day 300, and the spring-forward gap simply has no slot.
 */
slots(day: SolarDay, stepMin?: number): readonly Slot[]

/** Column position -> the slot under it. The snap. */
slotAt(day: SolarDay, fraction: number): Slot

/** Where an alarm sits on a given day's column, 0..1. For drawing the marker at rest. */
fractionOf(alarm: Alarm, day: SolarDay): number

/** The alarm's instant on a calendar date, resolved as wall-clock time — see §8.3. */
alarmTimeOn(alarm: Alarm, date: LocalDate): Date

/** The next occurrence strictly after `now`: today's if still ahead, else tomorrow's. */
nextAlarm(alarm: Alarm, now: Date): Date

/** 'due' inside the grace window, 'missed' past it. Grace exists because the page can freeze. */
firingState(target: Date, now: Date, graceMs: number): FiringState
```

Persisted at `sundial:alarm` through `state.ts`, with a type guard like the existing ones
(`src/state.ts:36`). A malformed stored value must fall back to "no alarm", never throw. The
guard must also reject a `minuteOfDay` that is out of range or off the grid.

## 6. Implementation phases

Each phase is independently shippable and verifiable.

### Phase 1 — `alarm.ts` and its tests

Pure module plus `tests/alarm.test.ts`. No UI. Cover:

- `slots` on an ordinary 24h day (288 slots), a 23h spring-forward day (276, with no slot in
  the 02:00 hour), and a 25h autumn day (300, with two slots reading 01:30).
- `slotAt` round-trips: every slot's own `fraction` snaps back to itself, and positions between
  two slots go to the nearer one.
- `alarmTimeOn` for 02:30 on a spring-forward date — must be 03:30, and that must be asserted,
  not incidental.
- `nextAlarm` rolling from today to tomorrow across midnight, and the boundary case where the
  alarm minute equals `now` to the second (strictly after: it rolls to tomorrow).
- `firingState` either side of the grace window.

### Phase 2 — the drag marker

An `#alarm` element inside `#day`, positioned in the same coordinate space as the ticks
(`src/render.ts:120`).

- `pointerdown` / `pointermove` / `pointerup` with `setPointerCapture`. `touch-action: none`
  on the handle **only**.
- Hit area ≥44px behind a 1px line. `--slot` is 42px (`src/styles.css:27`) — reuse it.
- **Snap to the nearest slot on every `pointermove`.** The line itself moves in 5-minute steps;
  it does not track the finger continuously. That is what makes a 2.4px detent usable.
- Readout while dragging: right-aligned, the time plus its relation to the nearest solar event —
  `05:30 · 28m before sunrise`. The relation is display-only, derived on the fly, never stored;
  it is what turns "eyeball it against the bands" into a confirmable action. The `.ev` label
  boxes span the full width (`src/styles.css:262`) but their text is left-packed and `.l`
  already ellipsizes, so the right lane is visually free without restructuring anything.
- `role="slider"` with `aria-valuetext` set to the same readout. Arrow keys move ±1 slot, and
  the handler **must** `stopPropagation`, because `src/main.ts:139` binds ArrowLeft/Right at
  window level for date stepping.
- At rest the marker sits at the same wall-clock height on every date the user pages to, while
  the bands slide underneath it. Do not treat that as a bug to fix — it is the clearest
  demonstration the app has of what it is for: you watch a 06:00 alarm move from daylight into
  darkness across the autumn.

Collision with the dawn label cluster is real — a wake alarm lands exactly where
`resolveLabels` (`src/layout.ts:97`) is already working hardest. Use the free right lane for
the drag readout so the tested solver is untouched while the thumb is down.

### Phase 3 — the night-mode shell

Full-screen overlay, entered from a new control in the location row. Landscape and portrait
from one fluid rule — do **not** call `screen.orientation.lock()`, which needs fullscreen and
is unsupported on iOS:

```css
font-size: clamp(4rem, min(38vw, 55vh), 20rem);
```

Secondary text (alarm time, next event) sits below the clock in portrait and beside it in
landscape. The Fullscreen API hides browser chrome on Android but not iOS Safari; in an
installed PWA there is no chrome to hide, so it is fine for the UI to point out that installing
gives the best result.

### Phase 4 — the tick loop

One `setInterval` at 1000ms. On each tick:

1. If the displayed minute changed, update the clock text and re-evaluate `levelAt` for the
   background colour.
2. Evaluate `firingState` against the armed target.
3. If the `AudioContext` has been suspended, `resume()` it.

**Do not `setTimeout` for eight hours.** It drifts, it gets throttled, and it is dropped on
suspend. Comparing against the wall clock every second is self-healing and costs nothing, since
the clock display needs the tick anyway.

Background colour uses the band custom property with `transition: background-color 4s linear`,
so a band boundary fades rather than flashes. Ink comes from the existing `SURFACE` map and
`data-surface` mechanism (`src/render.ts:63`) — night mode needs no new palette.

### Phase 5 — wake lock, drift, audio

**Wake lock.** `navigator.wakeLock.request('screen')`. It is **released automatically whenever
the page hides**, so it must be re-acquired on `visibilitychange` — there is already a listener
there for the service worker (`src/main.ts:198`). Miss this and the screen quietly dies an hour
in. Wrap in try/catch; unsupported or denied must degrade to a working clock, not a crash.

**Drift.** Reposition the clock every ~45s via `transform: translate()` with a ~2s CSS
transition. **Jump, do not animate continuously** — a permanently moving element repaints every
frame all night. Give it real excursion across the safe area, not a 20px jitter, or it will not
prevent burn-in. Keep numerals at the band ink colour rather than pure white: less burn, less
glare, and measurably less power on OLED. (The web cannot touch the backlight; content
luminance is the only brightness control available.)

**Audio.** Create and prime the `AudioContext` on the gesture that *enters* night mode — that
is the only user gesture available, and autoplay policy requires one. Tone is an oscillator
with a gain envelope, beeping, ramping from roughly 0.05 to 0.6 over ~30s so it wakes rather
than startles. Tap anywhere to silence. Note `navigator.vibrate` does nothing on iOS, so on
iPhone audio is the only channel — do not rely on vibration as a fallback.

### Phase 6 — missed and absent states

A frozen page that resumes past the alarm fires inside the grace window and otherwise renders
**missed**, explicitly.

The alarm itself can no longer be absent — an absolute time always exists. But night mode's
secondary line names the *next solar event*, and that event can be absent (Tromsø in December
has no sunrise). Render it using the existing copy in `messages.ts`, following the rule the
codebase already holds: a thing that did not happen is a value you display, never a blank.

## 7. Testing

Vitest, no DOM, consistent with the existing suite:

- `alarm.ts` as listed in phase 1.
- `slotAt` / `fractionOf` round-trips across ordinary and DST days.
- No tests for `night.ts`; it holds no logic worth testing, the same bargain `render.ts` makes.

CI must stay offline. Nothing here needs the network.

## 8. Traps

Listed in order of how quietly they fail.

1. **Midnight rollover.** Night mode must resolve "the next occurrence from now" and must
   **ignore `model.date`**. The main app's date is wherever the user last paged to; if night
   mode inherits it, the alarm gets computed against a date weeks away and the user sleeps
   through it. This is the worst bug available in this feature.
2. **Wake lock release on hide.** Silent. The screen just goes dark mid-night. See phase 5.
3. **DST, in two separate places.**
   - *The grid is not evenly spaced in pixels.* A 23h day holds 276 five-minute slots and a 25h
     day 300. Compute `heightPx / 288` and the marker walks off the hour ticks on those two
     days. Build the grid by stepping epoch time from `day.start`, the way `hourMarks` already
     does (`src/layout.ts:195`), and it is correct for free.
   - *The spring-forward gap.* 02:00–02:59 does not exist, so the grid has no slot there and an
     alarm cannot be **set** inside it. An alarm already stored at 02:30 resolves through
     `new Date(y, m - 1, d, 2, 30)`, which rolls forward to 03:30. **That is the decision:** it
     fires an hour late rather than not at all. Fall-back is the mirror — two slots read 01:30,
     both store the same minute, the marker snaps to the first, and the alarm fires on the first
     occurrence. One day a year at 01:30; no mechanism needed, one comment in the code.
4. **Suspended `AudioContext`.** Resume on tick, not only on arm.
5. **Arrow-key collision** with date stepping. See phase 2.
6. **`localStorage` namespace.** The new key is `sundial:alarm`. Storage is keyed by origin and
   path is not part of origin, so an unprefixed key collides with the rest of `jeffkwak.com`.

## 9. Documentation to amend

Part of the work, not optional. `VISION.md` is the record of why, and shipping this while it
still says the opposite makes the record false.

- **§2, "Live now state / countdowns."** Rewrite. The non-goal was about keeping the *day
  column* free of live state; night mode is a separate surface the user opts into. Say that.
- **§2, "Notifications."** Rewrite to record what §2 of this document establishes: the platform
  limitation is real and unchanged, and the foreground alarm is the response to it — not a
  workaround for it. Keep the reasoning; it is still correct and still load-bearing.
- **§4, Interface.** Add night mode and the marker.
- **§7, Open questions.** The marker partly answers "should the day band brighten toward solar
  noon?" — it gives the day band something to be besides a flat slab without adding a gradient
  stop that is not one of the six events.

**`README.md` needs no change.** Its "no notifications" claim stays literally true: this feature
does not touch the Notifications API at all. It is a sound played by an open page.

## 10. Out of scope

- Any scheduling that runs while the app is closed (§2).
- `.ics` export and OS Clock handoff. Considered, set aside; revisit only if the foreground
  alarm proves unreliable on real hardware.
- **Event-relative alarms** — storing "30m before sunrise" as intent, so the time tracks the sun
  across the year. Considered and set aside: the 5-minute grid plus the visible bands gets the
  same result by eye, for a fraction of the machinery, and a wake alarm is normally meant to be
  absolute anyway. The readout in phase 2 keeps the relation visible without storing it.
- Multiple alarms. One is the use case.
- Snooze.
- Timezone conversion for saved locations in another zone. Already a stated limit in
  `VISION.md` §4 and unchanged here — night mode shows device-local time like everything else.
