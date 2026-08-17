// One-time fixture fetch. Output is committed; CI never touches the network.
//
//   npm run fixtures
//
// Two sources, with different standing:
//
//   USNO (aa.usno.navy.mil) is the authority. Its public one-day API exposes
//   sunrise, sunset and *civil* twilight only — there is no nautical twilight in
//   it — plus explicit "continuously above the horizon / twilight limit" states,
//   which is exactly the absence model the app uses.
//
//   sunrise-sunset.org is a corroborating cross-check, not an authority. It is an
//   independent implementation and it does publish nautical twilight, so an
//   agreement to a minute or two is real evidence about the -12 threshold that
//   USNO cannot give us.
//
// All requests use tz=0 and UTC output so fixtures are timezone-free.

import { writeFile, mkdir } from 'node:fs/promises'

const PLACES = [
  { place: 'Minneapolis', lat: 44.98, lon: -93.27 },
  { place: 'Equator/Greenwich', lat: 0, lon: 0 },
  { place: 'Helsinki', lat: 60.17, lon: 24.94 },
  { place: 'Tromso', lat: 69.65, lon: 18.96 },
  { place: 'Sydney', lat: -33.87, lon: 151.21 },
  { place: 'Suva', lat: -18.14, lon: 178.44 },
  { place: 'McMurdo', lat: -77.85, lon: 166.67 },
]

const DATES = ['2026-03-20', '2026-06-21', '2026-09-22', '2026-12-21', '2026-08-17', '2026-05-15']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PHEN = {
  'Begin Civil Twilight': 'civilDawn',
  Rise: 'sunrise',
  Set: 'sunset',
  'End Civil Twilight': 'civilDusk',
}

const CONTINUOUS = {
  'Object continuously above the Horizon': 'above-horizon',
  'Object continuously below the Horizon': 'below-horizon',
  'Object continuously above the Twilight Limit': 'above-twilight',
  'Object continuously below the Twilight Limit': 'below-twilight',
}

const usno = async ({ lat, lon }, date) => {
  const url = `https://aa.usno.navy.mil/api/rstt/oneday?date=${date}&coords=${lat},${lon}&tz=0`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`USNO ${res.status} for ${date} ${lat},${lon}`)
  const body = await res.json()
  const sundata = body?.properties?.data?.sundata ?? []

  const events = {}
  const continuous = []
  for (const { phen, time } of sundata) {
    if (PHEN[phen] !== undefined) events[PHEN[phen]] = time
    if (CONTINUOUS[phen] !== undefined) continuous.push(CONTINUOUS[phen])
  }
  return { events, continuous, raw: sundata }
}

const crosscheck = async ({ lat, lon }, date) => {
  const url = `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&date=${date}&formatted=0&tzid=UTC`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`sunrise-sunset ${res.status} for ${date} ${lat},${lon}`)
  const body = await res.json()
  if (body.status !== 'OK') return { status: body.status }
  const r = body.results
  return {
    status: 'OK',
    nauticalDawn: r.nautical_twilight_begin,
    nauticalDusk: r.nautical_twilight_end,
    civilDawn: r.civil_twilight_begin,
    civilDusk: r.civil_twilight_end,
    sunrise: r.sunrise,
    sunset: r.sunset,
  }
}

const out = []
for (const place of PLACES) {
  for (const date of DATES) {
    process.stdout.write(`${place.place} ${date} … `)
    try {
      const [a, b] = [await usno(place, date), await crosscheck(place, date)]
      out.push({ ...place, date, usno: a, crosscheck: b })
      console.log('ok')
    } catch (err) {
      console.log(`FAILED: ${err.message}`)
    }
    await sleep(400)
  }
}

await mkdir('tests/fixtures', { recursive: true })
await writeFile('tests/fixtures/reference.json', `${JSON.stringify(out, null, 2)}\n`)
console.log(`\nwrote tests/fixtures/reference.json — ${out.length} entries`)
