import { registerSW } from 'virtual:pwa-register'
import { fromDateInputValue, type Clock } from './format'
import { elements, render, renderSheet, type View } from './render'
import { addDays, sameLocalDate, solarDay, toLocalDate, type Coords, type LocalDate } from './solar'
import * as store from './state'

type Model = {
  readonly date: LocalDate
  readonly selection: store.Selection
  readonly locations: readonly store.SavedLocation[]
  readonly clock: Clock
  readonly gps: Coords | null
  readonly status: string | null
}

const el = elements()

let model: Model = {
  date: toLocalDate(new Date()),
  selection: store.loadSelection(),
  locations: store.loadLocations(),
  clock: store.loadPrefs().clock,
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

const view = (m: Model): View => {
  const coords = coordsOf(m)
  return {
    date: m.date,
    isToday: sameLocalDate(m.date, toLocalDate(new Date())),
    coords,
    locationName: nameOf(m),
    day: coords === null ? null : solarDay(m.date, coords),
    clock: m.clock,
    status: m.status,
  }
}

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
  if (e.metaKey || e.ctrlKey || e.altKey || el.sheet.open) return
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
