// The only module that touches the document. No logic beyond turning a Painting
// into elements — every rule worth testing lives in solar.ts and layout.ts.

import { formatCoords, formatDateLabel, formatDuration, formatTime, toDateInputValue, type Clock } from './format'
import { layoutDay, type Painting } from './layout'
import { absenceMessages, LABEL } from './messages'
import type { Coords, Level, LocalDate, SolarDay } from './solar'
import type { SavedLocation, Selection } from './state'

export type View = {
  readonly date: LocalDate
  readonly isToday: boolean
  readonly coords: Coords | null
  readonly locationName: string
  readonly day: SolarDay | null
  readonly clock: Clock
  /** Shown in place of coordinates while locating, or when there is no fix. */
  readonly status: string | null
}

export type Elements = ReturnType<typeof elements>

const must = <T extends Element>(selector: string): T => {
  const el = document.querySelector<T>(selector)
  if (el === null) throw new Error(`missing element: ${selector}`)
  return el
}

export const elements = () => ({
  prev: must<HTMLButtonElement>('#prev'),
  next: must<HTMLButtonElement>('#next'),
  today: must<HTMLButtonElement>('#today'),
  dateBtn: must<HTMLButtonElement>('#datebtn'),
  dateLabel: must<HTMLElement>('#datelabel'),
  datePicker: must<HTMLInputElement>('#datepicker'),
  locBtn: must<HTMLButtonElement>('#locbtn'),
  locName: must<HTMLElement>('#locname'),
  locCoords: must<HTMLElement>('#loccoords'),
  day: must<HTMLElement>('#day'),
  ticks: must<HTMLElement>('#ticks'),
  labels: must<HTMLElement>('#labels'),
  notes: must<HTMLElement>('#notes'),
  footer: must<HTMLElement>('#footer'),
  sheet: must<HTMLDialogElement>('#locsheet'),
  locOptions: must<HTMLUListElement>('#locoptions'),
  addForm: must<HTMLFormElement>('#addloc'),
  addName: must<HTMLInputElement>('#addname'),
  addLat: must<HTMLInputElement>('#addlat'),
  addLon: must<HTMLInputElement>('#addlon'),
  addError: must<HTMLElement>('#adderror'),
  clock24: must<HTMLButtonElement>('#clock24'),
  clock12: must<HTMLButtonElement>('#clock12'),
})

const BAND_VAR: Record<Level, string> = {
  night: '--night',
  nautical: '--nautical',
  civil: '--civil',
  day: '--day',
}

const gradient = (painting: Painting): string => {
  const stops = painting.stops.map((s) => `var(${BAND_VAR[s.level]}) ${(s.at * 100).toFixed(3)}%`)
  return `linear-gradient(to bottom, ${stops.join(', ')})`
}

const slotPx = (day: HTMLElement): number => {
  const raw = Number.parseFloat(getComputedStyle(day).getPropertyValue('--slot'))
  return Number.isFinite(raw) && raw > 0 ? raw : 46
}

const replace = (parent: HTMLElement, children: readonly Node[]): void => {
  parent.replaceChildren(...children)
}

