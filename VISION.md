# Sundial — Vision

A pocket-sized PWA that answers one question: **when is there enough light outside to see?**

Today by default, any date on demand, at your GPS location or a saved one. Works with no
signal. No account, no backend, no notifications, no ads.

---

## 1. The question, precisely

"Enough light to see" is not one threshold, it's two. Both are standard, both are what the
military brackets its day with:

| Sun altitude | Standard name | Military | What you can actually do |
|---|---|---|---|
| −12° | nautical twilight | BMNT / EENT | Shapes and silhouettes only. Move over known ground; can't read, can't identify detail. |
| −6° | civil twilight | BMCT / EECT | Real usable light. Terrain clear, can read outdoors, no torch needed. |
| −0.833° | sunrise / sunset | — | Sun's upper limb meets the horizon (includes refraction + semidiameter). |

Six events per day, three mirrored pairs:

```
BMNT → civil dawn → sunrise ......... sunset → civil dusk → EENT
```

Astronomical twilight (−18°) is astronomer's business and is **excluded** — it would add two
rows that answer nobody's question.

## 2. Non-goals

Deliberately out of scope. Each was considered and cut:

- **Live "now" state / countdowns *on the day column*.** The column shows times only; you do
  the arithmetic. This was always a rule about the column, and night mode does not break it —
  that is a separate full-screen surface you opt into, where a live clock is the whole point.
- **Moon.** Phase and moonrise materially affect night visibility, but double the surface area.
- **Notifications.** Unchanged and still correct: a PWA cannot reliably schedule a future local
  notification (Notification Triggers never shipped past a flag), a service worker is killed
  after ~30s idle and cannot schedule itself, and real push needs a server, which would break
  the zero-backend, works-offline property.

  The alarm added in night mode is the **response** to that limitation, not a workaround for
  it. It is a sound played by an open page, in the foreground, with the screen on — so the app
  controls the sound and the volume, and nothing is being promised that the platform cannot
  keep. Anything that claims to fire while the app is closed would silently not fire, which is
  the same class of failure as printing a time that isn't real (success criterion #5). The
  cost — the phone must be awake on a charger all night — is accepted deliberately.
- **Multi-day tables.** One date at a time.
- **Place search / geocoding.** No external geocoder. GPS or coordinates you saved.
- **Golden hour, blue hour, solar noon, azimuths.** Not the question being asked.
- **Accounts, sync, sharing, analytics.**

## 3. Data & accuracy

**Computed on-device. No runtime API.**

The runtime authority is the standard NOAA solar-position algorithm (Meeus, *Astronomical
Algorithms*): solar declination and equation of time for the date, then solve the hour angle
for each target altitude *h*:

```
cos(H) = (sin h − sin φ · sin δ) / (cos φ · cos δ)
h ∈ { −0.833°, −6°, −12° }
```

with one refinement iteration. Agreement with USNO is ~±1 minute — below the resolution the
app displays.

**USNO is the validation authority, not the runtime dependency.** Published values from
`aa.usno.navy.mil` are committed golden fixtures in the test suite. This is a deliberate
inversion of "call an authoritative source": the USNO API requires a network and has a
history of extended outages, and an app that fails on a trail or a boat fails at exactly the
moment it's needed.

**USNO does not publish nautical twilight.** Its public one-day API returns sunrise, sunset
and *civil* twilight only, plus explicit "Object continuously above the Horizon / Twilight
Limit" states for polar days. So the −12° threshold is validated two other ways:

- The fixtures pin the whole pipeline — timezone handling, local-day windowing, threshold
  plumbing, rounding — using the four values USNO does publish. Nautical differs from those
  only by an altitude constant, on the same code path.
- `api.sunrise-sunset.org` is a **corroborating cross-check, not an authority**: an
  independent implementation that does publish −12°. Agreement to a minute or two is real
  evidence the constant is wired up correctly.

Fixtures cover 7 places × 6 dates (42 entries, all fetched and committed): mid-latitude
through all four seasons, both solstices and equinoxes, the equator, 60°N, Tromsø (69.65°N)
in both midnight sun and polar night, the southern hemisphere, past the date line, and
McMurdo (77.85°S). Separate tests cover DST transition days.

