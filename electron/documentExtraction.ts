import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import JSZip from 'jszip'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { Script, createContext } from 'vm'
import * as XLSX from 'xlsx'
import { z } from 'zod'
import {
  buildWorkbookSchema,
  formatSpreadsheetCell,
  getSheetRows,
  parseNumericValue,
} from './spreadsheetSchema.ts'
import {
  getSpreadsheetSession,
  registerSpreadsheetSession,
} from './spreadsheetSession.ts'
import type { SpreadsheetDocumentType, SpreadsheetSession } from './spreadsheetSession.ts'
import {
  spreadsheetPlanFilterSchema,
  spreadsheetToolStepSchemas,
} from './shared/spreadsheetPlan'
import type {
  SpreadsheetExecutionPlan,
  SpreadsheetPlanFilter,
  SpreadsheetPlanStep,
  SpreadsheetWorkbookSchema,
  SpreadsheetToolName,
} from './shared/spreadsheetPlan'

export interface ExtractDocumentTextRequest {
  fileName: string
  mimeType?: string
  data: ArrayBuffer
}

export interface ExtractDocumentTextResult {
  ok: boolean
  content?: string
  error?: string
  fileType?: 'pptx' | 'pdf' | 'docx' | 'xlsx' | 'csv'
  spreadsheetSessionId?: string
  spreadsheetSchema?: SpreadsheetWorkbookSchema
}

export interface ExecuteSpreadsheetInstructionRequest {
  sessionId: string
  instruction: string
}

interface SpreadsheetToolExecutionState {
  intent: SpreadsheetExecutionPlan['intent']
  filters: SpreadsheetPlanFilter[]
  groupByColumns: string[]
  valueColumn?: string
  selectColumns: string[]
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
  chartType?: SpreadsheetChartType
  targetSheetName?: string
  exportTarget?: 'new_sheet' | 'excel_file'
  topN?: number
  explanation?: string
}

export interface ExecuteSpreadsheetPlanRequest {
  sessionId: string
  plan: SpreadsheetExecutionPlan
}

export interface ExecuteSpreadsheetInstructionResult {
  ok: boolean
  performed: boolean
  message: string
  createdSheetName?: string
}

export interface ExportSpreadsheetSessionResult {
  ok: boolean
  message: string
  filePath?: string
  chartPaths?: string[]
}

type SupportedDocumentType = 'pptx' | 'pdf' | 'docx' | 'xlsx' | 'csv'
const MAX_INPUT_BYTES = 20 * 1024 * 1024
const MAX_SECTION_COUNT = 8
const MAX_SECTION_CHARS = 700
const MAX_SUMMARY_CHARS = 6000
const MAX_SPREADSHEET_SAMPLE_ROWS = 6
const MAX_SPREADSHEET_SAMPLE_COLUMNS = 10
const MAX_SPREADSHEET_PREVIEW_ROWS = 8
const SCRIPT_EXECUTION_TIMEOUT_MS = 1500
const PYTHON_SCRIPT_TIMEOUT_MS = 20000

type PdfWorkerModule = {
  WorkerMessageHandler?: unknown
}

type GlobalWithPdfWorker = typeof globalThis & {
  pdfjsWorker?: PdfWorkerModule
}

function getSupportedDocumentType(fileName: string, mimeType?: string): SupportedDocumentType | null {
  const lowerName = fileName.trim().toLowerCase()
  const lowerMimeType = mimeType?.trim().toLowerCase()

  if (
    lowerName.endsWith('.pptx') ||
    lowerMimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) {
    return 'pptx'
  }

  if (lowerName.endsWith('.pdf') || lowerMimeType === 'application/pdf') {
    return 'pdf'
  }

  if (
    lowerName.endsWith('.docx') ||
    lowerMimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx'
  }

  if (
    lowerName.endsWith('.xlsx') ||
    lowerMimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return 'xlsx'
  }

  if (lowerName.endsWith('.csv') || lowerMimeType === 'text/csv') {
    return 'csv'
  }

  return null
}

function decodeXmlEntities(text: string) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(parseInt(decimal, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function normalizeWhitespace(text: string) {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function truncateText(text: string, maxChars: number) {
  if (text.length <= maxChars) return text

  const shortened = text.slice(0, maxChars)
  const breakIndex = Math.max(
    shortened.lastIndexOf('\n'),
    shortened.lastIndexOf('。'),
    shortened.lastIndexOf('！'),
    shortened.lastIndexOf('？'),
    shortened.lastIndexOf(' ')
  )

  const safeIndex = breakIndex > maxChars * 0.6 ? breakIndex : maxChars
  return `${shortened.slice(0, safeIndex).trimEnd()}...`
}

function pickRepresentativeSections(sections: string[], maxCount: number) {
  if (sections.length <= maxCount) {
    return sections.map((text, index) => ({ index, text }))
  }

  const indexes = new Set<number>()
  for (let i = 0; i < maxCount; i += 1) {
    indexes.add(Math.round((i * (sections.length - 1)) / (maxCount - 1)))
  }

  return Array.from(indexes)
    .sort((a, b) => a - b)
    .map((index) => ({ index, text: sections[index] }))
}

function buildSummary(
  fileTypeLabel: string,
  sections: string[],
  sectionLabel: string,
  renderSectionTitle: (index: number) => string
) {
  const cleanedSections = sections
    .map((section) => truncateText(normalizeWhitespace(section), MAX_SECTION_CHARS))
    .filter(Boolean)

  if (cleanedSections.length === 0) {
    throw new Error('未提取到可用文本')
  }

  const selectedSections = pickRepresentativeSections(cleanedSections, MAX_SECTION_COUNT)
  const parts = [
    `[自动提取摘要 | ${fileTypeLabel}]`,
    `说明：已自动提取可读文本并压缩为摘要，可能省略图片、版式、表格样式和部分重复内容。`,
    `总${sectionLabel}数：${cleanedSections.length}`,
  ]

  for (const section of selectedSections) {
    parts.push(`${renderSectionTitle(section.index)}\n${section.text}`)
  }

  if (cleanedSections.length > selectedSections.length) {
    parts.push(`其余内容已省略。`)
  }

  return truncateText(parts.join('\n\n'), MAX_SUMMARY_CHARS)
}

function extractXmlText(xml: string) {
  return decodeXmlEntities(
    xml
      .replace(/<w:tab\s*\/\s*>/gi, '\t')
      .replace(/<(?:w:br|a:br)\b[^>]*\/\s*>/gi, '\n')
      .replace(/<\/w:p>/gi, '\n\n')
      .replace(/<\/a:p>/gi, '\n\n')
      .replace(/<\/w:tr>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
}

function splitIntoBlocks(text: string) {
  return normalizeWhitespace(text)
    .split(/\n{2,}/)
    .map((block) => normalizeWhitespace(block))
    .filter(Boolean)
}

function sortNumberedXmlPaths(paths: string[]) {
  return [...paths].sort((left, right) => {
    const leftNumber = Number(left.match(/(\d+)(?=\.xml$)/)?.[1] ?? 0)
    const rightNumber = Number(right.match(/(\d+)(?=\.xml$)/)?.[1] ?? 0)
    return leftNumber - rightNumber
  })
}

async function extractDocxSummary(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const docPaths = [
    'word/document.xml',
    'word/footnotes.xml',
    'word/endnotes.xml',
  ].filter((path) => zip.file(path))

  const blocks: string[] = []
  for (const path of docPaths) {
    const xml = await zip.file(path)?.async('string')
    if (!xml) continue
    blocks.push(...splitIntoBlocks(extractXmlText(xml)))
  }

  return buildSummary('DOCX', blocks, '片段', (index) => `[片段 ${index + 1}]`)
}

async function extractPptxSummary(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const slidePaths = sortNumberedXmlPaths(
    Object.keys(zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
  )

  const slides: string[] = []
  for (const path of slidePaths) {
    const xml = await zip.file(path)?.async('string')
    if (!xml) continue
    const slideText = normalizeWhitespace(extractXmlText(xml))
    if (slideText) {
      slides.push(slideText)
    }
  }

  return buildSummary('PPTX', slides, '页', (index) => `[第 ${index + 1} 页]`)
}

async function extractPdfSummary(buffer: Buffer) {
  const [pdfjs, workerModule] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ])

  ;(globalThis as GlobalWithPdfWorker).pdfjsWorker = workerModule as PdfWorkerModule
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
  } as Record<string, unknown>)

  try {
    const document = await loadingTask.promise
    const pages: string[] = []

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const pageText = normalizeWhitespace(
        (content.items as Array<{ str?: string; hasEOL?: boolean }>)
          .map((item) => `${item.str ?? ''}${item.hasEOL ? '\n' : ' '}`)
          .join('')
      )

      if (pageText) {
        pages.push(pageText)
      }

      page.cleanup()
    }

    return buildSummary('PDF', pages, '页', (index) => `[第 ${index + 1} 页]`)
  } finally {
    await loadingTask.destroy()
  }
}

function summarizeSheet(sheetName: string, rows: unknown[][]) {
  const normalizedRows = rows
    .map((row) => row.map((cell) => formatSpreadsheetCell(cell)))
    .filter((row) => row.some(Boolean))

  if (normalizedRows.length === 0) {
    return [
      `工作表名称：${sheetName}`,
      '状态：空工作表',
    ].join('\n')
  }

  const maxColumnCount = normalizedRows.reduce((count, row) => Math.max(count, row.length), 0)
  const headerRow = normalizedRows[0]
  const sampleRows = normalizedRows
    .slice(1, 1 + MAX_SPREADSHEET_SAMPLE_ROWS)
    .map((row) => row.slice(0, MAX_SPREADSHEET_SAMPLE_COLUMNS))
  const hasHeader = headerRow.some(Boolean)

  const parts = [
    `工作表名称：${sheetName}`,
    `可见数据行数：${normalizedRows.length}`,
    `总列数：${maxColumnCount}`,
    `样例展示列数：${Math.min(maxColumnCount, MAX_SPREADSHEET_SAMPLE_COLUMNS)}`,
    hasHeader
      ? `表头：${headerRow.map((cell, index) => cell || `列${index + 1}`).join(' | ')}`
      : '表头：未识别到明确表头',
  ]

  if (sampleRows.length > 0) {
    parts.push('样例数据：')
    sampleRows.forEach((row, rowIndex) => {
      const rendered = row.map((cell, cellIndex) => `${headerRow[cellIndex] || `列${cellIndex + 1}`}=${cell || '(空)'}`).join('；')
      parts.push(`- 第 ${rowIndex + 2} 行：${rendered}`)
    })
  }

  if (normalizedRows.length > sampleRows.length + 1) {
    parts.push(`其余 ${normalizedRows.length - sampleRows.length - 1} 行未展开。`)
  }

  return parts.join('\n')
}

function parseWorkbook(buffer: Buffer, fileType: SpreadsheetDocumentType) {
  return XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    dense: false,
    raw: false,
    FS: fileType === 'csv' ? ',' : undefined,
  })
}

