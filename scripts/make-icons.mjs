// Generates the PWA icons from one inline SVG. Run once, or after changing the
// palette:  npm run icons
//
// The mark is the app itself: a proportional day column, dark at both ends and
// bright in the middle, with the sun crossing it. Requires rsvg-convert.

import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'

const NIGHT = '#05070d'
const NAUTICAL = '#131f3c'
const CIVIL = '#35507f'
const DAY = '#93b3e0'

/** `inset` is the fraction of the canvas kept clear, for the maskable variant. */
const svg = (inset = 0) => {
  const size = 512
  const pad = size * inset
  const box = size - pad * 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="day" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${NIGHT}"/>
      <stop offset="0.20" stop-color="${NIGHT}"/>
      <stop offset="0.29" stop-color="${NAUTICAL}"/>
      <stop offset="0.37" stop-color="${CIVIL}"/>
      <stop offset="0.46" stop-color="${DAY}"/>
      <stop offset="0.54" stop-color="${DAY}"/>
      <stop offset="0.63" stop-color="${CIVIL}"/>
      <stop offset="0.71" stop-color="${NAUTICAL}"/>
      <stop offset="0.80" stop-color="${NIGHT}"/>
      <stop offset="1" stop-color="${NIGHT}"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="${NIGHT}"/>
  <rect x="${pad}" y="${pad}" width="${box}" height="${box}" rx="${inset === 0 ? 96 : 64}" fill="url(#day)"/>
  <g fill="none" stroke="${NIGHT}" stroke-opacity="0.55" stroke-width="${size * 0.012}">
    <line x1="${pad}" y1="${pad + box * 0.29}" x2="${pad + box}" y2="${pad + box * 0.29}"/>
    <line x1="${pad}" y1="${pad + box * 0.71}" x2="${pad + box}" y2="${pad + box * 0.71}"/>
  </g>
  <circle cx="${size / 2}" cy="${size / 2}" r="${box * 0.13}" fill="${NIGHT}" fill-opacity="0.82"/>
</svg>
`
}

await mkdir('public', { recursive: true })

const standard = svg(0)
// Maskable icons are cropped to a circle on some launchers, so the mark is inset
// to keep it inside the safe zone.
const maskable = svg(0.14)

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
