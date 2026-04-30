import type {
  PresentationSlideSpec,
  PresentationSvgVisualSpec,
} from './shared/presentation'
import type { PresentationExportTheme } from './presentationThemes'

interface PresentationSvgOptions {
  theme: PresentationExportTheme
  slide: PresentationSlideSpec
  index: number
  visual?: PresentationSvgVisualSpec
}

const SVG_WIDTH = 1600
const SVG_HEIGHT = 900

function color(hex: string) {
  return `#${hex}`
}

function escapeSvgText(value: string | undefined) {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function seededNumber(seed: number) {
  const x = Math.sin(seed) * 10000
  return x - Math.floor(x)
}

function point(seed: number, min: number, max: number) {
  return Math.round(min + seededNumber(seed) * (max - min))
}

function svgShell(content: string) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}">`,
    '<defs>',
    '<filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">',
    '<feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="#000000" flood-opacity="0.22"/>',
    '</filter>',
    '<filter id="grain">',
    '<feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="2" stitchTiles="stitch"/>',
    '<feColorMatrix type="saturate" values="0"/>',
    '<feComponentTransfer><feFuncA type="table" tableValues="0 0.12"/></feComponentTransfer>',
    '</filter>',
    '</defs>',
    content,
    '</svg>',
  ].join('')
}

function orbitalSvg(options: PresentationSvgOptions) {
  const { theme, slide, visual, index } = options
  const label = escapeSvgText(visual?.label || slide.visualFocus || slide.visual.label || 'Visual system')
  return svgShell([
    `<rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="${color(theme.dark)}"/>`,
    `<circle cx="1130" cy="430" r="330" fill="${color(theme.primary)}" opacity="0.84" filter="url(#softShadow)"/>`,
    `<circle cx="1130" cy="430" r="238" fill="none" stroke="${color(theme.secondary)}" stroke-width="12" opacity="0.62"/>`,
    `<circle cx="1130" cy="430" r="142" fill="none" stroke="${color(theme.accent)}" stroke-width="4" opacity="0.45"/>`,
    `<circle cx="${930 + index * 7}" cy="222" r="36" fill="${color(theme.secondary)}"/>`,
    `<circle cx="1334" cy="610" r="24" fill="${color(theme.accent)}" opacity="0.92"/>`,
    `<path d="M750 640 C920 540 1040 720 1380 540" fill="none" stroke="${color(theme.secondary)}" stroke-width="6" opacity="0.38"/>`,
    `<text x="1128" y="446" text-anchor="middle" font-family="Georgia, serif" font-size="54" font-weight="700" fill="${color(theme.accent)}">${label.slice(0, 18)}</text>`,
    '<rect width="1600" height="900" filter="url(#grain)" opacity="0.28"/>',
  ].join(''))
}

function meshSvg(options: PresentationSvgOptions) {
  const { theme, visual, index } = options
  const seed = visual?.seed ?? index + 11
  const circles = Array.from({ length: 12 }, (_, itemIndex) => {
    const cx = point(seed + itemIndex * 3, 120, 1480)
    const cy = point(seed + itemIndex * 5, 80, 820)
    const r = point(seed + itemIndex * 7, 52, 170)
    const fill = itemIndex % 3 === 0 ? theme.primary : itemIndex % 3 === 1 ? theme.secondary : theme.accent
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color(fill)}" opacity="${itemIndex % 2 === 0 ? '0.18' : '0.11'}"/>`
  }).join('')

  return svgShell([
    `<rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="${color(theme.paper)}"/>`,
    `<path d="M0 710 C240 560 420 830 690 690 C960 548 1130 210 1600 330 L1600 900 L0 900 Z" fill="${color(theme.light)}"/>`,
    circles,
    `<path d="M120 170 L420 310 L720 188 L1030 380 L1380 248" fill="none" stroke="${color(theme.primary)}" stroke-width="5" opacity="0.28"/>`,
    `<path d="M190 710 L520 540 L820 650 L1140 462 L1460 590" fill="none" stroke="${color(theme.secondary)}" stroke-width="7" opacity="0.34"/>`,
    '<rect width="1600" height="900" filter="url(#grain)" opacity="0.16"/>',
  ].join(''))
}

