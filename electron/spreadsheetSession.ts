import { randomUUID } from 'crypto'
import * as XLSX from 'xlsx'
import type { SpreadsheetWorkbookSchema } from './shared/spreadsheetPlan'

export type SpreadsheetDocumentType = 'xlsx' | 'csv'

export interface GeneratedChart {
  fileName: string
  title: string
  svgContent: string
}

export interface SpreadsheetSession {
  sessionId: string
  fileName: string
  fileType: SpreadsheetDocumentType
  workbook: XLSX.WorkBook
  schema: SpreadsheetWorkbookSchema
  generatedCharts: GeneratedChart[]
  lastCreatedSheetName?: string
  createdAt: number
}

const spreadsheetSessions = new Map<string, SpreadsheetSession>()

export function registerSpreadsheetSession(fileName: string, fileType: SpreadsheetDocumentType, workbook: XLSX.WorkBook, schema: SpreadsheetWorkbookSchema) {
  const sessionId = randomUUID()
  spreadsheetSessions.set(sessionId, {
    sessionId,
    fileName,
    fileType,
    workbook,
    schema,
    generatedCharts: [],
    lastCreatedSheetName: undefined,
    createdAt: Date.now(),
  })

  return sessionId
}

export function getSpreadsheetSession(sessionId: string) {
  return spreadsheetSessions.get(sessionId) ?? null
}
