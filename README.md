# Sundial

When is there enough light outside to see?

Six times for a date and a place: BMNT, civil dawn, sunrise, sunset, civil dusk, EENT — drawn
on a proportional vertical day. Computed on device, so it works with no signal. No backend, no
account, no notifications.

See [VISION.md](VISION.md) for what it is, what it deliberately isn't, and why each decision
went the way it did.

## Running it

```sh
npm install
npm run dev        # vite dev server
npm test           # 115 tests, no network
npm run build      # typecheck + static build into dist/
npm run preview    # serve dist/ at /sundial/
```

Two scripts are run by hand, not in CI:

```sh
npm run fixtures   # refetch USNO + cross-check reference data into tests/fixtures/
npm run icons      # regenerate PWA icons from the inline SVG (needs rsvg-convert)
```

## Layout

```
src/solar.ts     (date, coords) -> SolarDay        pure; no DOM, no Date.now()
src/layout.ts    (SolarDay, height) -> Painting    pure; owns label collision
src/render.ts    Painting -> DOM                   the only module touching the document
src/state.ts     localStorage, namespaced sundial:
src/messages.ts  all user-visible copy
src/format.ts    times, durations, dates
src/main.ts      wiring
```

`solar.ts` and `layout.ts` hold every rule worth testing and need no browser. An event that
doesn't happen is a value (`{ absent: 'always-above' | 'always-below' }`), never `null` and
never `NaN`, so no code path can print a time that isn't real.

## Deploying

Live at **https://jeffkwak.com/sundial/**

Pushes to `main` build and publish to GitHub Pages via `.github/workflows/deploy.yml`.

Three one-time settings on the repo:

1. The repo must be named **`sundial`** under the `jeff-kwak` account, so it serves at
   `/sundial/`. The account's user site is already the owner's bio, so root is not available. A
   different repo name means changing `BASE` in `vite.config.ts` — the manifest `scope` and
   `start_url` follow from there automatically.
2. Settings → Pages → **Source: GitHub Actions**. Free Pages requires a public repo.
3. Settings → Pages → **Enforce HTTPS**. Not optional: see below.

The user site carries the custom domain `jeffkwak.com` and project sites inherit it, so
`jeff-kwak.github.io/sundial/` is a redirect, not the canonical URL. The domain does *not* move
the app to root — project sites still serve from `/<repo>/` — so `base: '/sundial/'` stays
correct.

## The three things most likely to break

- **Serving over plain `http`.** Geolocation and service workers require a secure context, so on
  `http` the GPS is refused and the worker never registers: no location, no offline, no error the
  user can see. With Enforce HTTPS off, GitHub's redirect from the `github.io` host lands on
  `http://` and hands out exactly that crippled app.
- **`BASE` disagreeing with the service-worker scope.** Also silent: the PWA installs and simply
  never works offline. A worker's scope cannot exceed its own directory.
- **`localStorage` keys losing the `sundial:` prefix.** Storage is keyed by origin, and path is
  not part of origin, so this app shares storage with everything else on `jeffkwak.com`.