function processSvg(options: PresentationSvgOptions) {
  const { theme, slide } = options
  const items = (slide.callouts?.length ? slide.callouts : slide.visual.items ?? slide.bullets).slice(0, 4)
  const cards = items.map((item, itemIndex) => {
    const x = 170 + itemIndex * 320
    const y = itemIndex % 2 === 0 ? 335 : 415
    return [
      `<rect x="${x}" y="${y}" width="242" height="150" rx="36" fill="${color(itemIndex % 2 === 0 ? theme.primary : theme.card)}" stroke="${color(theme.secondary)}" stroke-width="4" filter="url(#softShadow)"/>`,
      `<circle cx="${x + 52}" cy="${y + 56}" r="28" fill="${color(itemIndex % 2 === 0 ? theme.accent : theme.primary)}" opacity="0.95"/>`,
      `<text x="${x + 52}" y="${y + 66}" text-anchor="middle" font-family="Georgia, serif" font-size="28" font-weight="700" fill="${color(itemIndex % 2 === 0 ? theme.dark : theme.accent)}">${itemIndex + 1}</text>`,
      `<text x="${x + 95}" y="${y + 64}" font-family="Microsoft YaHei, sans-serif" font-size="28" font-weight="700" fill="${color(itemIndex % 2 === 0 ? theme.accent : theme.dark)}">${escapeSvgText(item).slice(0, 12)}</text>`,
    ].join('')
  }).join('')

  return svgShell([
    `<rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="${color(theme.paper)}"/>`,
    `<path d="M80 450 C360 260 540 610 820 420 C1080 244 1260 310 1520 218" fill="none" stroke="${color(theme.secondary)}" stroke-width="16" opacity="0.34"/>`,
    cards,
    `<rect x="0" y="0" width="1600" height="160" fill="${color(theme.light)}" opacity="0.86"/>`,
  ].join(''))
}

function networkSvg(options: PresentationSvgOptions) {
  const { theme, slide, visual } = options
  const label = escapeSvgText(visual?.label || slide.visual.label || 'Network')
  const nodes = [
    [415, 236, 78],
    [690, 420, 112],
    [1015, 270, 86],
    [1160, 622, 94],
    [560, 650, 70],
  ]
  const lines = [
    [0, 1],
    [1, 2],
    [1, 3],
    [1, 4],
    [2, 3],
    [4, 3],
  ].map(([from, to]) => {
    const a = nodes[from]
    const b = nodes[to]
    return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${color(theme.secondary)}" stroke-width="8" opacity="0.36"/>`
  }).join('')
  const circles = nodes.map(([cx, cy, r], itemIndex) =>
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color(itemIndex === 1 ? theme.primary : theme.card)}" stroke="${color(theme.secondary)}" stroke-width="5" filter="url(#softShadow)"/>`
  ).join('')

  return svgShell([
    `<rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="${color(theme.paper)}"/>`,
    `<circle cx="1220" cy="110" r="360" fill="${color(theme.light)}"/>`,
    lines,
    circles,
    `<text x="690" y="438" text-anchor="middle" font-family="Georgia, serif" font-size="46" font-weight="700" fill="${color(theme.accent)}">${label.slice(0, 12)}</text>`,
    '<rect width="1600" height="900" filter="url(#grain)" opacity="0.15"/>',
  ].join(''))
}

function architectureSvg(options: PresentationSvgOptions) {
  const { theme, slide } = options
  const layers = (slide.visual.items?.length ? slide.visual.items : slide.bullets).slice(0, 4)
  const blocks = layers.map((layer, itemIndex) => {
    const x = 350 + itemIndex * 205
    const y = 220 + itemIndex * 92
    return [
      `<rect x="${x}" y="${y}" width="460" height="92" rx="24" fill="${color(itemIndex % 2 === 0 ? theme.primary : theme.card)}" stroke="${color(theme.secondary)}" stroke-width="4" filter="url(#softShadow)"/>`,
      `<text x="${x + 34}" y="${y + 58}" font-family="Microsoft YaHei, sans-serif" font-size="31" font-weight="700" fill="${color(itemIndex % 2 === 0 ? theme.accent : theme.dark)}">${escapeSvgText(layer).slice(0, 16)}</text>`,
    ].join('')
  }).join('')

  return svgShell([
    `<rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="${color(theme.paper)}"/>`,
    `<path d="M0 0 L520 0 L340 900 L0 900 Z" fill="${color(theme.light)}"/>`,
    blocks,
    `<path d="M240 230 L340 230 L340 630 L240 630 Z" fill="none" stroke="${color(theme.secondary)}" stroke-width="10" opacity="0.32"/>`,
    `<path d="M1180 210 L1360 300 L1360 600 L1180 690 L1000 600 L1000 300 Z" fill="none" stroke="${color(theme.primary)}" stroke-width="12" opacity="0.18"/>`,
  ].join(''))
}