function buildWorkbookSummary(workbook: XLSX.WorkBook, fileTypeLabel: string) {
  const sheetSummaries = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName]
    const rows = getSheetRows(sheet)

    return summarizeSheet(sheetName, rows)
  }).filter(Boolean)

  return buildSummary(fileTypeLabel, sheetSummaries, '工作表', (index) => `[工作表 ${index + 1}]`)
}

async function extractSpreadsheetSummary(buffer: Buffer, fileName: string, fileType: SpreadsheetDocumentType) {
  const workbook = parseWorkbook(buffer, fileType)
  const schema = buildWorkbookSchema(workbook)
  const sessionId = registerSpreadsheetSession(fileName, fileType, workbook, schema)

  return {
    content: buildWorkbookSummary(workbook, fileType.toUpperCase()),
    spreadsheetSessionId: sessionId,
    spreadsheetSchema: schema,
  }
}

function normalizeHeaderName(value: string) {
  return value.trim().toLowerCase().replace(/[\s_\-()（）【】\[\]：:]+/g, '')
}

function resolveSheetName(workbook: XLSX.WorkBook, instruction: string) {
  const lowerInstruction = instruction.toLowerCase()
  const directMatch = workbook.SheetNames.find((sheetName) => lowerInstruction.includes(sheetName.toLowerCase()))
  if (directMatch) return directMatch

  const explicitMatch = instruction.match(/(?:在|从)\s*[《“"]?([^》”"\s]+)[》”"]?\s*(?:表|工作表|sheet)/i)?.[1]
  if (!explicitMatch) return workbook.SheetNames[0]

  return workbook.SheetNames.find((sheetName) => sheetName.toLowerCase() === explicitMatch.toLowerCase())
    ?? workbook.SheetNames.find((sheetName) => sheetName.includes(explicitMatch) || explicitMatch.includes(sheetName))
    ?? workbook.SheetNames[0]
}

function resolveHeader(requested: string, headers: string[]) {
  const normalizedRequested = normalizeHeaderName(requested)
  if (!normalizedRequested) return null

  return headers.find((header) => normalizeHeaderName(header) === normalizedRequested)
    ?? headers.find((header) => normalizeHeaderName(header).includes(normalizedRequested))
    ?? headers.find((header) => normalizedRequested.includes(normalizeHeaderName(header)))
    ?? null
}

function splitColumnCandidates(segment: string) {
  return segment
    .split(/(?:\+|、|,|，|和|及|与|跟)/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function extractGroupByColumns(instruction: string, headers: string[]) {
  const segment = instruction.match(/按\s*(.+?)(?=(?:分组|统计|汇总|合计|求和|总和|平均|均值|计数|条数|个数|数量|有多少|生成|新\s*(?:sheet|工作表)|导出|图表|$))/i)?.[1]
    if (!segment) return []

  const candidates = splitColumnCandidates(segment)
  const resolvedColumns: string[] = []
  for (const candidate of candidates) {
    const resolved = resolveHeader(candidate, headers)
    if (resolved && !resolvedColumns.includes(resolved)) {
      resolvedColumns.push(resolved)
    }
  }

  return resolvedColumns
}

function extractFilters(instruction: string, headers: string[]) {
  const filters: SpreadsheetFilter[] = []
  const matchedConditions = instruction.matchAll(/([\u4e00-\u9fa5A-Za-z0-9_\-（）()【】\[\]：:]+)\s*(包含|不包含|>=|<=|>|<|=|等于|为|大于等于|小于等于|大于|小于)\s*[“"《]?([^，。,；;\n]+?)[”"》]?(?=(?:，|。|；|;|并且|并|且|然后|按|统计|汇总|求和|平均|计数|生成|新|sheet|工作表|导出|$))/g)

  for (const match of matchedConditions) {
    const column = resolveHeader(match[1]?.trim() ?? '', headers)
    const rawOperator = match[2]?.trim() ?? ''
    const value = match[3]?.trim() ?? ''
    if (!column || !value) continue

    const operator = rawOperator === '包含'
      ? 'contains'
      : rawOperator === '>' || rawOperator === '大于'
        ? 'gt'
        : rawOperator === '>=' || rawOperator === '大于等于'
          ? 'gte'
          : rawOperator === '<' || rawOperator === '小于'
            ? 'lt'
            : rawOperator === '<=' || rawOperator === '小于等于'
              ? 'lte'
              : 'eq'

    filters.push({ column, operator, value })
  }

  return filters
}

type SpreadsheetOperation =
  | { kind: 'sum'; sourceSheetName: string; groupByColumns: string[]; valueColumn: string; targetSheetName: string; filters: SpreadsheetFilter[]; chartType?: SpreadsheetChartType; topN?: number }
  | { kind: 'count'; sourceSheetName: string; groupByColumns: string[]; targetSheetName: string; filters: SpreadsheetFilter[]; chartType?: SpreadsheetChartType; topN?: number }
  | { kind: 'avg'; sourceSheetName: string; groupByColumns: string[]; valueColumn: string; targetSheetName: string; filters: SpreadsheetFilter[]; chartType?: SpreadsheetChartType; topN?: number }

interface SpreadsheetFilter {
  column: string
  operator: 'eq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte'
  value: string
}

type SpreadsheetChartType = 'bar' | 'line' | 'pie' | 'horizontalBar'

function detectTargetSheetName(instruction: string) {
  return instruction.match(/(?:命名为|叫做|叫|保存到|生成到)\s*[《“"]?([^》”"\n]+)[》”"]?/i)?.[1]?.trim() ?? ''
}

function detectChartType(instruction: string): SpreadsheetChartType | undefined {
  if (/横向?柱状图|条形图/i.test(instruction)) return 'horizontalBar'
  if (/柱状图/i.test(instruction)) return 'bar'
  if (/折线图/i.test(instruction)) return 'line'
  if (/饼图/i.test(instruction)) return 'pie'
  if (/(画个?图|画图|做个?图|统计图|图表|可视化|展示成图)/i.test(instruction)) return 'bar'
  return undefined
}

function resolveSheetHeaders(workbook: XLSX.WorkBook, sheetName?: string) {
  const resolvedSheetName = sheetName && workbook.SheetNames.includes(sheetName)
    ? sheetName
    : workbook.SheetNames[0]
  const sheet = workbook.Sheets[resolvedSheetName]
  if (!sheet) {
    throw new Error('未找到可执行的工作表')
  }

  const rows = getSheetRows(sheet)
  const headerRow = rows.find((row) => row.some((cell) => formatSpreadsheetCell(cell))) ?? []
  const headers = headerRow.map((cell, index) => formatSpreadsheetCell(cell) || `列${index + 1}`)

  return { resolvedSheetName, headers }
}

type SpreadsheetToolHandler<Name extends SpreadsheetToolName> = {
  schema: typeof spreadsheetToolStepSchemas[Name]
  apply: (state: SpreadsheetToolExecutionState, step: z.infer<typeof spreadsheetToolStepSchemas[Name]>) => void
}

const spreadsheetToolRegistry: { [K in SpreadsheetToolName]: SpreadsheetToolHandler<K> } = {
  filter: {
    schema: spreadsheetToolStepSchemas.filter,
    apply: (state, step) => {
      state.filters.push(...step.conditions)
    },
  },
  group_by: {
    schema: spreadsheetToolStepSchemas.group_by,
    apply: (state, step) => {
      state.groupByColumns = step.columns
    },
  },
  aggregate: {
    schema: spreadsheetToolStepSchemas.aggregate,
    apply: (state, step) => {
      const primaryMetric = step.metrics[0]
      state.intent = primaryMetric.type
      state.valueColumn = primaryMetric.column
    },
  },
  sort: {
    schema: spreadsheetToolStepSchemas.sort,
    apply: (state, step) => {
      state.sortBy = step.by
      state.sortDirection = step.direction
    },
  },
  top_n: {
    schema: spreadsheetToolStepSchemas.top_n,
    apply: (state, step) => {
      state.topN = step.value
    },
  },
  select_columns: {
    schema: spreadsheetToolStepSchemas.select_columns,
    apply: (state, step) => {
      state.selectColumns = step.columns
    },
  },
  chart: {
    schema: spreadsheetToolStepSchemas.chart,
    apply: (state, step) => {
      state.chartType = step.chartType
      if (state.intent === 'analysis') {
        state.intent = 'chart'
      }
    },
  },
  export: {
    schema: spreadsheetToolStepSchemas.export,
    apply: (state, step) => {
      state.exportTarget = step.target
      if (step.sheetName) {
        state.targetSheetName = step.sheetName
      }
      if (step.target === 'excel_file') {
        state.intent = 'export'
      } else if (state.intent === 'analysis' || state.intent === 'detail_filter') {
        state.intent = 'filter_rows'
      }
    },
  },
}

function applySpreadsheetToolSteps(plan: SpreadsheetExecutionPlan) {
  const state: SpreadsheetToolExecutionState = {
    intent: plan.intent,
    filters: [...(plan.filters ?? [])],
    groupByColumns: [...(plan.groupByColumns ?? [])],
    valueColumn: plan.valueColumn,
    selectColumns: [...(plan.selectColumns ?? [])],
    sortBy: plan.sortBy,
    sortDirection: plan.sortDirection,
    chartType: plan.chartType,
    targetSheetName: plan.targetSheetName,
    exportTarget: undefined,
    topN: plan.topN,
    explanation: plan.explanation,
  }

  for (const rawStep of plan.steps ?? []) {
    const handler = spreadsheetToolRegistry[rawStep.op]
    const step = handler.schema.parse(rawStep)
    handler.apply(state, step as never)
  }

  return state
}

function normalizeStepBasedPlan(plan: SpreadsheetExecutionPlan): SpreadsheetExecutionPlan {
  if (!plan.steps || plan.steps.length === 0) {
    return plan
  }

  const toolState = applySpreadsheetToolSteps(plan)

  const normalized: SpreadsheetExecutionPlan = {
    ...plan,
    intent: toolState.intent,
    filters: toolState.filters,
    groupByColumns: toolState.groupByColumns,
    valueColumn: toolState.valueColumn,
    selectColumns: toolState.selectColumns,
    sortBy: toolState.sortBy,
    sortDirection: toolState.sortDirection,
    chartType: toolState.chartType,
    targetSheetName: toolState.targetSheetName,
    topN: toolState.topN,
    explanation: toolState.explanation,
  }

  if (plan.intent === 'analysis' || plan.intent === 'aggregation') {
    if (normalized.groupByColumns?.length) {
      normalized.intent = normalized.valueColumn ? (normalized.intent === 'aggregation' ? 'sum' : normalized.intent) : 'count'
    }
  }

  if (plan.intent === 'detail_filter' && !normalized.groupByColumns?.length) {
    normalized.intent = 'filter_rows'
  }

  return normalized
}

function resolvePlanToOperation(workbook: XLSX.WorkBook, plan: SpreadsheetExecutionPlan): SpreadsheetOperation | null {
  const normalizedPlan = normalizeStepBasedPlan(plan)
  if (
    normalizedPlan.intent === 'chart'
    || normalizedPlan.intent === 'export'
    || normalizedPlan.intent === 'script'
    || normalizedPlan.intent === 'filter_rows'
    || normalizedPlan.intent === 'analysis'
    || normalizedPlan.intent === 'detail_filter'
    || normalizedPlan.intent === 'aggregation'
  ) {
    return null
  }

  const { resolvedSheetName, headers } = resolveSheetHeaders(workbook, normalizedPlan.sourceSheetName)
  const groupByColumns = (normalizedPlan.groupByColumns ?? [])
    .map((column) => resolveHeader(column, headers))
    .filter((column): column is string => Boolean(column))
  if (groupByColumns.length === 0) {
    throw new Error('未识别到有效的分组列')
  }

  const filters = (normalizedPlan.filters ?? [])
    .map((filter) => {
      const resolvedColumn = resolveHeader(filter.column, headers)
      if (!resolvedColumn) return null
      return {
        column: resolvedColumn,
        operator: filter.operator,
        value: filter.value,
      }
    })
    .filter((filter): filter is SpreadsheetFilter => Boolean(filter))

  const chartType = normalizedPlan.chartType
  const operationIntent = normalizedPlan.intent as SpreadsheetOperation['kind']
  const targetSheetName = normalizedPlan.targetSheetName || buildDefaultTargetSheetName(operationIntent)
  const topN = typeof normalizedPlan.topN === 'number' && Number.isFinite(normalizedPlan.topN) && normalizedPlan.topN > 0
    ? Math.max(1, Math.floor(normalizedPlan.topN))
    : undefined

  if (normalizedPlan.intent === 'count') {
    return {
      kind: 'count',
      sourceSheetName: resolvedSheetName,
      groupByColumns,
      targetSheetName,
      filters,
      chartType,
      topN,
    }
  }

  const valueColumn = normalizedPlan.valueColumn ? resolveHeader(normalizedPlan.valueColumn, headers) : null
  if (!valueColumn) {
    throw new Error('未识别到有效的数值列')
  }

  return {
    kind: operationIntent,
    sourceSheetName: resolvedSheetName,
    groupByColumns,
    valueColumn,
    targetSheetName,
    filters,
    chartType,
    topN,
  }
}

function buildDefaultTargetSheetName(kind: SpreadsheetOperation['kind']) {
  if (kind === 'sum') return `汇总结果_${Date.now()}`
  if (kind === 'avg') return `平均结果_${Date.now()}`
  return `统计结果_${Date.now()}`
}

function inferSpreadsheetOperation(workbook: XLSX.WorkBook, instruction: string): SpreadsheetOperation | null {
  const sourceSheetName = resolveSheetName(workbook, instruction)
  const sheet = workbook.Sheets[sourceSheetName]
  if (!sheet) return null

  const rows = getSheetRows(sheet)
  const headerRow = rows.find((row) => row.some((cell) => formatSpreadsheetCell(cell))) ?? []
  const headers = headerRow.map((cell, index) => formatSpreadsheetCell(cell) || `列${index + 1}`)
  const groupByColumns = extractGroupByColumns(instruction, headers)
  const targetSheetName = detectTargetSheetName(instruction)
  const filters = extractFilters(instruction, headers)
  const chartType = detectChartType(instruction)

  if (groupByColumns.length === 0) {
    if (chartType) {
      return null
    }
    return null
  }

  const avgCandidate = instruction.match(/(?:平均(?:值)?|均值|求平均)\s*[《“"]?([^》”"，。,\s]+)[》”"]?/i)?.[1]
    ?? instruction.match(/按.+?(?:平均|均值)\s*[《“"]?([^》”"，。,\s]+)[》”"]?/i)?.[1]
  if (avgCandidate) {
    const valueColumn = resolveHeader(avgCandidate, headers)
    if (!valueColumn) return null

    return {
      kind: 'avg',
      sourceSheetName,
      groupByColumns,
      valueColumn,
      targetSheetName: targetSheetName || buildDefaultTargetSheetName('avg'),
      filters,
      chartType,
    }
  }

  const sumCandidate = instruction.match(/(?:汇总|合计|求和|总和)\s*[《“"]?([^》”"，。,\s]+)[》”"]?/i)?.[1]
    ?? instruction.match(/按.+?(?:汇总|统计|合计)\s*[《“"]?([^》”"，。,\s]+)[》”"]?/i)?.[1]
  if (sumCandidate) {
    const valueColumn = resolveHeader(sumCandidate, headers)
    if (!valueColumn) return null

    return {
      kind: 'sum',
      sourceSheetName,
      groupByColumns,
      valueColumn,
      targetSheetName: targetSheetName || buildDefaultTargetSheetName('sum'),
      filters,
      chartType,
    }
  }

  if (/(计数|数量|条数|个数|有多少|统计|分组).*?(?:生成|新|sheet|工作表|汇总|图表|表示)/i.test(instruction) || /(按.+?(计数|数量|条数|个数|有多少|统计|分组))/i.test(instruction)) {
    return {
      kind: 'count',
      sourceSheetName,
      groupByColumns,
      targetSheetName: targetSheetName || buildDefaultTargetSheetName('count'),
      filters,
      chartType,
    }
  }

  return null
}

function makeUniqueSheetName(workbook: XLSX.WorkBook, baseName: string) {
  const trimmedBaseName = (baseName || '汇总结果').slice(0, 31).trim() || '汇总结果'
  if (!workbook.SheetNames.includes(trimmedBaseName)) {
    return trimmedBaseName
  }

  let index = 2
  while (index < 1000) {
    const suffix = `_${index}`
    const candidate = `${trimmedBaseName.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`
    if (!workbook.SheetNames.includes(candidate)) {
      return candidate
    }
    index += 1
  }

  return `${Date.now()}`.slice(-8)
}

function renderSpreadsheetPreview(rows: string[][]) {
  const previewRows = rows.slice(0, MAX_SPREADSHEET_PREVIEW_ROWS)
  if (previewRows.length === 0) {
    return '暂无可预览数据'
  }

  const headerRow = previewRows[0].map((cell) => cell || '(空)')
  const bodyRows = previewRows.slice(1)
  const dividerRow = headerRow.map(() => '---')
  const markdownRows = [headerRow, dividerRow, ...bodyRows]

  return markdownRows
    .map((row) => `| ${row.map((cell) => cell || '(空)').join(' | ')} |`)
    .join('\n')
}

function escapeXml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildChartSvg(chartType: SpreadsheetChartType, title: string, labels: string[], values: number[]) {
  const width = 960
  const height = 540
  const margin = { top: 60, right: 40, bottom: 90, left: 100 }
  const maxValue = Math.max(...values, 1)
  const palette = ['#34d399', '#60a5fa', '#f59e0b', '#f472b6', '#a78bfa', '#fb7185', '#22d3ee', '#f97316']

  if (chartType === 'pie') {
    const total = values.reduce((sum, value) => sum + value, 0) || 1
    const cx = width / 2
    const cy = height / 2 + 10
    const radius = 150
    let angle = -Math.PI / 2
    const slices = values.map((value, index) => {
      const sliceAngle = (value / total) * Math.PI * 2
      const x1 = cx + radius * Math.cos(angle)
      const y1 = cy + radius * Math.sin(angle)
      const nextAngle = angle + sliceAngle
      const x2 = cx + radius * Math.cos(nextAngle)
      const y2 = cy + radius * Math.sin(nextAngle)
      const largeArc = sliceAngle > Math.PI ? 1 : 0
      const path = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`
      angle = nextAngle
      return `<path d="${path}" fill="${palette[index % palette.length]}" opacity="0.92" />`
    }).join('')

    const legends = labels.map((label, index) => {
      const y = 390 + index * 20
      return `<rect x="120" y="${y - 10}" width="12" height="12" fill="${palette[index % palette.length]}" />\n<text x="140" y="${y}" fill="#e5eefb" font-size="13">${escapeXml(label)} (${values[index]})</text>`
    }).join('\n')

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n<rect width="100%" height="100%" fill="#0f172a" rx="24"/>\n<text x="${width / 2}" y="36" text-anchor="middle" fill="#f8fafc" font-size="24" font-weight="700">${escapeXml(title)}</text>\n${slices}\n${legends}\n</svg>`
  }

  const chartWidth = width - margin.left - margin.right
  const chartHeight = height - margin.top - margin.bottom
  const barsOrPoints = values.map((value, index) => {
    const color = palette[index % palette.length]
    if (chartType === 'horizontalBar') {
      const rowHeight = chartHeight / Math.max(values.length, 1)
      const y = margin.top + index * rowHeight + 8
      const barWidth = (value / maxValue) * chartWidth
      return `<rect x="${margin.left}" y="${y}" width="${barWidth}" height="${Math.max(18, rowHeight - 14)}" fill="${color}" rx="8" />\n<text x="${margin.left - 10}" y="${y + 16}" text-anchor="end" fill="#cbd5e1" font-size="12">${escapeXml(labels[index])}</text>\n<text x="${margin.left + barWidth + 8}" y="${y + 16}" fill="#f8fafc" font-size="12">${value}</text>`
    }

    const columnWidth = chartWidth / Math.max(values.length, 1)
    const x = margin.left + index * columnWidth + columnWidth * 0.15
    const barWidth = columnWidth * 0.7
    const barHeight = (value / maxValue) * chartHeight
    const y = margin.top + chartHeight - barHeight
    if (chartType === 'line') {
      const pointX = margin.left + index * columnWidth + columnWidth / 2
      const pointY = margin.top + chartHeight - barHeight
      return { pointX, pointY, color }
    }

    return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${color}" rx="8" />\n<text x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle" fill="#f8fafc" font-size="12">${value}</text>\n<text x="${x + barWidth / 2}" y="${margin.top + chartHeight + 24}" text-anchor="middle" fill="#cbd5e1" font-size="12">${escapeXml(labels[index])}</text>`
  })

  if (chartType === 'line') {
    const points = barsOrPoints as Array<{ pointX: number; pointY: number; color: string }>
    const polyline = points.map((point) => `${point.pointX},${point.pointY}`).join(' ')
    const circles = points.map((point, index) => `<circle cx="${point.pointX}" cy="${point.pointY}" r="5" fill="${point.color}" />\n<text x="${point.pointX}" y="${point.pointY - 12}" text-anchor="middle" fill="#f8fafc" font-size="12">${values[index]}</text>\n<text x="${point.pointX}" y="${margin.top + chartHeight + 24}" text-anchor="middle" fill="#cbd5e1" font-size="12">${escapeXml(labels[index])}</text>`).join('\n')
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n<rect width="100%" height="100%" fill="#0f172a" rx="24"/>\n<text x="${width / 2}" y="36" text-anchor="middle" fill="#f8fafc" font-size="24" font-weight="700">${escapeXml(title)}</text>\n<line x1="${margin.left}" y1="${margin.top + chartHeight}" x2="${width - margin.right}" y2="${margin.top + chartHeight}" stroke="#334155" stroke-width="2" />\n<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + chartHeight}" stroke="#334155" stroke-width="2" />\n<polyline fill="none" stroke="#60a5fa" stroke-width="4" points="${polyline}" />\n${circles}\n</svg>`
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n<rect width="100%" height="100%" fill="#0f172a" rx="24"/>\n<text x="${width / 2}" y="36" text-anchor="middle" fill="#f8fafc" font-size="24" font-weight="700">${escapeXml(title)}</text>\n<line x1="${margin.left}" y1="${margin.top + chartHeight}" x2="${width - margin.right}" y2="${margin.top + chartHeight}" stroke="#334155" stroke-width="2" />\n<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + chartHeight}" stroke="#334155" stroke-width="2" />\n${(barsOrPoints as string[]).join('\n')}\n</svg>`
}

function buildChartMarkdown(title: string, svgContent: string) {
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgContent, 'utf8').toString('base64')}`
  return `**图表预览**\n\n![${title}](${dataUrl})`
}

function writeRowsToSheet(session: SpreadsheetSession, baseSheetName: string, rows: string[][], replace = false) {
  if (!Array.isArray(rows) || rows.length === 0 || !rows.every((row) => Array.isArray(row))) {
    throw new Error('写入工作表失败：rows 必须是二维数组且不能为空')
  }

  const sheetName = replace && session.workbook.SheetNames.includes(baseSheetName)
    ? baseSheetName
    : makeUniqueSheetName(session.workbook, baseSheetName)
  const nextSheet = XLSX.utils.aoa_to_sheet(rows)

  session.workbook.Sheets[sheetName] = nextSheet
  if (!session.workbook.SheetNames.includes(sheetName)) {
    session.workbook.SheetNames.push(sheetName)
  }
  session.lastCreatedSheetName = sheetName

  return {
    sheetName,
    preview: renderSpreadsheetPreview(rows),
  }
}

async function runSpreadsheetScriptPlan(session: SpreadsheetSession, plan: SpreadsheetExecutionPlan) {
  const script = plan.script
  if (!script || !script.code.trim()) {
    throw new Error('脚本计划缺少可执行代码')
  }

  if (script.language === 'python') {
    return runSpreadsheetPythonScriptPlan(session, plan)
  }

  if (script.language !== 'javascript') {
    throw new Error(`暂不支持脚本语言：${script.language}`)
  }

  const api = {
    listSheets: () => [...session.workbook.SheetNames],
    readSheet: (sheetName?: string) => {
      const resolvedSheetName = sheetName && session.workbook.SheetNames.includes(sheetName)
        ? sheetName
        : session.lastCreatedSheetName ?? session.workbook.SheetNames[0]
      const sheet = session.workbook.Sheets[resolvedSheetName]
      if (!sheet) {
        throw new Error(`未找到工作表：${resolvedSheetName}`)
      }
      return getSheetRows(sheet).map((row) => row.map((cell) => formatSpreadsheetCell(cell)))
    },
    readRecords: (sheetName?: string) => {
      const rows = api.readSheet(sheetName)
      const header = rows[0] ?? []
      return rows.slice(1).map((row) => Object.fromEntries(header.map((column, index) => [column || `列${index + 1}`, row[index] ?? ''])))
    },
    writeSheet: (sheetName: string, rows: string[][], options?: { replace?: boolean }) => writeRowsToSheet(session, sheetName, rows, options?.replace),
    writeRecords: (sheetName: string, records: Array<Record<string, unknown>>, options?: { replace?: boolean }) => {
      if (!Array.isArray(records) || records.length === 0) {
        throw new Error('写入工作表失败：records 不能为空')
      }

      const headerSet = new Set<string>()
      records.forEach((record) => {
        Object.keys(record ?? {}).forEach((key) => headerSet.add(key))
      })
      const header = Array.from(headerSet)
      if (header.length === 0) {
        throw new Error('写入工作表失败：records 缺少列名')
      }

      const rows = [header, ...records.map((record) => header.map((key) => formatSpreadsheetCell(record[key])))]
      return writeRowsToSheet(session, sheetName, rows, options?.replace)
    },
    createChart: (sheetName?: string, chartType: SpreadsheetChartType = 'bar') => {
      const resolvedSheetName = sheetName && session.workbook.SheetNames.includes(sheetName)
        ? sheetName
        : session.lastCreatedSheetName
      if (!resolvedSheetName) {
        throw new Error('当前没有可用于生成图表的工作表')
      }
      return createChartForSheet(session, resolvedSheetName, chartType)
    },
    uniqueSheetName: (baseName: string) => makeUniqueSheetName(session.workbook, baseName),
  }

  const context = createContext({ Math, JSON, Array, Object, Number, String, Boolean, Date, RegExp })
  const wrappedCode = `(async (api) => {\n${script.code}\n})`
  const compiledScript = new Script(wrappedCode, { filename: 'spreadsheet-plan.js' })
  const executor = compiledScript.runInContext(context, { timeout: SCRIPT_EXECUTION_TIMEOUT_MS }) as (apiArg: typeof api) => Promise<unknown>
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('脚本执行超时')), SCRIPT_EXECUTION_TIMEOUT_MS)
  })
  const rawResult = await Promise.race([Promise.resolve(executor(api)), timeoutPromise]) as Record<string, unknown> | undefined
  if (timeoutHandle) {
    clearTimeout(timeoutHandle)
  }

  const createdSheetName = typeof rawResult?.createdSheetName === 'string'
    ? rawResult.createdSheetName
    : session.lastCreatedSheetName
  const chartFileName = typeof rawResult?.chartFileName === 'string'
    ? rawResult.chartFileName
    : undefined
  const message = typeof rawResult?.message === 'string'
    ? rawResult.message
    : script.summary || '已完成脚本计划执行。'

  const preview = createdSheetName && session.workbook.Sheets[createdSheetName]
    ? renderSpreadsheetPreview(
      getSheetRows(session.workbook.Sheets[createdSheetName]).map((row) => row.map((cell) => formatSpreadsheetCell(cell)))
    )
    : undefined
  const chart = chartFileName
    ? session.generatedCharts.find((item) => item.fileName === chartFileName)
    : undefined

  return {
    createdSheetName,
    chartFileName,
    message: [
      `已执行脚本计划${script.summary ? `：${script.summary}` : ''}`,
      '',
      typeof rawResult?.message === 'string' ? rawResult.message : message,
      ...(createdSheetName && preview ? ['', `- 输出工作表：${createdSheetName}`, '', '**结果预览**', '', preview] : []),
      ...(chart ? ['', buildChartMarkdown(chart.title, chart.svgContent), '', `已生成图表文件：${chart.fileName}，导出表格时会一并导出。`] : []),
    ].filter(Boolean).join('\n'),
  }
}

async function runSpreadsheetPythonScriptPlan(session: SpreadsheetSession, plan: SpreadsheetExecutionPlan) {
  const script = plan.script
  if (!script || script.language !== 'python' || !script.code.trim()) {
    throw new Error('脚本计划缺少可执行的 Python 代码')
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'katop-excel-agent-'))
  const workbookPath = path.join(tempRoot, 'input.xlsx')
  const schemaPath = path.join(tempRoot, 'schema.json')
  const resultPath = path.join(tempRoot, 'result.json')
  const outputDir = path.join(tempRoot, 'output')
  const scriptPath = path.join(tempRoot, 'agent_script.py')

  try {
    await mkdir(outputDir, { recursive: true })
    const workbookBuffer = XLSX.write(session.workbook, {
      type: 'buffer',
      bookType: 'xlsx',
      compression: true,
    })
    await writeFile(workbookPath, Buffer.isBuffer(workbookBuffer) ? workbookBuffer : Buffer.from(workbookBuffer))
    await writeFile(schemaPath, JSON.stringify(session.schema, null, 2), 'utf8')

    const pythonCode = [
      'import json',
      'from pathlib import Path',
      `INPUT_WORKBOOK = r'''${workbookPath}'''`,
      `SCHEMA_PATH = r'''${schemaPath}'''`,
      `OUTPUT_DIR = r'''${outputDir}'''`,
      `RESULT_PATH = r'''${resultPath}'''`,
      `SESSION_INFO = json.loads(r'''${JSON.stringify({
        sessionId: session.sessionId,
        fileName: session.fileName,
        fileType: session.fileType,
        lastCreatedSheetName: session.lastCreatedSheetName,
      }).replace(/\\/g, '\\\\').replace(/'''/g, "\\'\\'\\'")}''')`,
      '',
      script.code,
      '',
      'result_file = Path(RESULT_PATH)',
      'if not result_file.exists():',
      '    raise RuntimeError("Python 脚本未写出 RESULT_PATH 结果文件")',
    ].join('\n')
    await writeFile(scriptPath, pythonCode, 'utf8')

    const execution = await runPythonProcess(scriptPath, tempRoot)
    const rawResult = JSON.parse(await readFile(resultPath, 'utf8')) as {
      ok?: boolean
      message?: string
      createdSheetNames?: string[]
      exportedFilePath?: string
      chartPaths?: string[]
      preview?: { headers?: string[]; rows?: Array<Array<string | number | boolean | null>> }
      error?: string
    }

    if (!rawResult.ok) {
      throw new Error(rawResult.error || rawResult.message || execution.stderr || 'Python 脚本执行失败')
    }

    const exportedFilePath = rawResult.exportedFilePath
    if (exportedFilePath) {
      const nextWorkbook = XLSX.readFile(exportedFilePath, {
        cellDates: true,
        dense: false,
        raw: false,
      })
      session.workbook = nextWorkbook
      session.schema = buildWorkbookSchema(nextWorkbook)
      const lastSheet = rawResult.createdSheetNames?.[rawResult.createdSheetNames.length - 1]
      if (lastSheet) {
        session.lastCreatedSheetName = lastSheet
      }
    }

    const previewRows = rawResult.preview?.headers
      ? [
        rawResult.preview.headers.map((item) => String(item)),
        ...(rawResult.preview.rows ?? []).map((row) => row.map((item) => formatSpreadsheetCell(item))),
      ]
      : null

    return {
      createdSheetName: rawResult.createdSheetNames?.[rawResult.createdSheetNames.length - 1],
      chartFileName: rawResult.chartPaths?.[0] ? path.basename(rawResult.chartPaths[0]) : undefined,
      message: [
        `已执行 Python 脚本计划${script.summary ? `：${script.summary}` : ''}`,
        '',
        rawResult.message || '已完成脚本执行。',
        ...(rawResult.createdSheetNames?.length ? ['', `- 输出工作表：${rawResult.createdSheetNames.join('、')}`] : []),
        ...(previewRows ? ['', '**结果预览**', '', renderSpreadsheetPreview(previewRows)] : []),
        ...(rawResult.chartPaths?.length ? ['', `- 生成图表：${rawResult.chartPaths.map((item) => path.basename(item)).join('、')}`] : []),
      ].join('\n'),
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

async function runPythonProcess(scriptPath: string, cwd: string) {
  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn('python', [scriptPath], {
      cwd,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let finished = false
    const timer = setTimeout(() => {
      if (finished) return
      child.kill()
      reject(new Error('Python 脚本执行超时'))
    }, PYTHON_SCRIPT_TIMEOUT_MS)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      finished = true
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (finished) return
      finished = true
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(new Error(stderr.trim() || stdout.trim() || `Python 脚本执行失败，退出码 ${code}`))
    })
  })
}

function createChartForSheet(session: SpreadsheetSession, sheetName: string, chartType: SpreadsheetChartType) {
  const sheet = session.workbook.Sheets[sheetName]
  if (!sheet) {
    throw new Error('未找到可生成图表的工作表')
  }

  const rows = getSheetRows(sheet)
    .map((row) => row.map((cell) => formatSpreadsheetCell(cell)))
    .filter((row) => row.some(Boolean))

  if (rows.length < 2) {
    throw new Error('当前工作表数据不足，无法生成图表')
  }

  const headerRow = rows[0]
  const valueColumnIndex = headerRow.length - 1
  if (valueColumnIndex < 1) {
    throw new Error('当前工作表缺少可用于绘图的数值列')
  }

  const labels = rows.slice(1).map((row) => row.slice(0, valueColumnIndex).join(' / ') || '(空)')
  const values = rows.slice(1).map((row) => parseNumericValue(row[valueColumnIndex]) ?? 0)
  if (labels.length === 0 || values.every((value) => value === 0)) {
    throw new Error('当前工作表缺少有效的图表数据')
  }

  const chartTitle = `${sheetName} 图表`
  const chartFileName = `${sheetName}.svg`
  const svgContent = buildChartSvg(chartType, chartTitle, labels, values)
  session.generatedCharts = session.generatedCharts.filter((chart) => chart.fileName !== chartFileName)
  session.generatedCharts.push({
    fileName: chartFileName,
    title: chartTitle,
    svgContent,
  })

  return {
    chartFileName,
    chartMarkdown: buildChartMarkdown(chartTitle, svgContent),
    preview: renderSpreadsheetPreview(rows),
  }
}

function matchesFilter(record: Record<string, unknown>, filter: SpreadsheetFilter) {
  const actualValue = formatSpreadsheetCell(record[filter.column]).trim()
  const expectedValue = filter.value.trim()

  if (filter.operator === 'contains') {
    return actualValue.includes(expectedValue)
  }

  if (filter.operator === 'eq') {
    return actualValue === expectedValue
  }

  const actualNumericValue = parseNumericValue(actualValue)
  const expectedNumericValue = parseNumericValue(expectedValue)
  if (actualNumericValue === null || expectedNumericValue === null) {
    return false
  }

  if (filter.operator === 'gt') return actualNumericValue > expectedNumericValue
  if (filter.operator === 'gte') return actualNumericValue >= expectedNumericValue
  if (filter.operator === 'lt') return actualNumericValue < expectedNumericValue
  if (filter.operator === 'lte') return actualNumericValue <= expectedNumericValue
  return false
}

function matchesFilters(record: Record<string, unknown>, filters: SpreadsheetFilter[]) {
  if (filters.length === 0) return true

  const groupedFilters = new Map<string, SpreadsheetFilter[]>()
  for (const filter of filters) {
    const groupKey = `${filter.column}::${filter.operator}`
    const group = groupedFilters.get(groupKey) ?? []
    group.push(filter)
    groupedFilters.set(groupKey, group)
  }

  return Array.from(groupedFilters.values()).every((group) => {
    if (group.length === 1) {
      return matchesFilter(record, group[0])
    }

    const operator = group[0].operator
    if (operator === 'contains' || operator === 'eq') {
      return group.some((filter) => matchesFilter(record, filter))
    }

    return group.every((filter) => matchesFilter(record, filter))
  })
}

function resolveSelectedColumns(headers: string[], requested?: string[]) {
  if (!requested || requested.length === 0) {
    return headers
  }

  const resolved = requested
    .map((column) => resolveHeader(column, headers))
    .filter((column): column is string => Boolean(column))

  return resolved.length > 0 ? resolved : headers
}

function executeFilterRowsPlan(session: SpreadsheetSession, plan: SpreadsheetExecutionPlan) {
  const { resolvedSheetName, headers } = resolveSheetHeaders(session.workbook, plan.sourceSheetName)
  const sheet = session.workbook.Sheets[resolvedSheetName]
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    raw: false,
    defval: '',
  })

  const filters = (plan.filters ?? [])
    .map((filter) => {
      const resolvedColumn = resolveHeader(filter.column, headers)
      if (!resolvedColumn) return null
      return { column: resolvedColumn, operator: filter.operator, value: filter.value }
    })
    .filter((filter): filter is SpreadsheetFilter => Boolean(filter))

  let filteredRecords = filters.length > 0
    ? records.filter((record) => matchesFilters(record, filters))
    : records

  if (plan.sortBy) {
    const sortColumn = resolveHeader(plan.sortBy, headers)
    if (sortColumn) {
      const direction = plan.sortDirection === 'asc' ? 1 : -1
      filteredRecords = [...filteredRecords].sort((left, right) => {
        const leftValue = formatSpreadsheetCell(left[sortColumn])
        const rightValue = formatSpreadsheetCell(right[sortColumn])
        const leftNumeric = parseNumericValue(leftValue)
        const rightNumeric = parseNumericValue(rightValue)
        if (leftNumeric !== null && rightNumeric !== null && leftNumeric !== rightNumeric) {
          return (leftNumeric - rightNumeric) * direction
        }
        return leftValue.localeCompare(rightValue, 'zh-CN') * direction
      })
    }
  }

  if (plan.topN && plan.topN > 0) {
    filteredRecords = filteredRecords.slice(0, Math.floor(plan.topN))
  }

  const selectedColumns = resolveSelectedColumns(headers, plan.selectColumns)
  const rows: string[][] = [selectedColumns]
  filteredRecords.forEach((record) => {
    rows.push(selectedColumns.map((column) => formatSpreadsheetCell(record[column])))
  })

  const targetSheetName = plan.targetSheetName || `筛选结果_${Date.now()}`
  const written = writeRowsToSheet(session, targetSheetName, rows)
  const filterLabel = filters.length > 0
    ? filters.map((filter) => `${filter.column}${filter.operator}${filter.value}`).join('，')
    : '无'

  return {
    createdSheetName: written.sheetName,
    message: [
      `已筛选并生成工作表《${written.sheetName}》。`,
      '',
      `- 来源工作表：${resolvedSheetName}`,
      `- 筛选条件：${filterLabel}`,
      `- 保留列：${selectedColumns.join(' | ')}`,
      `- 输出行数：${filteredRecords.length}`,
      ...(plan.sortBy ? [`- 排序：${plan.sortBy} ${plan.sortDirection === 'asc' ? '升序' : '降序'}`] : []),
      ...(plan.topN ? [`- 结果范围：前 ${Math.floor(plan.topN)} 行`] : []),
      '',
      '**结果预览**',
      '',
      written.preview,
    ].join('\n'),
  }
}

function executeSpreadsheetOperation(session: SpreadsheetSession, operation: SpreadsheetOperation) {
  const sheet = session.workbook.Sheets[operation.sourceSheetName]
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    raw: false,
    defval: '',
  })
  const filteredRecords = operation.filters.length > 0
    ? records.filter((record) => matchesFilters(record, operation.filters))
    : records

  if (filteredRecords.length === 0) {
    throw new Error('所选工作表没有可汇总的数据')
  }

  const grouped = new Map<string, { count: number; sum: number; groupValues: string[] }>()

  for (const record of filteredRecords) {
    const groupValues = operation.groupByColumns.map((column) => formatSpreadsheetCell(record[column]) || '(空)')
    const groupKey = groupValues.join(' || ')
    const current = grouped.get(groupKey) ?? { count: 0, sum: 0, groupValues }
    current.count += 1

    if (operation.kind !== 'count') {
      const numericValue = parseNumericValue(record[operation.valueColumn])
      if (numericValue !== null) {
        current.sum += numericValue
      }
    }

    grouped.set(groupKey, current)
  }

  const resultRows: string[][] = operation.kind === 'count'
    ? [[...operation.groupByColumns, '数量']]
    : [[...operation.groupByColumns, operation.kind === 'avg' ? `${operation.valueColumn}平均值` : `${operation.valueColumn}汇总值`]]

  const sortedGroups = Array.from(grouped.entries())
    .sort((left, right) => {
      const leftMetrics = left[1]
      const rightMetrics = right[1]
      const leftValue = operation.kind === 'count'
        ? leftMetrics.count
        : operation.kind === 'avg'
          ? (leftMetrics.count > 0 ? leftMetrics.sum / leftMetrics.count : 0)
          : leftMetrics.sum
      const rightValue = operation.kind === 'count'
        ? rightMetrics.count
        : operation.kind === 'avg'
          ? (rightMetrics.count > 0 ? rightMetrics.sum / rightMetrics.count : 0)
          : rightMetrics.sum

      if (rightValue !== leftValue) {
        return rightValue - leftValue
      }

      return left[0].localeCompare(right[0], 'zh-CN')
    })

  const limitedGroups = operation.topN ? sortedGroups.slice(0, operation.topN) : sortedGroups

  limitedGroups
    .forEach(([, metrics]) => {
      const value = operation.kind === 'count'
        ? metrics.count
        : operation.kind === 'avg'
          ? (metrics.count > 0 ? metrics.sum / metrics.count : 0)
          : metrics.sum
      resultRows.push([...metrics.groupValues, Number.isInteger(value) ? String(value) : value.toFixed(2)])
    })

  const createdSheetName = makeUniqueSheetName(session.workbook, operation.targetSheetName)
  const nextSheet = XLSX.utils.aoa_to_sheet(resultRows)
  session.workbook.Sheets[createdSheetName] = nextSheet
  session.workbook.SheetNames.push(createdSheetName)
  session.lastCreatedSheetName = createdSheetName

  let chartFileName: string | null = null
  let chartMarkdown: string | null = null
  if (operation.chartType) {
    const labels = resultRows.slice(1).map((row) => row.slice(0, operation.groupByColumns.length).join(' / '))
    const values = resultRows.slice(1).map((row) => parseNumericValue(row[row.length - 1]) ?? 0)
    const chartTitle = `${createdSheetName} 图表`
    chartFileName = `${createdSheetName}.svg`
    session.generatedCharts = session.generatedCharts.filter((chart) => chart.fileName !== chartFileName)
    session.generatedCharts.push({
      fileName: chartFileName,
      title: chartTitle,
      svgContent: buildChartSvg(operation.chartType, chartTitle, labels, values),
    })
    chartMarkdown = buildChartMarkdown(chartTitle, session.generatedCharts[session.generatedCharts.length - 1].svgContent)
  }

  const preview = renderSpreadsheetPreview(resultRows)
  const groupLabel = operation.groupByColumns.map((column) => `“${column}”`).join(' + ')
  const actionLabel = operation.kind === 'count'
    ? `按${groupLabel}计数`
    : operation.kind === 'avg'
      ? `按${groupLabel}统计“${operation.valueColumn}”平均值`
      : `按${groupLabel}汇总“${operation.valueColumn}”`
  const filterLabel = operation.filters.length > 0
    ? `筛选条件：${operation.filters.map((filter) => {
      const operatorLabel = filter.operator === 'contains'
        ? '包含'
        : filter.operator === 'gt'
          ? '>'
          : filter.operator === 'gte'
            ? '>='
            : filter.operator === 'lt'
              ? '<'
              : filter.operator === 'lte'
                ? '<='
                : '='
      return `${filter.column}${operatorLabel}${filter.value}`
    }).join('，')}`
    : '筛选条件：无'

  return {
    createdSheetName,
    message: [
      `已在${session.fileType.toUpperCase()}会话中新增工作表《${createdSheetName}》。`,
      '',
      `- 来源工作表：${operation.sourceSheetName}`,
      `- ${filterLabel}`,
      `- 执行操作：${actionLabel}`,
      `- 参与汇总行数：${filteredRecords.length}`,
      ...(operation.topN ? [`- 结果范围：按结果值降序取前 ${operation.topN} 项`] : []),
      '',
      '**结果预览**',
      '',
      preview,
      '',
      ...(chartMarkdown ? [chartMarkdown, ''] : []),
      ...(chartFileName
        ? [`已生成图表文件：${chartFileName}，导出表格时会一并导出。`, '']
        : []),
      '说明：当前结果已保存在本次应用会话里，后续我可以继续基于这个新工作表做分析或再次汇总。',
    ].join('\n'),
  }
}

function getDefaultExportFileName(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.')
  const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName
  return `${baseName}_处理结果.xlsx`
}

export function exportSpreadsheetSession(sessionId: string) {
  const session = getSpreadsheetSession(sessionId)
  if (!session) {
    throw new Error('当前表格会话已失效，请重新上传文件后再试。')
  }

  const buffer = XLSX.write(session.workbook, {
    type: 'buffer',
    bookType: 'xlsx',
    compression: true,
  })

  return {
    buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
    defaultFileName: getDefaultExportFileName(session.fileName),
    charts: session.generatedCharts,
  }
}

export async function extractDocumentText(
  request: ExtractDocumentTextRequest
): Promise<ExtractDocumentTextResult> {
  const fileType = getSupportedDocumentType(request.fileName, request.mimeType)
  if (!fileType) {
    return {
      ok: false,
      error: '暂不支持自动提取该文件类型',
    }
  }

  const buffer = Buffer.from(request.data)
  if (buffer.byteLength === 0) {
    return {
      ok: false,
      fileType,
      error: '文件为空，无法提取文本',
    }
  }

  if (buffer.byteLength > MAX_INPUT_BYTES) {
    return {
      ok: false,
      fileType,
      error: '文件过大，暂不支持自动提取（上限 20 MB）',
    }
  }

  try {
    const spreadsheetResult = fileType === 'xlsx' || fileType === 'csv'
      ? await extractSpreadsheetSummary(buffer, request.fileName, fileType)
      : null
    const content =
      fileType === 'docx'
        ? await extractDocxSummary(buffer)
        : fileType === 'pptx'
          ? await extractPptxSummary(buffer)
          : fileType === 'xlsx' || fileType === 'csv'
            ? spreadsheetResult!.content
            : await extractPdfSummary(buffer)

    return {
      ok: true,
      fileType,
      content,
      spreadsheetSessionId: spreadsheetResult?.spreadsheetSessionId,
    }
  } catch (error) {
    return {
      ok: false,
      fileType,
      error: error instanceof Error ? error.message : '自动提取文本失败',
    }
  }
}

export async function executeSpreadsheetInstruction(
  request: ExecuteSpreadsheetInstructionRequest
): Promise<ExecuteSpreadsheetInstructionResult> {
  const session = getSpreadsheetSession(request.sessionId)
  if (!session) {
    return {
      ok: false,
      performed: false,
      message: '当前 Excel 会话已失效，请重新上传文件后再试。',
    }
  }

  const operation = inferSpreadsheetOperation(session.workbook, request.instruction)
  if (!operation) {
    const chartType = detectChartType(request.instruction)
    if (chartType && session.lastCreatedSheetName) {
      try {
        const chartResult = createChartForSheet(session, session.lastCreatedSheetName, chartType)
        return {
          ok: true,
          performed: true,
          createdSheetName: session.lastCreatedSheetName,
          message: [
            `已基于最近生成的工作表《${session.lastCreatedSheetName}》创建图表。`,
            '',
            '**数据预览**',
            '',
            chartResult.preview,
            '',
            chartResult.chartMarkdown,
            '',
            `已生成图表文件：${chartResult.chartFileName}，导出表格时会一并导出。`,
          ].join('\n'),
        }
      } catch (error) {
        return {
          ok: false,
          performed: false,
          message: error instanceof Error ? error.message : '生成图表失败',
        }
      }
    }

    return {
      ok: true,
      performed: false,
      message: `暂时支持这些表格指令：\n1. 按单列或双列分组计数/求和/平均值\n2. 支持筛选条件：=、>、>=、<、<=、包含\n3. 生成新工作表、图表，或导出为新的 Excel 文件\n\n例如：\n- 单据状态=单据未完成，按责任人计数，生成新工作表\n- 金额>1000，按部门+责任人汇总金额，生成柱状图\n- 备注包含返工，按责任人统计金额平均值并生成折线图`,
    }
  }

  try {
    const result = executeSpreadsheetOperation(session, operation)
    return {
      ok: true,
      performed: true,
      message: result.message,
      createdSheetName: result.createdSheetName,
    }
  } catch (error) {
    return {
      ok: false,
      performed: false,
      message: error instanceof Error ? error.message : '执行 Excel 指令失败',
    }
  }
}

export async function executeSpreadsheetPlan(
  request: ExecuteSpreadsheetPlanRequest
): Promise<ExecuteSpreadsheetInstructionResult> {
  const session = getSpreadsheetSession(request.sessionId)
  if (!session) {
    return {
      ok: false,
      performed: false,
      message: '当前表格会话已失效，请重新上传文件后再试。',
    }
  }

  try {
    const normalizedPlan = normalizeStepBasedPlan(request.plan)

    if (normalizedPlan.intent === 'export') {
      return {
        ok: true,
        performed: false,
        message: '该计划是导出操作，请使用导出入口执行。',
      }
    }

    if (normalizedPlan.intent === 'script') {
      const scriptResult = await runSpreadsheetScriptPlan(session, normalizedPlan)
      return {
        ok: true,
        performed: true,
        createdSheetName: scriptResult.createdSheetName,
        message: scriptResult.message,
      }
    }

    if (normalizedPlan.intent === 'filter_rows' || normalizedPlan.intent === 'detail_filter') {
      const result = executeFilterRowsPlan(session, normalizedPlan)
      return {
        ok: true,
        performed: true,
        createdSheetName: result.createdSheetName,
        message: result.message,
      }
    }

    if (normalizedPlan.intent === 'chart') {
      const chartType = normalizedPlan.chartType ?? 'bar'
      const sheetName = normalizedPlan.useLastCreatedSheet
        ? session.lastCreatedSheetName
        : normalizedPlan.sourceSheetName ?? session.lastCreatedSheetName
      if (!sheetName) {
        return {
          ok: false,
          performed: false,
          message: '当前没有可用于生成图表的结果工作表，请先做一次统计或汇总。',
        }
      }

      const chartResult = createChartForSheet(session, sheetName, chartType)
      return {
        ok: true,
        performed: true,
        createdSheetName: sheetName,
        message: [
          `已基于工作表《${sheetName}》创建图表。`,
          '',
          '**数据预览**',
          '',
          chartResult.preview,
          '',
          chartResult.chartMarkdown,
          '',
          `已生成图表文件：${chartResult.chartFileName}，导出表格时会一并导出。`,
        ].join('\n'),
      }
    }

    const operation = resolvePlanToOperation(session.workbook, normalizedPlan)
    if (!operation) {
      return {
        ok: false,
        performed: false,
        message: '未能将该执行计划转换为表格操作。',
      }
    }

    const result = executeSpreadsheetOperation(session, operation)
    return {
      ok: true,
      performed: true,
      message: result.message,
      createdSheetName: result.createdSheetName,
    }
  } catch (error) {
    return {
      ok: false,
      performed: false,
      message: error instanceof Error ? error.message : '执行表格计划失败',
    }
  }
}
