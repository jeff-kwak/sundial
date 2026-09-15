// Night mode: a full-screen tent/nightstand clock that stays awake on a charger,
// shows the time against the current light level's colour, and sounds the alarm.
//
// The alarm fires in the foreground and nowhere else. A PWA cannot wake itself —
// TimestampTrigger never shipped past a flag, a service worker is killed after
// ~30s idle and cannot schedule itself, and Periodic Background Sync is
// Chrome-only with a ~12h floor. Anything that schedules a wake-up while the app
// is closed would silently not fire, which is the same class of failure as
// printing a time that isn't real. The cost — the screen stays on all night on a
// charger — was accepted deliberately, and is not a regression to relitigate with
// a service-worker timer or the Notifications API.
//
// This is the second DOM module, alongside render.ts, and makes the same bargain:
// it holds no logic worth unit-testing, because everything decidable lives in
// alarm.ts.

import { firingState, nextAlarm, swellGain, type Alarm } from './alarm'
import { formatTime, type Clock } from './format'
import { bandsOf, levelAt, type Band } from './layout'
import { absenceMessages, LABEL } from './messages'
import { BAND_VAR, SURFACE, type Elements } from './render'
import { addDays, isPresent, solarDay, toLocalDate, type Coords, type EventKind, type SolarDay } from './solar'

export type NightArgs = {
  readonly coords: Coords | null
  readonly alarm: Alarm
  readonly clock: Clock
  readonly onClose: () => void
}

const TICK_MS = 1_000
/** How late a frozen page may resume and still ring rather than report a miss. */
const GRACE_MS = 5 * 60_000
const DRIFT_MS = 45_000

const BEEP_PERIOD_S = 1.5

type Tone = { readonly osc: OscillatorNode; readonly gain: GainNode; readonly since: number; until: number }

type Session = {
  readonly el: Elements
  readonly args: NightArgs
  readonly ctx: AudioContext | null
  readonly onVisible: () => void
  readonly onKey: (e: KeyboardEvent) => void
  readonly onResize: () => void
  timer: number
  /** The instant the alarm is next expected to fire, or null when it is off. */
  armed: Date | null
  ringing: boolean
  tone: Tone | null
  missed: Date | null
  lastMinute: number
  driftAt: number
  dayKey: string
  day: SolarDay | null
  bands: readonly Band[]
  next: { readonly kind: EventKind; readonly at: Date } | null
  lock: WakeLockSentinel | null
}

let session: Session | null = null

export const nightIsOpen = (): boolean => session !== null

export const openNight = (el: Elements, args: NightArgs): void => {
  if (session !== null) return

  const onVisible = (): void => {
    if (document.visibilityState === 'visible') void acquireLock()
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') closeNight()
  }
  // The drift offset is computed against the viewport it was chosen in, so a
  // rotation can leave the clock hanging off the edge until the next excursion —
  // up to 45 seconds later. Re-place it immediately instead.
  const onResize = (): void => {
    if (session !== null) drift(session)
  }

  session = {
    el,
    args,
    // Autoplay policy needs a user gesture, and entering night mode is the only
    // one available — eight hours before the sound is wanted.
    ctx: createContext(),
    onVisible,
    onKey,
    onResize,
    timer: 0,
    armed: args.alarm.enabled ? nextAlarm(args.alarm, new Date()) : null,
    ringing: false,
    tone: null,
    missed: null,
    lastMinute: -1,
    driftAt: 0,
    dayKey: '',
    day: null,
    bands: [],
    next: null,
    lock: null,
  }

  el.night.hidden = false
  el.nightHint.hidden = matchMedia('(display-mode: standalone)').matches
  document.addEventListener('visibilitychange', onVisible)
  document.addEventListener('keydown', onKey)
  window.addEventListener('resize', onResize)

  void acquireLock()
  // Hides browser chrome on Android; a no-op worth attempting elsewhere. In an
  // installed PWA there is no chrome to hide, which is why the hint above exists.
  //
  // Going fullscreen can bring an implicit orientation lock with it, pinning the
  // screen to however the phone was held on the way in. That strands the one view
  // in the app that most wants to lie on its side. The manifest already asks for
  // `any`; unlocking makes fullscreen honour it. A no-op where there was no lock,
  // and unreachable on iOS, where the fullscreen call is itself a no-op.
  void el.night
    .requestFullscreen?.()
    .then(() => screen.orientation?.unlock?.())
    .catch(() => {})

  paint(session, new Date())
  drift(session)
  session.timer = window.setInterval(tick, TICK_MS)
}

export const closeNight = (): void => {
  const s = session
  if (s === null) return
  session = null

  window.clearInterval(s.timer)
  stopRing(s)
  void s.ctx?.close().catch(() => {})
  void s.lock?.release().catch(() => {})
  document.removeEventListener('visibilitychange', s.onVisible)
  document.removeEventListener('keydown', s.onKey)
  window.removeEventListener('resize', s.onResize)
  if (document.fullscreenElement !== null) void document.exitFullscreen().catch(() => {})

  s.el.night.hidden = true
  s.el.night.removeAttribute('data-ring')
  s.el.nightClock.style.transform = ''
  s.args.onClose()
}