function radarSvg(options: PresentationSvgOptions) {
  const { theme } = options
  return svgShell([
    `<rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="${color(theme.dark)}"/>`,
    `<circle cx="820" cy="458" r="330" fill="none" stroke="${color(theme.secondary)}" stroke-width="4" opacity="0.24"/>`,
    `<circle cx="820" cy="458" r="222" fill="none" stroke="${color(theme.secondary)}" stroke-width="4" opacity="0.28"/>`,
    `<circle cx="820" cy="458" r="118" fill="none" stroke="${color(theme.secondary)}" stroke-width="4" opacity="0.34"/>`,
    `<path d="M820 458 L820 122 M820 458 L1110 290 M820 458 L1110 626 M820 458 L820 794 M820 458 L530 626 M820 458 L530 290" stroke="${color(theme.secondary)}" stroke-width="4" opacity="0.3"/>`,
    `<path d="M820 202 L1058 350 L1000 628 L790 718 L570 590 L610 314 Z" fill="${color(theme.primary)}" opacity="0.64" stroke="${color(theme.accent)}" stroke-width="8"/>`,
    `<circle cx="820" cy="458" r="24" fill="${color(theme.accent)}"/>`,
    '<rect width="1600" height="900" filter="url(#grain)" opacity="0.22"/>',
  ].join(''))
}

function burstSvg(options: PresentationSvgOptions) {
  const { theme, slide } = options
  const metric = slide.heroMetric ?? slide.visual.stats?.[0]
  return svgShell([
    `<rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="${color(theme.primary)}"/>`,
    `<circle cx="1120" cy="430" r="470" fill="${color(theme.secondary)}" opacity="0.18"/>`,
    `<circle cx="1120" cy="430" r="310" fill="${color(theme.dark)}" opacity="0.28"/>`,
    `<path d="M1120 40 L1194 340 L1492 260 L1238 446 L1480 650 L1184 566 L1120 860 L1056 566 L760 650 L1002 446 L748 260 L1046 340 Z" fill="${color(theme.accent)}" opacity="0.25"/>`,
    metric
      ? `<text x="1120" y="456" text-anchor="middle" font-family="Georgia, serif" font-size="130" font-weight="700" fill="${color(theme.accent)}">${escapeSvgText(metric.value)}</text>`
      : '',
  ].join(''))
}

function textureSvg(options: PresentationSvgOptions) {
  const { theme } = options
  return svgShell([
    `<rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="${color(theme.paper)}"/>`,
    `<path d="M0 780 C260 660 370 870 620 748 C860 630 1060 520 1600 620 L1600 900 L0 900 Z" fill="${color(theme.light)}"/>`,
    `<path d="M-80 120 C200 20 440 270 720 118 C980 -20 1230 80 1710 -24" fill="none" stroke="${color(theme.secondary)}" stroke-width="28" opacity="0.22"/>`,
    `<path d="M-120 250 C280 120 380 420 700 280 C1030 136 1280 250 1700 140" fill="none" stroke="${color(theme.primary)}" stroke-width="18" opacity="0.18"/>`,
    '<rect width="1600" height="900" filter="url(#grain)" opacity="0.18"/>',
  ].join(''))
}

export function createPresentationSvgDataUri(options: PresentationSvgOptions) {
  const kind = options.visual?.kind ?? 'mesh'
  const svg = kind === 'orbital'
    ? orbitalSvg(options)
    : kind === 'process'
      ? processSvg(options)
      : kind === 'network'
        ? networkSvg(options)
        : kind === 'architecture'
          ? architectureSvg(options)
          : kind === 'radar'
            ? radarSvg(options)
            : kind === 'burst'
              ? burstSvg(options)
              : kind === 'texture'
                ? textureSvg(options)
                : meshSvg(options)

  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
}
