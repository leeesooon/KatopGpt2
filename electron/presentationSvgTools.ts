import { getPresentationTheme, type PresentationExportTheme } from './presentationThemes'
import { type PresentationThemeId } from './shared/presentation'

export type PresentationSemanticSvgKind =
  | 'learningGoals'
  | 'conceptMap'
  | 'processPath'
  | 'caseCompare'
  | 'practiceChecklist'
  | 'ambientTexture'

export interface PresentationSvgBox {
  x: number
  y: number
  w: number
  h: number
}

export interface PresentationSvgToolOptions {
  title?: string
  label?: string
  items?: unknown
  theme?: Partial<PresentationExportTheme>
  opacity?: number
  accentIndex?: number
}

interface PresentationSvgToolInput {
  themeId?: PresentationThemeId
}

interface PresentationToolSlide {
  addImage: (options: Record<string, unknown>) => unknown
  addShape?: (shapeName: string, options?: Record<string, unknown>) => unknown
  addText?: (text: string, options?: Record<string, unknown>) => unknown
}

type ResolvedSvgTheme = Pick<
  PresentationExportTheme,
  'primary' | 'secondary' | 'accent' | 'dark' | 'light' | 'paper' | 'muted' | 'card'
>

const SVG_W = 1200
const SVG_H = 720
const SVG_KINDS: PresentationSemanticSvgKind[] = [
  'learningGoals',
  'conceptMap',
  'processPath',
  'caseCompare',
  'practiceChecklist',
  'ambientTexture',
]

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function normalizeHex(value: string | undefined, fallback: string) {
  const raw = String(value ?? '').replace(/^#/, '').trim()
  return /^[0-9a-f]{6}$/i.test(raw) ? raw.toUpperCase() : fallback
}

function resolveTheme(input: PresentationSvgToolInput, options: PresentationSvgToolOptions): ResolvedSvgTheme {
  const base = getPresentationTheme(input.themeId ?? 'executive-midnight')
  return {
    primary: normalizeHex(options.theme?.primary, base.primary),
    secondary: normalizeHex(options.theme?.secondary, base.secondary),
    accent: normalizeHex(options.theme?.accent, base.accent),
    dark: normalizeHex(options.theme?.dark, base.dark),
    light: normalizeHex(options.theme?.light, base.light),
    paper: normalizeHex(options.theme?.paper, base.paper),
    muted: normalizeHex(options.theme?.muted, base.muted),
    card: normalizeHex(options.theme?.card, base.card),
  }
}

function color(value: string) {
  return `#${value}`
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function clipText(value: unknown, maxChars: number) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`
}

function normalizeItems(value: unknown, fallback: string[], maxItems = 5) {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\n，、]/)
      : []
  const items = source
    .map((item) => clipText(item, 18))
    .filter(Boolean)
    .slice(0, maxItems)

  return items.length > 0 ? items : fallback.slice(0, maxItems)
}

function svgText(value: unknown, x: number, y: number, size: number, fill: string, extra = '') {
  const text = escapeXml(clipText(value, 22))
  if (!text) return ''
  return `<text x="${x}" y="${y}" font-family="Microsoft YaHei, Arial, sans-serif" font-size="${size}" font-weight="700" fill="${fill}" ${extra}>${text}</text>`
}

function svgShell(content: string, options: PresentationSvgToolOptions) {
  const opacity = clamp(options.opacity ?? 1, 0.08, 1)
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}">`,
    '<defs>',
    '<filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">',
    '<feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000000" flood-opacity="0.12"/>',
    '</filter>',
    '<pattern id="pinGrid" width="64" height="64" patternUnits="userSpaceOnUse">',
    '<circle cx="4" cy="4" r="3" fill="#111111" opacity="0.08"/>',
    '</pattern>',
    '</defs>',
    `<g opacity="${opacity}">`,
    content,
    '</g>',
    '</svg>',
  ].join('')
}