export const render = (v: View, el: Elements): void => {
  el.dateLabel.textContent = formatDateLabel(v.date)
  el.datePicker.value = toDateInputValue(v.date)
  el.today.hidden = v.isToday

  el.locName.textContent = v.locationName
  el.locCoords.textContent = v.status ?? (v.coords === null ? '' : formatCoords(v.coords))

  if (v.day === null) {
    el.day.style.backgroundImage = 'linear-gradient(to bottom, var(--night), var(--night))'
    replace(el.ticks, [])
    replace(el.labels, [])
    replace(el.notes, [note(v.status ?? 'No location yet')])
    replace(el.footer, [])
    return
  }

  const height = el.day.clientHeight
  const painting = layoutDay(v.day, height, slotPx(el.day))

  el.day.style.backgroundImage = gradient(painting)

  const ticks: Node[] = []
  const labels: Node[] = []

  for (const label of painting.labels) {
    const tick = document.createElement('div')
    tick.className = 'tick'
    tick.style.top = `${label.truePx}px`
    ticks.push(tick)

    // A displaced label keeps a hairline back to where the event actually is.
    const offset = label.labelPx - label.truePx
    if (Math.abs(offset) > 2) {
      const leader = document.createElement('div')
      leader.className = 'leader'
      leader.style.top = `${Math.min(label.truePx, label.labelPx)}px`
      leader.style.height = `${Math.abs(offset)}px`
      ticks.push(leader)
    }

    const row = document.createElement('div')
    row.className = 'ev'
    row.style.top = `${label.labelPx}px`

    const time = document.createElement('span')
    time.className = 't'
    time.textContent = formatTime(label.at, v.clock)

    const copy = document.createElement('span')
    copy.className = 'l'
    const { plain, technical } = LABEL[label.kind]
    copy.append(document.createTextNode(plain))
    if (technical !== '') {
      const tech = document.createElement('span')
      tech.className = 'tech'
      tech.textContent = ` · ${technical}`
      copy.append(tech)
    }

    row.append(time, copy)
    labels.push(row)
  }

  replace(el.ticks, ticks)
  replace(el.labels, labels)
  replace(el.notes, absenceMessages(painting.absences).map(note))
  replace(el.footer, footer(v.day, painting))
}

const note = (text: string): HTMLElement => {
  const el = document.createElement('div')
  el.className = 'note'
  el.textContent = text
  return el
}

const footer = (day: SolarDay, painting: Painting): Node[] => {
  // With no events at all the durations still hold (a polar day is 24h of light,
  // a polar night is none), so the footer stays useful rather than blank.
  const parts: Array<[string, number]> = [
    ['usable', day.usableLightMs],
    ['light', day.someLightMs],
  ]
  return parts.flatMap(([label, ms], i) => {
    const span = document.createElement('span')
    span.append(document.createTextNode(`${label} `))
    const b = document.createElement('b')
    b.textContent = formatDuration(ms)
    span.append(b)
    return i === 0 ? [span] : [document.createTextNode('·'), span]
  })
}

export const renderSheet = (
  el: Elements,
  args: {
    readonly selection: Selection
    readonly locations: readonly SavedLocation[]
    readonly gps: Coords | null
    readonly clock: Clock
    readonly onPick: (selection: Selection) => void
    readonly onRemove: (id: string) => void
  },
): void => {
  const items: Node[] = []

  const option = (
    label: string,
    sub: string,
    current: boolean,
    onPick: () => void,
    onRemove?: () => void,
  ): HTMLLIElement => {
    const li = document.createElement('li')
    const pick = document.createElement('button')
    pick.type = 'button'
    pick.className = 'pick'
    pick.setAttribute('aria-current', String(current))
    const name = document.createElement('span')
    name.textContent = label
    const detail = document.createElement('span')
    detail.className = 'sub'
    detail.textContent = sub
    pick.append(name, detail)
    pick.addEventListener('click', onPick)
    li.append(pick)

    if (onRemove !== undefined) {
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'remove'
      remove.setAttribute('aria-label', `Remove ${label}`)
      remove.textContent = '✕'
      remove.addEventListener('click', onRemove)
      li.append(remove)
    }
    return li
  }

  items.push(
    option(
      'Current location',
      args.gps === null ? 'no fix yet' : formatCoords(args.gps),
      args.selection.kind === 'gps',
      () => args.onPick({ kind: 'gps' }),
    ),
  )

  for (const loc of args.locations) {
    items.push(
      option(
        loc.name,
        formatCoords({ lat: loc.lat, lon: loc.lon }),
        args.selection.kind === 'saved' && args.selection.id === loc.id,
        () => args.onPick({ kind: 'saved', id: loc.id }),
        () => args.onRemove(loc.id),
      ),
    )
  }

  replace(el.locOptions, items)
  el.clock24.setAttribute('aria-pressed', String(args.clock === 24))
  el.clock12.setAttribute('aria-pressed', String(args.clock === 12))
}
