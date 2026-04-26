import * as XLSX from 'xlsx'
import type { SpreadsheetColumnSchema, SpreadsheetWorkbookSchema } from './shared/spreadsheetPlan'

export function formatSpreadsheetCell(value: unknown) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return normalizeWhitespace(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  return normalizeWhitespace(String(value))
}

export function getSheetRows(sheet: XLSX.WorkSheet) {
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  }) as unknown[][]
}

export function parseNumericValue(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  const text = formatSpreadsheetCell(value).replace(/,/g, '').trim()
  if (!text) return null

  if (/^-?\d+(?:\.\d+)?%$/.test(text)) {
    const percentValue = Number(text.slice(0, -1))
    return Number.isFinite(percentValue) ? percentValue / 100 : null
  }

  const numericValue = Number(text)
  return Number.isFinite(numericValue) ? numericValue : null
}

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

function buildColumnAliases(name: string) {
  const aliases = new Set<string>()
  const trimmed = name.trim()
  if (!trimmed) return []

  aliases.add(trimmed)
  aliases.add(trimmed.replace(/[\s_\-()（）【】\[\]：:]/g, ''))

  if (trimmed.includes('岗位')) aliases.add('职位')
  if (trimmed.includes('职位')) aliases.add('岗位')
  if (trimmed.includes('部门')) aliases.add('所属部门')
  if (trimmed.includes('所属部门')) aliases.add('部门')
  if (trimmed.includes('姓名')) aliases.add('人员')
  if (trimmed.includes('责任人')) aliases.add('负责人')

  return Array.from(aliases).filter(Boolean)
}

function inferColumnType(values: string[]): SpreadsheetColumnSchema['inferredType'] {
  const samples = values.filter(Boolean).slice(0, 20)
  if (samples.length === 0) return 'empty'

  const kinds = new Set(samples.map((value) => {
    if (/^(true|false)$/i.test(value)) return 'boolean'
    if (!Number.isNaN(Date.parse(value)) && /[-/:年月日T]/.test(value)) return 'date'
    if (parseNumericValue(value) !== null) return 'number'
    return 'string'
  }))

  return kinds.size === 1 ? Array.from(kinds)[0] as SpreadsheetColumnSchema['inferredType'] : 'mixed'
}

export function buildWorkbookSchema(workbook: XLSX.WorkBook): SpreadsheetWorkbookSchema {
  return {
    sheets: workbook.SheetNames.map((sheetName) => {
      const rows = getSheetRows(workbook.Sheets[sheetName]).map((row) => row.map((cell) => formatSpreadsheetCell(cell)))
      const nonEmptyRows = rows.filter((row) => row.some(Boolean))
      const headerRow = nonEmptyRows[0] ?? []
      const columnCount = nonEmptyRows.reduce((count, row) => Math.max(count, row.length), 0)
      const columns = Array.from({ length: columnCount }, (_, index) => {
        const name = headerRow[index] || `列 ${index + 1}`
        const values = nonEmptyRows.slice(1).map((row) => row[index] ?? '')
        return {
          name,
          inferredType: inferColumnType(values),
          aliases: buildColumnAliases(name),
        }
      })

      return {
        name: sheetName,
        rowCount: Math.max(0, nonEmptyRows.length - 1),
        columnCount,
        columns,
      }
    }),
  }
}