function toSvgData(svg: string) {
  return `image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
}

function renderAmbientTexture(theme: ResolvedSvgTheme, options: PresentationSvgToolOptions) {
  const primary = color(theme.primary)
  const secondary = color(theme.secondary)
  const light = color(theme.light)
  return svgShell([
    `<rect width="${SVG_W}" height="${SVG_H}" rx="48" fill="${light}" opacity="0.42"/>`,
    '<rect width="1200" height="720" fill="url(#pinGrid)" opacity="0.28"/>',
    `<path d="M-80 560 C180 420 300 650 560 500 C760 386 930 412 1280 250" fill="none" stroke="${primary}" stroke-width="26" opacity="0.08"/>`,
    `<path d="M-40 190 C220 68 426 118 600 220 C790 332 1006 294 1248 120" fill="none" stroke="${secondary}" stroke-width="14" opacity="0.14"/>`,
    `<circle cx="1030" cy="146" r="150" fill="${secondary}" opacity="0.12"/>`,
    `<circle cx="1030" cy="146" r="96" fill="none" stroke="${primary}" stroke-width="8" opacity="0.13"/>`,
    `<circle cx="162" cy="610" r="118" fill="${primary}" opacity="0.07"/>`,
  ].join(''), options)
}

function renderLearningGoals(theme: ResolvedSvgTheme, options: PresentationSvgToolOptions) {
  const items = normalizeItems(options.items, ['01', '02', '03'], 3)
  const title = clipText(options.title ?? options.label ?? 'Goals', 18)
  const cardW = 318
  const gap = 42
  const startX = 82
  return svgShell([
    `<rect x="28" y="28" width="1144" height="664" rx="56" fill="${color(theme.paper)}" opacity="0.94"/>`,
    `<path d="M96 138 H1092" stroke="${color(theme.secondary)}" stroke-width="5" opacity="0.26"/>`,
    svgText(title, 92, 104, 32, color(theme.dark)),
    ...items.map((item, index) => {
      const x = startX + index * (cardW + gap)
      const accent = index === (options.accentIndex ?? 0) ? theme.primary : theme.secondary
      return [
        `<rect x="${x}" y="186" width="${cardW}" height="376" rx="36" fill="${color(theme.card)}" filter="url(#softShadow)"/>`,
        `<circle cx="${x + 70}" cy="262" r="38" fill="${color(accent)}"/>`,
        svgText(String(index + 1).padStart(2, '0'), x + 46, 274, 30, color(index === (options.accentIndex ?? 0) ? theme.accent : theme.dark)),
        `<path d="M${x + 54} 430 L${x + 130} 506 L${x + 266} 340" fill="none" stroke="${color(accent)}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" opacity="0.20"/>`,
        svgText(item, x + 44, 620, 28, color(theme.dark)),
      ].join('')
    }),
  ].join(''), options)
}

function renderConceptMap(theme: ResolvedSvgTheme, options: PresentationSvgToolOptions) {
  const items = normalizeItems(options.items, ['Core', 'Input', 'Action', 'Review', 'Output'], 5)
  const title = clipText(options.title ?? options.label ?? items[0], 16)
  const nodes = [
    [182, 170],
    [936, 152],
    [1010, 520],
    [230, 548],
    [600, 608],
  ] as const
  return svgShell([
    `<rect x="24" y="24" width="1152" height="672" rx="58" fill="${color(theme.paper)}" opacity="0.96"/>`,
    `<circle cx="600" cy="346" r="148" fill="${color(theme.primary)}" opacity="0.96" filter="url(#softShadow)"/>`,
    `<circle cx="600" cy="346" r="204" fill="none" stroke="${color(theme.secondary)}" stroke-width="8" opacity="0.2"/>`,
    ...nodes.map(([x, y]) => `<path d="M600 346 L${x} ${y}" stroke="${color(theme.secondary)}" stroke-width="6" opacity="0.28"/>`),
    svgText(title, 500, 356, 34, color(theme.accent), 'text-anchor="middle"'),
    ...nodes.map(([x, y], index) => [
      `<rect x="${x - 106}" y="${y - 44}" width="212" height="88" rx="30" fill="${color(theme.card)}" filter="url(#softShadow)"/>`,
      `<circle cx="${x - 70}" cy="${y}" r="18" fill="${color(index % 2 === 0 ? theme.primary : theme.secondary)}"/>`,
      svgText(items[index] ?? `Node ${index + 1}`, x - 38, y + 9, 24, color(theme.dark)),
    ].join('')),
  ].join(''), options)
}

function renderProcessPath(theme: ResolvedSvgTheme, options: PresentationSvgToolOptions) {
  const items = normalizeItems(options.items, ['Step 1', 'Step 2', 'Step 3', 'Step 4'], 4)
  const points = [
    [118, 488],
    [386, 270],
    [664, 432],
    [952, 206],
  ] as const
  return svgShell([
    `<rect x="24" y="24" width="1152" height="672" rx="58" fill="${color(theme.paper)}" opacity="0.94"/>`,
    `<path d="M82 534 C224 448 250 296 386 270 S534 460 664 432 S800 244 1004 184" fill="none" stroke="${color(theme.primary)}" stroke-width="22" stroke-linecap="round" opacity="0.18"/>`,
    `<path d="M82 534 C224 448 250 296 386 270 S534 460 664 432 S800 244 1004 184" fill="none" stroke="${color(theme.secondary)}" stroke-width="6" stroke-linecap="round" stroke-dasharray="18 18" opacity="0.7"/>`,
    ...points.map(([x, y], index) => [
      `<circle cx="${x}" cy="${y}" r="58" fill="${color(theme.card)}" filter="url(#softShadow)"/>`,
      `<circle cx="${x}" cy="${y}" r="38" fill="${color(index === 0 ? theme.primary : theme.secondary)}"/>`,
      svgText(String(index + 1), x - 10, y + 10, 28, color(index === 0 ? theme.accent : theme.dark)),
      svgText(items[index], x - 84, y + 104, 24, color(theme.dark)),
    ].join('')),
  ].join(''), options)
}

function renderCaseCompare(theme: ResolvedSvgTheme, options: PresentationSvgToolOptions) {
  const items = normalizeItems(options.items, ['Before', 'After', 'Risk', 'Action'], 4)
  return svgShell([
    `<rect x="24" y="24" width="1152" height="672" rx="58" fill="${color(theme.paper)}" opacity="0.96"/>`,
    `<rect x="88" y="120" width="456" height="460" rx="42" fill="${color(theme.card)}" filter="url(#softShadow)"/>`,
    `<rect x="656" y="120" width="456" height="460" rx="42" fill="${color(theme.light)}" filter="url(#softShadow)"/>`,
    `<path d="M574 208 L626 260 L574 312" fill="none" stroke="${color(theme.primary)}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>`,
    svgText(items[0], 136, 196, 30, color(theme.dark)),
    svgText(items[1], 704, 196, 30, color(theme.primary)),
    ...[0, 1, 2].map((row) => [
      `<rect x="138" y="${262 + row * 78}" width="${300 - row * 36}" height="22" rx="11" fill="${color(theme.secondary)}" opacity="${0.28 + row * 0.08}"/>`,
      `<rect x="706" y="${262 + row * 78}" width="${256 + row * 54}" height="22" rx="11" fill="${color(theme.primary)}" opacity="${0.26 + row * 0.08}"/>`,
    ].join('')),
    svgText(items[2], 136, 524, 24, color(theme.muted)),
    svgText(items[3], 704, 524, 24, color(theme.muted)),
  ].join(''), options)
}