**Measured result:** every USNO value matches within 1 minute, and every USNO "continuously
above/below" state produces the correct absence.

**High latitude needs a different yardstick.** At McMurdo the sun crosses −12° at
0.0125°/minute, so a 12-minute disagreement is only 0.15° of altitude — the same error would
be seconds at mid-latitude. On 2026-09-22 there the cross-check source is itself 3 minutes
off USNO's sunset while this code is inside a minute, so above 60° the cross-check tolerance
is widened to 20 minutes rather than the algorithm being bent to match a less accurate
reference. Minutes are the wrong unit for accuracy near the poles; degrees of altitude are
the real quantity.

### Stated limits

- **Sea-level horizon, standard refraction.** Real terrain — a ridge line, a tree line, a
  valley floor — shifts *your experienced* sunrise by minutes, and no model fixes that. The
  app will say so rather than imply precision it doesn't have. Observer elevation is not an
  input in v1.
- **Rounded to the minute.** No seconds; the model doesn't earn them.
- **±1 minute vs USNO** is the accepted tolerance.

## 4. Interface

24-hour clock by default (overridable to 12h). System theme — the gradient carries two
palettes, and the chrome and text flip with the OS setting.

### The screen

A **proportional vertical day**: full-bleed gradient, local midnight at the top to local
midnight at the bottom, four bands whose six boundaries *are* the six times. Times are pinned
at their true clock position. The colour carries the meaning; the labels are quiet.

```
╭──────────────────────────────╮
│  ‹    Mon 17 Aug 2026      › │   date: ‹ › steps a day
│  ⌖ Home · 44.98°N 93.27°W    │   tap date → native picker
├──────────────────────────────┤   tap location → GPS / saved sheet
│██████████████████████████████│
│██████████████████████████████│   night        (below −12°)
│▓▓▓▓▓▓ 05:12 ────────────▓▓▓▓▓│   ← BMNT       shapes appear · BMNT
│▒▒▒▒▒▒ 05:52 ────────────▒▒▒▒▒│   ← civil dawn usable light · civil
│░░░░░░ 06:24 ────────────░░░░░│   ← sunrise
│                              │
│                              │
│            (day)             │
│                              │
│                              │
│░░░░░░ 19:58 ────────────░░░░░│   ← sunset
│▒▒▒▒▒▒ 20:31 ────────────▒▒▒▒▒│   ← civil dusk
│▓▓▓▓▓▓ 21:10 ────────────▓▓▓▓▓│   ← EENT
│██████████████████████████████│
│██████████████████████████████│
├──────────────────────────────┤
│  usable 14h 39m · light 15h 58m │
╰──────────────────────────────╯
```

The proportional scale is the point: **August and December look visibly different**, and the
narrowness of the twilight bands against the day is itself information.

Four bands — night, nautical, **civil rendered warm**, day — because twilight is the warm part
of the sky and the colour should say so. A quiet 3-hourly scale runs down the column with small
numerals; marks that would crowd a time are dropped. Without it the day band is a featureless
slab and the proportional scale is invisible — the marks are what make "this column is 24 hours"
legible, so they are information, not decoration.

### Labels

Time is primary and large. Beside it, small and quieter: plain term then technical term —
`shapes appear · BMNT`, `usable light · civil`. The gradient explains what it means; the text
exists so a reading can be cross-checked against a published USNO table.

**Ink comes from the band, and the band colours differ per theme while each level's light-or-dark
character does not** — night is dark and day is pale in both. So the two ink values are
theme-independent, sampled from the band the label landed on rather than the OS setting. That is
what lets the times sit directly on the gradient with no plaque covering it.

**But ink alone cannot carry a dawn label, and this is the subtle part.** The civil band is
about 30 minutes — under 2% of the column, thinner than a single label — and all three dawn
events fall inside roughly 40px of a phone-height column, so collision spreading throws their
labels across ~130px. A label therefore routinely sits over bands of *both* characters at once,
and its 12px secondary text lands on the pale strip while its 28px time spans both. No single
ink is safe for all of one label's text. Sampling the dominant band across the label's full
height helps but cannot fix it; halos alone only patch it.

The fix is a **scrim that fades out to the right**: it backs the text where the text actually is
and leaves the right of the column, and all the space between labels, showing the gradient
untouched. It is not the opaque full-width plaque this design started with and rejected — that
one hid the graphic that is the whole point.

