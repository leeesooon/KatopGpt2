import { z } from 'zod'

export interface SpreadsheetPlanFilter {
  column: string
  operator: 'eq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte'
  value: string
}

export type SpreadsheetScriptLanguage = 'python' | 'javascript'

export interface SpreadsheetScriptPlan {
  language: SpreadsheetScriptLanguage
  code: string
  summary?: string
}

export type SpreadsheetPlanStep =
  | {
      op: 'filter'
      conditions: SpreadsheetPlanFilter[]
    }
  | {
      op: 'group_by'
      columns: string[]
    }
  | {
      op: 'aggregate'
      metrics: Array<{
        type: 'count' | 'sum' | 'avg'
        column?: string
        as?: string
      }>
    }
  | {
      op: 'sort'
      by: string
      direction: 'asc' | 'desc'
    }
  | {
      op: 'top_n'
      value: number
    }
  | {
      op: 'select_columns'
      columns: string[]
    }
  | {
      op: 'chart'
      chartType: 'bar' | 'line' | 'pie' | 'horizontalBar'
    }
  | {
      op: 'export'
      target: 'new_sheet' | 'excel_file'
      sheetName?: string
    }

export interface SpreadsheetExecutionPlan {
  intent: 'count' | 'sum' | 'avg' | 'chart' | 'export' | 'script' | 'filter_rows' | 'analysis' | 'detail_filter' | 'aggregation'
  sourceSheetName?: string
  groupByColumns?: string[]
  valueColumn?: string
  filters?: SpreadsheetPlanFilter[]
  selectColumns?: string[]
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
  chartType?: 'bar' | 'line' | 'pie' | 'horizontalBar'
  targetSheetName?: string
  useLastCreatedSheet?: boolean
  topN?: number
  steps?: SpreadsheetPlanStep[]
  explanation?: string
  script?: SpreadsheetScriptPlan
}

export interface SpreadsheetIntentParseResult {
  shouldExecute: boolean
  normalizedInstruction?: string
  plan?: SpreadsheetExecutionPlan
}

export const spreadsheetPlanFilterSchema = z.object({
  column: z.string().min(1),
  operator: z.enum(['eq', 'contains', 'gt', 'gte', 'lt', 'lte']),
  value: z.string(),
})

export const spreadsheetToolStepSchemas = {
  filter: z.object({
    op: z.literal('filter'),
    conditions: z.array(spreadsheetPlanFilterSchema).min(1),
  }),
  group_by: z.object({
    op: z.literal('group_by'),
    columns: z.array(z.string().min(1)).min(1),
  }),
  aggregate: z.object({
    op: z.literal('aggregate'),
    metrics: z.array(z.object({
      type: z.enum(['count', 'sum', 'avg']),
      column: z.string().optional(),
      as: z.string().optional(),
    })).min(1),
  }),
  sort: z.object({
    op: z.literal('sort'),
    by: z.string().min(1),
    direction: z.enum(['asc', 'desc']),
  }),
  top_n: z.object({
    op: z.literal('top_n'),
    value: z.number().int().positive(),
  }),
  select_columns: z.object({
    op: z.literal('select_columns'),
    columns: z.array(z.string().min(1)).min(1),
  }),
  chart: z.object({
    op: z.literal('chart'),
    chartType: z.enum(['bar', 'line', 'pie', 'horizontalBar']),
  }),
  export: z.object({
    op: z.literal('export'),
    target: z.enum(['new_sheet', 'excel_file']),
    sheetName: z.string().optional(),
  }),
} as const

export const spreadsheetPlanStepSchema = z.discriminatedUnion('op', [
  spreadsheetToolStepSchemas.filter,
  spreadsheetToolStepSchemas.group_by,
  spreadsheetToolStepSchemas.aggregate,
  spreadsheetToolStepSchemas.sort,
  spreadsheetToolStepSchemas.top_n,
  spreadsheetToolStepSchemas.select_columns,
  spreadsheetToolStepSchemas.chart,
  spreadsheetToolStepSchemas.export,
])

export const spreadsheetScriptPlanSchema = z.object({
  language: z.enum(['python', 'javascript']),
  code: z.string().min(1),
  summary: z.string().optional(),
})

export const spreadsheetExecutionPlanSchema = z.object({
  intent: z.enum(['count', 'sum', 'avg', 'chart', 'export', 'script', 'filter_rows', 'analysis', 'detail_filter', 'aggregation']),
  sourceSheetName: z.string().optional(),
  groupByColumns: z.array(z.string().min(1)).optional(),
  valueColumn: z.string().optional(),
  filters: z.array(spreadsheetPlanFilterSchema).optional(),
  selectColumns: z.array(z.string().min(1)).optional(),
  sortBy: z.string().optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
  chartType: z.enum(['bar', 'line', 'pie', 'horizontalBar']).optional(),
  targetSheetName: z.string().optional(),
  useLastCreatedSheet: z.boolean().optional(),
  topN: z.number().int().positive().optional(),
  steps: z.array(spreadsheetPlanStepSchema).optional(),
  explanation: z.string().optional(),
  script: spreadsheetScriptPlanSchema.optional(),
})