function renderPracticeChecklist(theme: ResolvedSvgTheme, options: PresentationSvgToolOptions) {
  const items = normalizeItems(options.items, ['Check 1', 'Check 2', 'Check 3', 'Check 4'], 4)
  return svgShell([
    `<rect x="24" y="24" width="1152" height="672" rx="58" fill="${color(theme.paper)}" opacity="0.96"/>`,
    `<rect x="92" y="92" width="1016" height="536" rx="46" fill="${color(theme.card)}" filter="url(#softShadow)"/>`,
    ...items.map((item, index) => {
      const y = 164 + index * 104
      return [
        `<rect x="154" y="${y - 42}" width="892" height="74" rx="28" fill="${color(index % 2 === 0 ? theme.light : theme.paper)}"/>`,
        `<circle cx="206" cy="${y - 5}" r="24" fill="${color(theme.primary)}"/>`,
        `<path d="M194 ${y - 5} L203 ${y + 7} L222 ${y - 18}" fill="none" stroke="${color(theme.accent)}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`,
        svgText(item, 254, y + 4, 27, color(theme.dark)),
      ].join('')
    }),
  ].join(''), options)
}

function renderSemanticSvg(kind: PresentationSemanticSvgKind, theme: ResolvedSvgTheme, options: PresentationSvgToolOptions) {
  if (kind === 'learningGoals') return renderLearningGoals(theme, options)
  if (kind === 'processPath') return renderProcessPath(theme, options)
  if (kind === 'caseCompare') return renderCaseCompare(theme, options)
  if (kind === 'practiceChecklist') return renderPracticeChecklist(theme, options)
  if (kind === 'ambientTexture') return renderAmbientTexture(theme, { ...options, opacity: options.opacity ?? 0.55 })
  return renderConceptMap(theme, options)
}