/**
 * Tap anywhere to silence a ringing alarm, or to clear a reported miss. Silencing
 * re-arms for tomorrow rather than leaving the alarm spent.
 *
 * Returns whether there was anything to dismiss, which is what lets the caller
 * treat the same tap as "exit" once the screen is quiet.
 */
export const dismiss = (): boolean => {
  const s = session
  if (s === null || (!s.ringing && s.missed === null)) return false
  const now = new Date()
  if (s.ringing) {
    stopRing(s)
    s.armed = s.args.alarm.enabled ? nextAlarm(s.args.alarm, now) : null
  }
  s.missed = null
  paint(s, now)
  return true
}

/**
 * One interval at 1000ms, comparing against the wall clock every second.
 *
 * Deliberately not a `setTimeout` for eight hours: that drifts, gets throttled,
 * and is dropped on suspend. Re-reading the clock is self-healing and costs
 * nothing, since the clock display needs the tick anyway.
 */
const tick = (): void => {
  const s = session
  if (s === null) return
  const now = new Date()

  // 1. The clock and the background only change on the minute.
  const minute = now.getHours() * 60 + now.getMinutes()
  if (minute !== s.lastMinute) paint(s, now)

  // 2. Firing. Once ringing, stay ringing until silenced — the grace window
  //    decides whether to *start*, not how long the sound lasts.
  if (s.armed !== null && !s.ringing) {
    const state = firingState(s.armed, now, GRACE_MS)
    if (state === 'due') {
      startRing(s)
      paint(s, now)
    } else if (state === 'missed') {
      // Only reachable after a freeze: the page was asleep through the whole
      // grace window. Say so rather than silently skipping to tomorrow.
      s.missed = s.armed
      s.armed = nextAlarm(s.args.alarm, now)
      paint(s, now)
    }
  }

  // 3. A suspended context is silent with no error, so resume on the tick rather
  //    than only when arming.
  if (s.ctx !== null && s.ctx.state === 'suspended') void s.ctx.resume().catch(() => {})
  if (s.ringing) scheduleBeeps(s)

  // 4. Burn-in.
  if (now.getTime() - s.driftAt > DRIFT_MS) drift(s)
}

// ---- painting ---------------------------------------------------------

/**
 * Night mode resolves everything from `now` and **ignores `model.date`**. The
 * main app's date is wherever the user last paged to; inheriting it would compute
 * the alarm against a date weeks away and sleep the owner through it. This is the
 * worst bug available in the feature, and this comment is the guard against it.
 */
const dayNow = (s: Session, now: Date): SolarDay | null => {
  const coords = s.args.coords
  if (coords === null) return null
  const date = toLocalDate(now)
  const key = `${date.y}-${date.m}-${date.d}`
  if (s.dayKey !== key) {
    s.dayKey = key
    s.day = solarDay(date, coords)
    s.bands = bandsOf(s.day)
    s.next = null
  }
  return s.day
}

const nextEventFrom = (s: Session, day: SolarDay, now: Date, coords: Coords): Session['next'] => {
  if (s.next !== null && s.next.at.getTime() > now.getTime()) return s.next

  const soonest = (d: SolarDay): Session['next'] =>
    d.events
      .filter(isPresent)
      .filter((e) => e.at.getTime() > now.getTime())
      .sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null

  // Late in the evening the next event is tomorrow's dawn, so the search crosses
  // midnight rather than reporting nothing.
  s.next = soonest(day) ?? soonest(solarDay(addDays(toLocalDate(now), 1), coords))
  return s.next
}

const line = (text: string, className?: string): HTMLElement => {
  const div = document.createElement('div')
  if (className !== undefined) div.className = className
  div.textContent = text
  return div
}

const paint = (s: Session, now: Date): void => {
  s.lastMinute = now.getHours() * 60 + now.getMinutes()
  s.el.nightTime.textContent = formatTime(now, s.args.clock)

  const day = dayNow(s, now)
  if (day !== null) {
    const level = levelAt(s.bands, (now.getTime() - day.start.getTime()) / day.lengthMs)
    s.el.night.style.backgroundColor = `var(${BAND_VAR[level]})`
    s.el.night.dataset.surface = SURFACE[level]
  }

  const lines: HTMLElement[] = []

  if (s.ringing) lines.push(line('tap anywhere to silence', 'ring'))
  else if (s.missed !== null) lines.push(line(`alarm missed · ${formatTime(s.missed, s.args.clock)}`, 'ring'))

  lines.push(line(s.armed === null ? 'no alarm set' : `alarm ${formatTime(s.armed, s.args.clock)}`))

  // A thing that did not happen is a value you display, never a blank — Tromso in
  // December genuinely has no next sunrise, and the line still has to say something.
  const coords = s.args.coords
  if (coords === null || day === null) {
    lines.push(line('no location'))
  } else {
    const next = nextEventFrom(s, day, now, coords)
    const absences = day.events.flatMap((e) => (isPresent(e) ? [] : [{ kind: e.kind, absent: e.absent }]))
    lines.push(
      next === null
        ? line(absenceMessages(absences)[0] ?? 'no events today')
        : line(`${LABEL[next.kind].plain} ${formatTime(next.at, s.args.clock)}`),
    )
  }

  // Stands in for the Exit button this screen cannot afford. It rides inside the
  // drifting clock, so unlike a corner control it never burns in, and it is
  // suppressed while ringing — the line above already owns the tap.
  if (!s.ringing && s.missed === null) lines.push(line('tap anywhere to exit'))

  s.el.nightSub.replaceChildren(...lines)
}