export const spreadsheetPlannerExecutionPlanSchema = spreadsheetExecutionPlanSchema.superRefine((plan, ctx) => {
  if (plan.script?.language === 'javascript') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'planner 只允许输出 python 脚本',
      path: ['script', 'language'],
    })
  }
})

export const spreadsheetPlannerResultSchema = z.object({
  shouldExecute: z.boolean(),
  normalizedInstruction: z.string().optional(),
  plan: spreadsheetPlannerExecutionPlanSchema.optional(),
})

export const spreadsheetPlannerToolDefinition = {
  type: 'function',
  function: {
    name: 'plan_spreadsheet_task',
    description: '将用户针对 Excel/CSV 的自然语言请求转换为结构化执行计划。优先使用内建步骤，只有内建步骤明显不够时才生成 python 脚本。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        shouldExecute: {
          type: 'boolean',
          description: '是否应该走本地表格执行链路。',
        },
        normalizedInstruction: {
          type: 'string',
          description: '将口语化请求改写成更明确的标准化表格指令。',
        },
        plan: {
          type: 'object',
          additionalProperties: false,
          properties: {
            intent: {
              type: 'string',
              enum: ['analysis', 'detail_filter', 'aggregation', 'chart', 'export', 'script'],
            },
            sourceSheetName: { type: 'string' },
            targetSheetName: { type: 'string' },
            useLastCreatedSheet: { type: 'boolean' },
            explanation: { type: 'string' },
            steps: {
              type: 'array',
              items: {
                oneOf: [
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      op: { type: 'string', enum: ['filter'] },
                      conditions: {
                        type: 'array',
                        minItems: 1,
                        items: {
                          type: 'object',
                          additionalProperties: false,
                          properties: {
                            column: { type: 'string' },
                            operator: { type: 'string', enum: ['eq', 'contains', 'gt', 'gte', 'lt', 'lte'] },
                            value: { type: 'string' },
                          },
                          required: ['column', 'operator', 'value'],
                        },
                      },
                    },
                    required: ['op', 'conditions'],
                  },
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      op: { type: 'string', enum: ['group_by'] },
                      columns: { type: 'array', minItems: 1, items: { type: 'string' } },
                    },
                    required: ['op', 'columns'],
                  },
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      op: { type: 'string', enum: ['aggregate'] },
                      metrics: {
                        type: 'array',
                        minItems: 1,
                        items: {
                          type: 'object',
                          additionalProperties: false,
                          properties: {
                            type: { type: 'string', enum: ['count', 'sum', 'avg'] },
                            column: { type: 'string' },
                            as: { type: 'string' },
                          },
                          required: ['type'],
                        },
                      },
                    },
                    required: ['op', 'metrics'],
                  },
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      op: { type: 'string', enum: ['sort'] },
                      by: { type: 'string' },
                      direction: { type: 'string', enum: ['asc', 'desc'] },
                    },
                    required: ['op', 'by', 'direction'],
                  },
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      op: { type: 'string', enum: ['top_n'] },
                      value: { type: 'integer', minimum: 1 },
                    },
                    required: ['op', 'value'],
                  },
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      op: { type: 'string', enum: ['select_columns'] },
                      columns: { type: 'array', minItems: 1, items: { type: 'string' } },
                    },
                    required: ['op', 'columns'],
                  },
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      op: { type: 'string', enum: ['chart'] },
                      chartType: { type: 'string', enum: ['bar', 'line', 'pie', 'horizontalBar'] },
                    },
                    required: ['op', 'chartType'],
                  },
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      op: { type: 'string', enum: ['export'] },
                      target: { type: 'string', enum: ['new_sheet', 'excel_file'] },
                      sheetName: { type: 'string' },
                    },
                    required: ['op', 'target'],
                  },
                ],
              },
            },
            script: {
              type: 'object',
              additionalProperties: false,
              properties: {
                language: { type: 'string', enum: ['python'] },
                summary: { type: 'string' },
                code: { type: 'string' },
              },
              required: ['language', 'code'],
            },
          },
          required: ['intent'],
        },
      },
      required: ['shouldExecute'],
    },
  },
} as const

export type SpreadsheetToolName = SpreadsheetPlanStep['op']