function normalizeKind(kind: unknown): PresentationSemanticSvgKind {
  return SVG_KINDS.includes(kind as PresentationSemanticSvgKind)
    ? kind as PresentationSemanticSvgKind
    : 'conceptMap'
}

function normalizeBox(box: PresentationSvgBox | undefined): PresentationSvgBox | null {
  if (!box) return null
  const x = Number(box.x)
  const y = Number(box.y)
  const w = Number(box.w)
  const h = Number(box.h)
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null
  return { x, y, w, h }
}

function addSvgImage(slide: PresentationToolSlide, svg: string, box: PresentationSvgBox, altText: string) {
  slide.addImage({
    data: toSvgData(svg),
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    altText,
  })
}

function toPosition(box: PresentationSvgBox, x: number, y: number, w: number, h: number) {
  return {
    x: box.x + (box.w * x) / SVG_W,
    y: box.y + (box.h * y) / SVG_H,
    w: (box.w * w) / SVG_W,
    h: (box.h * h) / SVG_H,
  }
}

function addNativeShape(
  slide: PresentationToolSlide,
  shapeName: string,
  box: PresentationSvgBox,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: {
    fill?: string
    line?: string
    transparency?: number
    lineTransparency?: number
    width?: number
  } = {}
) {
  if (!slide.addShape) return
  const raw = toPosition(box, x, y, w, h)
  const isLine = shapeName === 'line'
  const position = isLine
    ? {
        x: raw.x + Math.min(raw.w, 0),
        y: raw.y + Math.min(raw.h, 0),
        w: Math.abs(raw.w),
        h: Math.abs(raw.h),
      }
    : raw
  slide.addShape(shapeName, {
    ...position,
    ...(isLine && raw.w < 0 ? { flipH: true } : {}),
    ...(isLine && raw.h < 0 ? { flipV: true } : {}),
    fill: isLine
      ? { color: 'FFFFFF', transparency: 100 }
      : { color: opts.fill ?? 'FFFFFF', transparency: opts.transparency ?? (opts.fill ? 0 : 100) },
    line: {
      color: opts.line ?? opts.fill ?? 'FFFFFF',
      transparency: opts.lineTransparency ?? (opts.line || isLine ? 0 : 100),
      width: opts.width ?? 1,
    },
  })
}

function addNativeText(
  slide: PresentationToolSlide,
  text: unknown,
  box: PresentationSvgBox,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: {
    color: string
    size?: number
    bold?: boolean
    align?: 'left' | 'center' | 'right'
  }
) {
  if (!slide.addText) return
  const content = clipText(text, 22)
  if (!content) return
  slide.addText(content, {
    ...toPosition(box, x, y, w, h),
    margin: 0,
    fontFace: 'Microsoft YaHei UI',
    fontSize: opts.size ?? 12,
    bold: opts.bold ?? true,
    color: opts.color,
    align: opts.align ?? 'left',
    fit: 'shrink',
  })
}