### Label collision — the one hard layout problem

BMNT and civil dawn are typically 30–45 minutes apart: ~2% of a 24-hour column, roughly 10px
on a phone. They collide every single day, at both ends.

Rule: the **gradient stays truly proportional**; only labels move. Each label claims a minimum
vertical slot (≥ one tap target). Where true positions fall closer than that, the labels in
the cluster displace symmetrically outward from their shared midpoint, and a hairline tick
remains at each true position connecting label to band edge. Never compress the gradient to
make room for text, and never let a label sit at a time that isn't its own.

The algorithm must be one that *terminates*, not one that iterates and hopes. Labels are
placed as groups centred on the mean of their members' true positions; sweep forward and,
whenever a new group overlaps the previous one, merge the two and re-centre, repeating
backwards. Each merge strictly reduces the group count, so it converges.

The first implementation instead looped to a fixed point, detecting clusters from
already-moved positions while re-centring on original means. Group membership changed between
passes, it oscillated, and the iteration cap silently returned a half-spread result —
overlapping labels on any real winter day. A capped loop here hides a non-convergent
algorithm rather than bounding a convergent one. The regression test pins the measured
geometry that exposed it.

### Chrome

- **Date:** `‹` `›` step one day. Tap the date for the native picker. A `Today` affordance
  appears only when off today. Any date, no artificial range limit.
- **Location:** one line under the date showing name and coordinates. Tap for a sheet:
  current GPS position, plus saved named coordinates. Manual lat/lon entry to create one.
- **Times are shown in the device's current timezone.** Correct local times for a saved
  location in another timezone needs a bundled tz dataset (~100KB+); deferred, and the app
  should not silently mislead about it.

### The alarm marker

A draggable dashed line on the day column, setting a wake time as an ordinary wall-clock time
snapped to a **5-minute grid**. You place it by eye against the bands — which is how "half an
hour before sunrise" gets expressed — and a readout in the free right lane names the time and
its relation to the nearest event (`05:30 · 28m before sunrise`) while the thumb is down. That
relation is derived for display and never stored: the alarm is absolute, because an alarm
clock is absolute. You want 06:00, not "whenever dawn happens to be".

The grid is built by stepping real time from local midnight, so a 23-hour day has 276 slots and
a 25-hour day 300, and the marker stays glued to the hour ticks on both.

At rest the marker sits at the same wall-clock height on every date you page to while the bands
slide underneath it. That is not a bug to fix. It is the clearest demonstration the app has of
what it is for: you watch a 06:00 alarm move from daylight into darkness across the autumn.

### Night mode

A full-screen tent/nightstand clock, entered from the location row, that holds a screen wake
lock, shows the time in large drifting numerals against **the current light level's colour**,
and sounds the alarm. The background is the app's central claim — the colour carries the
meaning — sampled at *now* instead of across 24 hours, which also makes the screen genuinely
dark at 03:00 without a separate dim setting.

It resolves everything from the real clock and deliberately **ignores the date you paged to**;
inheriting it would compute the alarm against a date weeks away and sleep you through it. Its
secondary line names the next solar event, and that event can be absent — Tromsø in December
has no next sunrise — so it follows the same rule as everything else: a thing that did not
happen is a value you display, never a blank.

## 5. Edge cases (real, not theoretical)

Above ~60° in summer these happen constantly, and every one is an explicit rendered state —
never a blank, a dash, or a plausible-looking wrong number:

- Sun never sets → column is entirely day, "sun does not set".
- Sun never rises → no sunrise/sunset; twilight events may still exist.
- Civil twilight never ends → morning and evening civil bands merge into one continuous band;
  "usable light all night".
- Nautical twilight never ends → "never fully dark".
- Sun never reaches −12° / −6° → those events simply don't exist for the date; the band does
  not appear and no time is printed.
- **DST transition days are 23 or 25 hours.** The column scales to the actual local day
  length; it is not hardcoded to 1440 minutes.

## 6. Success criteria

1. Open it cold with no network and get today's six times at your position in under 2 seconds.
2. Every printed time is within 1 minute of USNO's published value for that date and place.
3. Installs to the home screen and launches as a standalone app on iOS and Android.
4. Nothing to log into, nothing to configure before first use.
5. No screen ever shows a time that isn't real.

