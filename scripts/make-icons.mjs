// Generates the PWA icons from one inline SVG. Run once, or after changing the
// palette:  npm run icons
//
// The mark is a sun breaking the horizon: the app's twilight ramp as the sky,
// night as the ground, and the moment the question "is there light yet?" gets
// its answer. Requires rsvg-convert.

import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'

const NIGHT = '#05070d'
const NAUTICAL = '#16214a'
const CIVIL = '#3c4f86'
const WARM = '#b8734a'
const SUN = '#ffc978'
const DISC = '#fff3d8'

const SIZE = 512

/** Evenly spaced spokes on the arc from `from`° to `to`°, clockwise from east. */
const rays = (cx, cy, r0, r1, n, from, to, width) => {
  let out = ''
  for (let i = 0; i < n; i++) {
    const a = ((from + ((to - from) * i) / (n - 1)) * Math.PI) / 180
    const x1 = (cx + Math.cos(a) * r0).toFixed(1)
    const y1 = (cy + Math.sin(a) * r0).toFixed(1)
    const x2 = (cx + Math.cos(a) * r1).toFixed(1)
    const y2 = (cy + Math.sin(a) * r1).toFixed(1)
    out += `\n    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${width}"/>`
  }
  return out
}

/**
 * `horizon` is where the ground starts, as a fraction of the canvas, and `scale`
 * shrinks the sun about it. Maskable icons are cropped to a circle on some
 * launchers, so that variant pulls the sun in and centres the horizon to keep
 * everything inside the safe zone; the sky and ground still bleed to the edge.
 */
const svg = (horizon, scale) => {
  const h = SIZE * horizon
  const cx = SIZE / 2
  const cy = h + SIZE * 0.06 * scale
  const r = SIZE * 0.24 * scale
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${NIGHT}"/>
      <stop offset="0.30" stop-color="${NAUTICAL}"/>
      <stop offset="0.56" stop-color="${CIVIL}"/>
      <stop offset="0.76" stop-color="${WARM}"/>
    </linearGradient>
    <clipPath id="frame">
      <rect width="${SIZE}" height="${SIZE}" rx="112"/>
    </clipPath>
  </defs>
  <g clip-path="url(#frame)">
    <rect width="${SIZE}" height="${SIZE}" fill="url(#sky)"/>
    <g stroke="${SUN}" stroke-linecap="round">${rays(cx, cy, SIZE * 0.3 * scale, SIZE * 0.44 * scale, 7, 200, 340, (22 * scale).toFixed(1))}
    </g>
    <circle cx="${cx}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${DISC}"/>
    <rect x="0" y="${h.toFixed(1)}" width="${SIZE}" height="${(SIZE - h).toFixed(1)}" fill="${NIGHT}"/>
  </g>
</svg>
`
}

await mkdir('public', { recursive: true })

const standard = svg(0.68, 1)
const maskable = svg(0.6, 0.78)

await writeFile('public/favicon.svg', standard)
await writeFile('.icon.tmp.svg', standard)
await writeFile('.icon-maskable.tmp.svg', maskable)

const render = (src, out, size) => {
  execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), src, '-o', out])
  console.log(`wrote ${out} (${size}px)`)
}

render('.icon.tmp.svg', 'public/icon-192.png', 192)
render('.icon.tmp.svg', 'public/icon-512.png', 512)
render('.icon.tmp.svg', 'public/apple-touch-icon.png', 180)
render('.icon-maskable.tmp.svg', 'public/icon-maskable-512.png', 512)

execFileSync('rm', ['-f', '.icon.tmp.svg', '.icon-maskable.tmp.svg'])
console.log('wrote public/favicon.svg')