function drawAmbientTexture(slide: PresentationToolSlide, theme: ResolvedSvgTheme, box: PresentationSvgBox, options: PresentationSvgToolOptions) {
  const opacity = clamp(options.opacity ?? 0.35, 0.08, 0.75)
  const shapeTransparency = Math.round(100 - opacity * 100)
  addNativeShape(slide, 'rect', box, 0, 0, SVG_W, SVG_H, { fill: theme.light, transparency: Math.max(70, shapeTransparency) })
  addNativeShape(slide, 'ellipse', box, 910, 36, 258, 258, { fill: theme.secondary, transparency: 86 })
  addNativeShape(slide, 'ellipse', box, 966, 92, 148, 148, { line: theme.primary, lineTransparency: 62, width: 2 })
  addNativeShape(slide, 'ellipse', box, 20, 588, 212, 212, { fill: theme.primary, transparency: 91 })
  addNativeShape(slide, 'line', box, -42, 184, 1220, -94, { line: theme.secondary, lineTransparency: 84, width: 5 })
  addNativeShape(slide, 'line', box, -56, 556, 1340, -288, { line: theme.primary, lineTransparency: 88, width: 7 })
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      addNativeShape(slide, 'ellipse', box, 86 + col * 116, 92 + row * 104, 7, 7, {
        fill: theme.dark,
        transparency: 94,
      })
    }
  }
}

function drawLearningGoals(slide: PresentationToolSlide, theme: ResolvedSvgTheme, box: PresentationSvgBox, options: PresentationSvgToolOptions) {
  const items = normalizeItems(options.items, ['理解定位', '掌握方法', '建立意识'], 3)
  addNativeShape(slide, 'roundRect', box, 28, 28, 1144, 664, { fill: theme.paper, line: theme.secondary, lineTransparency: 72 })
  addNativeShape(slide, 'line', box, 96, 138, 996, 0, { line: theme.secondary, lineTransparency: 74, width: 2 })
  addNativeText(slide, options.title ?? options.label ?? '学习路径', box, 92, 76, 460, 46, { color: theme.dark, size: 18 })
  const cardW = 318
  const gap = 42
  const startX = 82
  items.forEach((item, index) => {
    const x = startX + index * (cardW + gap)
    const accent = index === (options.accentIndex ?? 0) ? theme.primary : theme.secondary
    addNativeShape(slide, 'roundRect', box, x, 186, cardW, 376, { fill: theme.card, line: theme.secondary, lineTransparency: 72 })
    addNativeShape(slide, 'ellipse', box, x + 48, 230, 76, 76, { fill: accent, lineTransparency: 100 })
    addNativeText(slide, String(index + 1).padStart(2, '0'), box, x + 66, 250, 44, 34, {
      color: index === (options.accentIndex ?? 0) ? theme.accent : theme.dark,
      size: 16,
      align: 'center',
    })
    addNativeShape(slide, 'line', box, x + 60, 430, 70, 76, { line: accent, lineTransparency: 62, width: 8 })
    addNativeShape(slide, 'line', box, x + 130, 506, 136, -166, { line: accent, lineTransparency: 62, width: 8 })
    addNativeText(slide, item, box, x + 44, 592, 248, 42, { color: theme.dark, size: 14, align: 'center' })
  })
}