## 7. Open questions

- Keep the duration footer (`usable 15h 02m · light 16h 20m`), or strip to times only?
- Should labels be hideable once learned, or always visible?
- Should the day band brighten toward solar noon? It would stop the band being a flat slab, but
  it adds a gradient stop that is not one of the six events, which muddies "every boundary is a
  time". **Partly answered by the alarm marker:** a line across the day band gives it something
  to be besides a flat slab, without adding a stop that is not one of the six.
- Is a 5-minute detent the right feel in the hand, or is 10 minutes (`STEP_MIN`, ~4.9px per
  slot instead of ~2.4px) easier to hit? One constant either way.
- Night mode has been checked in a headless browser at 390×844 and 844×390. It wants a night on
  real hardware in a tent, which is the only way to learn whether the drift excursion is enough
  to matter and whether the alarm is loud enough to wake anyone.
- The palette is implemented and checked in both themes, but only in a desktop browser at
  390×844. It wants a look on real hardware, outdoors, at 05:00.

## 8. Tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript, strict |
| Build | Vite → static output |
| Framework | **none** — vanilla TS |
| Solar math | `astronomy-engine` (2.1.19) — the only runtime dependency |
| Styling | plain CSS, custom properties, computed gradient stops |
| PWA | `vite-plugin-pwa` (Workbox) |
| Dates | plain `Date` + ~30 lines of local-date helpers |
| Persistence | `localStorage` |
| Tests | Vitest + committed USNO fixtures |
| Host | GitHub Pages via Actions, at `https://jeffkwak.com/sundial/` (HTTPS mandatory — see below) |

### Explicit non-dependencies

No framework, no date library, no CSS framework, no Next.js, no backend, no analytics.
Each was considered; each would cost more than the app.

**On Next.js specifically:** no server, no data fetching, no routing, one screen. SSR and RSC
buy nothing here and the baseline JS would exceed the entire application.

### Hosting

**GitHub Pages, deployed by GitHub Actions.** The repo is the deploy target; there is no second
account or platform in the loop. The app needs exactly three things from a host — static files,
HTTPS, and correct MIME types — and Pages provides all three. Preview URLs, rollbacks, edge
functions and header configuration are the things a platform host adds, and this app uses none
of them.

Constraints that follow, in order of how much they matter:

- **Live at `https://jeffkwak.com/sundial/`.** Served as a Pages *project site*: the account's
  user site is already the owner's bio and there is only one per account, so root is unavailable.
  Project sites are unlimited and independent, so this coexists with the bio without interaction.
  The user site carries the custom domain `jeffkwak.com`, and project sites inherit it, so
  `jeff-kwak.github.io/sundial/` is only a redirect — not the canonical address.
- **HTTPS is a correctness requirement, not a preference.** Geolocation and service workers both
  demand a secure context, so over plain `http` the GPS is refused and the worker never
  registers — the app loses both its location input and its entire offline capability, silently
  and with no error the user would see. **Pages → Enforce HTTPS must stay on**; with it off,
  GitHub's redirect from the `github.io` host lands on `http://` and serves a quietly crippled
  app to anyone who follows that link.
- **The non-root base path is a code concern, not a config detail.** `base: '/sundial/'` in
  Vite, manifest `start_url` and `scope` both `/sundial/`, and the service worker emitted to
  `/sundial/sw.js` so that its scope is legal — a service worker's scope cannot exceed its own
  directory. These must agree; if they don't, the PWA installs and then never works offline,
  silently failing the app's central promise. No absolute asset paths may be hardcoded
  anywhere — every URL goes through Vite so `base` rewriting applies.
- **`localStorage` is keyed by origin, and path is not part of origin.** Sundial shares
  `jeffkwak.com` with the bio site and any future project site. All keys are therefore
  namespaced `sundial:` — without that they will eventually collide.
- **A custom domain does not remove the base path** — an earlier draft of this document claimed it
  would, and that was wrong. Because the domain is attached to the *user site*, project sites
  still serve from `/<repo>/`, so `base: '/sundial/'` remains correct under `jeffkwak.com`. Only a
  dedicated subdomain pointed at this repo (`sundial.jeffkwak.com`) would move it to root, and
  that would then require changing `BASE` in `vite.config.ts` to `'/'`.
