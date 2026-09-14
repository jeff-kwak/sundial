import { registerSW } from 'virtual:pwa-register'
import { slotAt, STEP_MIN, type Alarm } from './alarm'
import { fromDateInputValue, type Clock } from './format'
import { closeNight, dismiss, nightIsOpen, openNight } from './night'
import { elements, render, renderAlarm, renderSheet, type View } from './render'
import { addDays, sameLocalDate, solarDay, toLocalDate, type Coords, type LocalDate, type SolarDay } from './solar'
import * as store from './state'

const MINUTES_PER_DAY = 1440

type Model = {
  readonly date: LocalDate
  readonly selection: store.Selection
  readonly locations: readonly store.SavedLocation[]
  readonly clock: Clock
  readonly alarm: Alarm
  readonly gps: Coords | null
  readonly status: string | null
}

const el = elements()

let model: Model = {
  date: toLocalDate(new Date()),
  selection: store.loadSelection(),
  locations: store.loadLocations(),
  clock: store.loadPrefs().clock,
  alarm: store.loadAlarm(),
  // A cold start with no signal still has somewhere to stand.
  gps: store.loadLastFix(),
  status: null,
}

// The selection is pulled into a local before the closure so narrowing survives
// into the callback.
const selected = (m: Model): store.SavedLocation | null => {
  const selection = m.selection
  if (selection.kind === 'gps') return null
  return m.locations.find((l) => l.id === selection.id) ?? null
}

const coordsOf = (m: Model): Coords | null => {
  const saved = selected(m)
  return saved === null ? m.gps : { lat: saved.lat, lon: saved.lon }
}

const nameOf = (m: Model): string => selected(m)?.name ?? (m.gps === null ? 'No location' : 'Current location')

// The solar search costs a few milliseconds and neither a resize nor a 5-minute
// alarm detent changes its answer, so it is memoised on the only three inputs it
// has. Without this a drag would re-run it on every pointermove.
let dayCache: { readonly key: string; readonly day: SolarDay } | null = null

const dayOf = (m: Model): SolarDay | null => {
  const coords = coordsOf(m)
  if (coords === null) return null
  const key = `${m.date.y}-${m.date.m}-${m.date.d}@${coords.lat},${coords.lon}`
  if (dayCache === null || dayCache.key !== key) dayCache = { key, day: solarDay(m.date, coords) }
  return dayCache.day
}

const view = (m: Model): View => ({
  date: m.date,
  isToday: sameLocalDate(m.date, toLocalDate(new Date())),
  coords: coordsOf(m),
  locationName: nameOf(m),
  day: dayOf(m),
  clock: m.clock,
  alarm: m.alarm,
  status: m.status,
})

const paintSheet = (): void =>
  renderSheet(el, {
    selection: model.selection,
    locations: model.locations,
    gps: model.gps,
    clock: model.clock,
    onPick: (selection) => {
      store.saveSelection(selection)
      update({ selection })
    },
    onRemove: (id) => {
      const locations = model.locations.filter((l) => l.id !== id)
      store.saveLocations(locations)
      const selection: store.Selection =
        model.selection.kind === 'saved' && model.selection.id === id ? { kind: 'gps' } : model.selection
      store.saveSelection(selection)
      update({ locations, selection })
    },
  })

const paint = (): void => {
  render(view(model), el)
  if (el.sheet.open) paintSheet()
}

const update = (patch: Partial<Model>): void => {
  model = { ...model, ...patch }
  paint()
}

// ---- location ---------------------------------------------------------

const locate = (): void => {
  if (!('geolocation' in navigator)) {
    update({ status: 'no GPS on this device' })
    return
  }
  update({ status: model.gps === null ? 'locating…' : null })

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const coords: Coords = { lat: pos.coords.latitude, lon: pos.coords.longitude }
      store.saveLastFix(coords)
      update({ gps: coords, status: null })
    },
    (err) => {
      // Twilight shifts by seconds over a kilometre, so a stale fix is a fine
      // answer. Say which one is being used rather than silently substituting.
      const denied = err.code === err.PERMISSION_DENIED
      update({
        status: denied
          ? 'location permission denied'
          : model.gps === null
            ? 'no location fix'
            : 'last known position',
      })
    },
    // 0.01 degrees is about a kilometre and worth seconds, so high accuracy
    // would spend battery for nothing.
    { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 },
  )
}


// ---- the alarm marker -------------------------------------------------

const setAlarm = (alarm: Alarm): void => {
  store.saveAlarm(alarm)
  update({ alarm })
}

el.alarmBtn.addEventListener('click', () => setAlarm({ ...model.alarm, enabled: !model.alarm.enabled }))

let dragging = false

/** The snapped minute under a pointer, or null when there is nothing to snap to. */
const minuteUnder = (clientY: number): number | null => {
  const day = dayOf(model)
  const rect = el.day.getBoundingClientRect()
  if (day === null || rect.height <= 0) return null
  return slotAt(day, (clientY - rect.top) / rect.height).minuteOfDay
}

el.alarmGrip.addEventListener('pointerdown', (e) => {
  dragging = true
  el.alarmGrip.setPointerCapture(e.pointerId)
  el.alarm.classList.add('dragging')
  renderAlarm(view(model), el, true)
  e.preventDefault()
})