function drawConceptMap(slide: PresentationToolSlide, theme: ResolvedSvgTheme, box: PresentationSvgBox, options: PresentationSvgToolOptions) {
  const items = normalizeItems(options.items, ['输入', '判断', '协作', '复盘', '输出'], 5)
  const title = options.title ?? options.label ?? items[0]
  const nodes = [
    [182, 170],
    [936, 152],
    [1010, 520],
    [230, 548],
    [600, 608],
  ] as const
  addNativeShape(slide, 'roundRect', box, 24, 24, 1152, 672, { fill: theme.paper, line: theme.secondary, lineTransparency: 78 })
  nodes.forEach(([x, y]) => addNativeShape(slide, 'line', box, 600, 346, x - 600, y - 346, { line: theme.secondary, lineTransparency: 72, width: 2 }))
  addNativeShape(slide, 'ellipse', box, 452, 198, 296, 296, { fill: theme.primary, line: theme.primary, lineTransparency: 100 })
  addNativeShape(slide, 'ellipse', box, 396, 142, 408, 408, { line: theme.secondary, lineTransparency: 76, width: 2 })
  addNativeText(slide, title, box, 496, 320, 208, 54, { color: theme.accent, size: 16, align: 'center' })
  nodes.forEach(([x, y], index) => {
    addNativeShape(slide, 'roundRect', box, x - 106, y - 44, 212, 88, { fill: theme.card, line: theme.secondary, lineTransparency: 72 })
    addNativeShape(slide, 'ellipse', box, x - 76, y - 18, 36, 36, { fill: index % 2 === 0 ? theme.primary : theme.secondary })
    addNativeText(slide, items[index], box, x - 30, y - 18, 118, 34, { color: theme.dark, size: 13 })
  })
}

function drawProcessPath(slide: PresentationToolSlide, theme: ResolvedSvgTheme, box: PresentationSvgBox, options: PresentationSvgToolOptions) {
  const items = normalizeItems(options.items, ['输入', '验证', '迭代', '交付'], 4)
  const points = [
    [118, 488],
    [386, 270],
    [664, 432],
    [952, 206],
  ] as const
  addNativeShape(slide, 'roundRect', box, 24, 24, 1152, 672, { fill: theme.paper, line: theme.secondary, lineTransparency: 78 })
  addNativeShape(slide, 'line', box, 82, 534, 922, -350, { line: theme.secondary, lineTransparency: 68, width: 3 })
  points.forEach(([x, y], index) => {
    addNativeShape(slide, 'ellipse', box, x - 58, y - 58, 116, 116, { fill: theme.card, line: theme.secondary, lineTransparency: 70 })
    addNativeShape(slide, 'ellipse', box, x - 38, y - 38, 76, 76, { fill: index === 0 ? theme.primary : theme.secondary, lineTransparency: 100 })
    addNativeText(slide, String(index + 1), box, x - 16, y - 18, 32, 32, { color: index === 0 ? theme.accent : theme.dark, size: 16, align: 'center' })
    addNativeText(slide, items[index], box, x - 84, y + 76, 168, 34, { color: theme.dark, size: 12, align: 'center' })
  })
}

function drawCaseCompare(slide: PresentationToolSlide, theme: ResolvedSvgTheme, box: PresentationSvgBox, options: PresentationSvgToolOptions) {
  const items = normalizeItems(options.items, ['现状', '方案', '风险', '动作'], 4)
  addNativeShape(slide, 'roundRect', box, 24, 24, 1152, 672, { fill: theme.paper, line: theme.secondary, lineTransparency: 78 })
  addNativeShape(slide, 'roundRect', box, 88, 120, 456, 460, { fill: theme.card, line: theme.secondary, lineTransparency: 70 })
  addNativeShape(slide, 'roundRect', box, 656, 120, 456, 460, { fill: theme.light, line: theme.primary, lineTransparency: 72 })
  addNativeShape(slide, 'line', box, 574, 208, 52, 52, { line: theme.primary, lineTransparency: 35, width: 6 })
  addNativeShape(slide, 'line', box, 626, 260, -52, 52, { line: theme.primary, lineTransparency: 35, width: 6 })
  addNativeText(slide, items[0], box, 136, 170, 260, 46, { color: theme.dark, size: 15 })
  addNativeText(slide, items[1], box, 704, 170, 260, 46, { color: theme.primary, size: 15 })
  ;[0, 1, 2].forEach((row) => {
    addNativeShape(slide, 'roundRect', box, 138, 262 + row * 78, 300 - row * 36, 22, { fill: theme.secondary, transparency: 72 })
    addNativeShape(slide, 'roundRect', box, 706, 262 + row * 78, 256 + row * 54, 22, { fill: theme.primary, transparency: 72 })
  })
  addNativeText(slide, items[2], box, 136, 500, 260, 36, { color: theme.muted, size: 12 })
  addNativeText(slide, items[3], box, 704, 500, 260, 36, { color: theme.muted, size: 12 })
}