/**
 * Jump to a new position rather than animating continuously: a permanently moving
 * element repaints every frame all night. The excursion is the whole free area, not
 * a jitter, or it would not prevent burn-in.
 */
const drift = (s: Session): void => {
  s.driftAt = Date.now()
  // offsetWidth is the layout box and so is unaffected by the transform already on it.
  const freeX = Math.max(0, (s.el.night.clientWidth - s.el.nightClock.offsetWidth) / 2 - 8)
  const freeY = Math.max(0, (s.el.night.clientHeight - s.el.nightClock.offsetHeight) / 2 - 8)
  const x = (Math.random() * 2 - 1) * freeX
  const y = (Math.random() * 2 - 1) * freeY
  s.el.nightClock.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
}

// ---- wake lock --------------------------------------------------------

/**
 * The lock is released automatically whenever the page hides, so it is re-acquired
 * on `visibilitychange`. Miss that and the screen quietly dies an hour in — which
 * is exactly the kind of silent failure this feature cannot afford.
 */
const acquireLock = async (): Promise<void> => {
  const s = session
  if (s === null || !('wakeLock' in navigator)) return
  try {
    const lock = await navigator.wakeLock.request('screen')
    // Night mode may have closed while the request was in flight; a lock held by a
    // dead session would keep the screen on for the rest of the day.
    if (session === s) s.lock = lock
    else void lock.release().catch(() => {})
  } catch {
    // Unsupported, denied, or not visible. A working clock without a wake lock is
    // still a clock; a crash is not.
    s.lock = null
  }
}

// ---- audio ------------------------------------------------------------

/**
 * Generated with Web Audio rather than a shipped file: no new precache asset,
 * offline by construction, and it keeps the app inside its size budget.
 */
const createContext = (): AudioContext | null => {
  try {
    const ctx = new AudioContext()
    void ctx.resume().catch(() => {})
    return ctx
  } catch {
    return null
  }
}

const startRing = (s: Session): void => {
  s.ringing = true
  s.missed = null
  s.el.night.dataset.ring = 'on'

  const ctx = s.ctx
  if (ctx === null) return
  void ctx.resume().catch(() => {})

  const gain = ctx.createGain()
  gain.gain.value = 0
  gain.connect(ctx.destination)

  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = 880
  osc.connect(gain)
  osc.start()

  s.tone = { osc, gain, since: ctx.currentTime, until: ctx.currentTime }
  scheduleBeeps(s)
}

/**
 * Beeps are scheduled a couple of seconds ahead and topped up on each tick, so a
 * throttled timer costs at most a gap rather than silence. Each beep is played at
 * whatever the swell has reached by then — see `swellGain`.
 */
const scheduleBeeps = (s: Session): void => {
  const { ctx, tone } = s
  if (ctx === null || tone === null) return

  const horizon = ctx.currentTime + 2
  while (tone.until < horizon) {
    const start = Math.max(tone.until, ctx.currentTime + 0.02)
    const level = swellGain(start - tone.since)

    for (const [offset, hz] of [
      [0, 880],
      [0.34, 660],
    ] as const) {
      const at = start + offset
      tone.osc.frequency.setValueAtTime(hz, at)
      tone.gain.gain.setValueAtTime(0, at)
      tone.gain.gain.linearRampToValueAtTime(level, at + 0.03)
      tone.gain.gain.setValueAtTime(level, at + 0.2)
      tone.gain.gain.linearRampToValueAtTime(0, at + 0.28)
    }
    tone.until = start + BEEP_PERIOD_S
  }
}

const stopRing = (s: Session): void => {
  s.ringing = false
  s.el.night.removeAttribute('data-ring')

  const { ctx, tone } = s
  s.tone = null
  if (ctx === null || tone === null) return
  try {
    const now = ctx.currentTime
    tone.gain.gain.cancelScheduledValues(now)
    tone.gain.gain.setValueAtTime(tone.gain.gain.value, now)
    tone.gain.gain.linearRampToValueAtTime(0, now + 0.05)
    tone.osc.stop(now + 0.08)
  } catch {
    /* the context may already be closing */
  }
}