el.alarmGrip.addEventListener('pointermove', (e) => {
  if (!dragging) return
  const minuteOfDay = minuteUnder(e.clientY)
  if (minuteOfDay === null || minuteOfDay === model.alarm.minuteOfDay) return
  // The line moves in 5-minute detents, which is what makes a ~2.4px slot usable —
  // it does not track the finger continuously. Only the marker is repainted; going
  // through `update` would rebuild every label between detents for nothing.
  model = { ...model, alarm: { ...model.alarm, minuteOfDay } }
  renderAlarm(view(model), el, true)
})

const endDrag = (e: PointerEvent): void => {
  if (!dragging) return
  dragging = false
  if (el.alarmGrip.hasPointerCapture(e.pointerId)) el.alarmGrip.releasePointerCapture(e.pointerId)
  el.alarm.classList.remove('dragging')
  setAlarm(model.alarm)
}

el.alarmGrip.addEventListener('pointerup', endDrag)
el.alarmGrip.addEventListener('pointercancel', endDrag)

el.alarmGrip.addEventListener('keydown', (e) => {
  const step =
    e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1
    : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? +1
    : 0
  if (step === 0) return
  // The window-level handler below steps the date on ArrowLeft/Right. While the
  // grip has focus it owns those keys, so the event must not reach the window.
  e.preventDefault()
  e.stopPropagation()
  // Clamped, not wrapped: the drag stops at the ends of the column and a key
  // press that teleported the marker from midnight to 23:55 would not read as
  // one step.
  const stepped = model.alarm.minuteOfDay + step * STEP_MIN
  const minuteOfDay = Math.min(MINUTES_PER_DAY - STEP_MIN, Math.max(0, stepped))
  if (minuteOfDay !== model.alarm.minuteOfDay) setAlarm({ ...model.alarm, minuteOfDay })
})

// ---- night mode -------------------------------------------------------

el.nightBtn.addEventListener('click', () => {
  openNight(el, {
    coords: coordsOf(model),
    alarm: model.alarm,
    clock: model.clock,
    // Night mode resolves its own dates from `now` and never reads `model.date`,
    // so nothing to hand back but a repaint.
    onClose: () => paint(),
  })
})

el.nightExit.addEventListener('click', (e) => {
  e.stopPropagation()
  closeNight()
})

// Tap anywhere else to silence. Deliberately not to exit: waking at 4am and
// swiping at the screen should stop the noise, not dismiss the clock.
el.night.addEventListener('pointerdown', () => dismiss())

// ---- date -------------------------------------------------------------

const goto = (date: LocalDate): void => update({ date })

el.prev.addEventListener('click', () => goto(addDays(model.date, -1)))
el.next.addEventListener('click', () => goto(addDays(model.date, +1)))
el.today.addEventListener('click', () => goto(toLocalDate(new Date())))

el.dateBtn.addEventListener('click', () => {
  try {
    el.datePicker.showPicker()
  } catch {
    el.datePicker.click()
  }
})

el.datePicker.addEventListener('change', () => {
  const parsed = fromDateInputValue(el.datePicker.value)
  if (parsed !== null) goto(parsed)
})

window.addEventListener('keydown', (e) => {
  // Night mode covers the screen and owns its own keys; stepping the date behind
  // it would be invisible work.
  if (e.metaKey || e.ctrlKey || e.altKey || el.sheet.open || nightIsOpen()) return
  if (e.key === 'ArrowLeft') goto(addDays(model.date, -1))
  if (e.key === 'ArrowRight') goto(addDays(model.date, +1))
})

// ---- sheet ------------------------------------------------------------

el.locBtn.addEventListener('click', () => {
  paintSheet()
  el.sheet.showModal()
  if (model.selection.kind === 'gps') locate()
})

el.addForm.addEventListener('submit', (e) => {
  e.preventDefault()
  const name = el.addName.value.trim()
  const lat = Number(el.addLat.value)
  const lon = Number(el.addLon.value)

  const problem =
    name === '' ? 'Give the place a name.'
    : !Number.isFinite(lat) || lat < -90 || lat > 90 ? 'Latitude must be between -90 and 90.'
    : !Number.isFinite(lon) || lon < -180 || lon > 180 ? 'Longitude must be between -180 and 180.'
    : null

  el.addError.hidden = problem === null
  el.addError.textContent = problem ?? ''
  if (problem !== null) return

  const location: store.SavedLocation = { id: store.newId(), name, lat, lon }
  const locations = [...model.locations, location]
  const selection: store.Selection = { kind: 'saved', id: location.id }
  store.saveLocations(locations)
  store.saveSelection(selection)
  el.addForm.reset()
  update({ locations, selection })
})

const setClock = (clock: Clock): void => {
  store.savePrefs({ clock })
  update({ clock })
}

el.clock24.addEventListener('click', () => setClock(24))
el.clock12.addEventListener('click', () => setClock(12))

// ---- repaint triggers -------------------------------------------------

// Label geometry is in pixels, so a rotation or a resized viewport needs a fresh
// layout pass. The solar data is untouched.
new ResizeObserver(() => paint()).observe(el.day)

paint()
if (model.selection.kind === 'gps') locate()

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    // The worker is only re-checked on a navigation. An installed PWA resumed from
    // the background does not navigate, which is the common case here — the app is
    // opened for a few seconds and backgrounded, rarely cold-launched — so without
    // this it could run a stale version for a long time. skipWaiting and
    // clientsClaim are already set, so a found update activates and reloads itself.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void registration?.update()
    })
  },
})