function drawPracticeChecklist(slide: PresentationToolSlide, theme: ResolvedSvgTheme, box: PresentationSvgBox, options: PresentationSvgToolOptions) {
  const items = normalizeItems(options.items, ['检查输入', '验证输出', '补充洞察', '复盘动作'], 4)
  addNativeShape(slide, 'roundRect', box, 24, 24, 1152, 672, { fill: theme.paper, line: theme.secondary, lineTransparency: 78 })
  addNativeShape(slide, 'roundRect', box, 92, 92, 1016, 536, { fill: theme.card, line: theme.secondary, lineTransparency: 78 })
  items.forEach((item, index) => {
    const y = 164 + index * 104
    addNativeShape(slide, 'roundRect', box, 154, y - 42, 892, 74, { fill: index % 2 === 0 ? theme.light : theme.paper, lineTransparency: 100 })
    addNativeShape(slide, 'ellipse', box, 182, y - 29, 48, 48, { fill: theme.primary, lineTransparency: 100 })
    addNativeShape(slide, 'line', box, 194, y - 5, 9, 12, { line: theme.accent, lineTransparency: 0, width: 4 })
    addNativeShape(slide, 'line', box, 203, y + 7, 19, -25, { line: theme.accent, lineTransparency: 0, width: 4 })
    addNativeText(slide, item, box, 254, y - 26, 520, 44, { color: theme.dark, size: 14 })
  })
}

function drawSemanticNative(
  slide: PresentationToolSlide,
  kind: PresentationSemanticSvgKind,
  theme: ResolvedSvgTheme,
  box: PresentationSvgBox,
  options: PresentationSvgToolOptions
) {
  if (!slide.addShape || !slide.addText) return false
  if (kind === 'learningGoals') drawLearningGoals(slide, theme, box, options)
  else if (kind === 'processPath') drawProcessPath(slide, theme, box, options)
  else if (kind === 'caseCompare') drawCaseCompare(slide, theme, box, options)
  else if (kind === 'practiceChecklist') drawPracticeChecklist(slide, theme, box, options)
  else if (kind === 'ambientTexture') drawAmbientTexture(slide, theme, box, options)
  else drawConceptMap(slide, theme, box, options)
  return true
}

export function createPresentationSvgTools(input: PresentationSvgToolInput = {}) {
  return {
    svgKinds: SVG_KINDS,
    makeSemanticSvgData(kind: PresentationSemanticSvgKind, options: PresentationSvgToolOptions = {}) {
      const normalizedKind = normalizeKind(kind)
      const theme = resolveTheme(input, options)
      return toSvgData(renderSemanticSvg(normalizedKind, theme, options))
    },
    addSemanticSvg(
      slide: PresentationToolSlide,
      kind: PresentationSemanticSvgKind,
      box: PresentationSvgBox,
      options: PresentationSvgToolOptions = {}
    ) {
      const safeBox = normalizeBox(box)
      if (!safeBox || !slide) return
      const normalizedKind = normalizeKind(kind)
      const theme = resolveTheme(input, options)
      drawSemanticNative(slide, normalizedKind, theme, safeBox, options)
    },
    addAmbientTexture(
      slide: PresentationToolSlide,
      box: PresentationSvgBox,
      options: PresentationSvgToolOptions = {}
    ) {
      const safeBox = normalizeBox(box)
      if (!safeBox || !slide) return
      const theme = resolveTheme(input, options)
      drawAmbientTexture(slide, theme, safeBox, { ...options, opacity: options.opacity ?? 0.35 })
    },
  }
}