- **No custom response headers.** No `Cache-Control` control; CSP only via `<meta>`. Harmless
  here: Vite content-hashes assets and Workbox owns the cache, so the default short max-age on
  the shell is exactly what's wanted.
- **Free Pages requires a public repo.** A private repo needs a paid plan.

Non-issues, recorded so they don't get relitigated: no SPA fallback is needed (one page, no
client routing), and the 1GB site / 100GB-per-month limits are irrelevant at this size.

### Architecture — pure core, thin shell

```
solar.ts    (date, coords) → SolarDay          pure, no DOM, no Date.now()
layout.ts   (SolarDay, height) → Painting      pure; owns collision resolution
render.ts   Painting → DOM                     the only module that touches the document
state.ts    State + localStorage               saved locations, 12/24h preference
format.ts   time → string                      12/24h, minute resolution
main.ts     wire: state change → render
```

`solar.ts` and `layout.ts` hold every rule worth testing and are testable without a browser.
`render.ts` holds no logic. The whole app is `(date, location) → six times → DOM`.

### Modelling absent events

An event that does not occur is a **first-class value, not `null` and never `NaN`** — this is
the single most important type in the app, because §5 is entirely about days when events don't
exist:

```ts
type SolarEvent =
  | { kind: EventKind; at: Date; fraction: number }
  | { kind: EventKind; absent: 'always-above' | 'always-below' }
```

The absence reason is which *side* of the threshold the sun stayed on, not a pre-written
sentence. Copy is derived from `(kind, reason)` at render time — `sunrise` + `always-below`
is "sun does not rise", `bmnt` + `always-above` is "never fully dark" — which keeps wording
out of the domain and matches how USNO reports the same conditions. There is no code path
that can print a fabricated time, which is success criterion #5.

### Why astronomy-engine

- `SearchAltitude` returns `null` — not `NaN` — when a threshold is never crossed. That maps
  directly onto the `absent` variant above and is why `suncalc` was rejected.
- Accuracy is far better than the ±1 min tolerance, so the fixtures test *our* code, not the
  library's ephemeris.
- Correct function per event type: **`SearchRiseSet`** for sunrise/sunset (it accounts for
  refraction and solar semidiameter, i.e. upper limb at −0.833°), **`SearchAltitude` at −6°
  and −12°** for the twilights (geometric centre, no refraction — which is the actual
  definition). Using one function for all six would be wrong by minutes.
- Cost, measured rather than budgeted: the standalone minified library is 49KB gzipped, but
  Vite tree-shakes its ESM build down hard because only the solar paths are reachable. The
  **entire app — application code and library together — is 29KB gzipped JS**, in a 97KB
  precache. That is better than the 40–60KB budgeted before measuring.

### Updates

Silent and automatic, no "new version" prompt: a push changes the asset hashes and the precache
revisions, so `sw.js` differs, and `skipWaiting` + `clientsClaim` let the new worker take over at
once instead of waiting for every client to close.

The subtlety is *when* the worker gets re-checked. Browsers only revalidate it on a navigation —
and an installed PWA resumed from the background does not navigate. That is the common case for
this app, which gets opened for a few seconds and backgrounded rather than cold-launched, so it
could otherwise run a stale version indefinitely. Hence an explicit `registration.update()` on
`visibilitychange`. Updates still require network, by design: offline launches serve the cache,
which is the entire point.

### Gradient

One element, one `linear-gradient(to bottom, …)` whose stop percentages are computed from the
six event times as a fraction of the actual local day length. Proportionality is structural —
the percentage *is* the time — so it cannot drift from the data, and DST's 23/25-hour days
need no special case. Band colours are custom properties with light and dark palettes behind
`prefers-color-scheme`.

### Testing

- `solar.ts` against committed USNO fixtures (§3), asserting ±1 minute.
- `solar.ts` against the §5 edge cases, asserting the correct `absent` variant.
- `layout.ts` unit tests for collision resolution: labels never overlap, ticks stay at true
  positions, gradient stops are never displaced.
- The USNO fetch is a one-time script; its output is checked in. CI never touches the network.

