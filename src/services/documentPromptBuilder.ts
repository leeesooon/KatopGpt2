import type { DocumentAgentMode, DocumentSelection, WorkspaceDocument } from '../types'

interface BuildDocumentPromptOptions {
  mode: DocumentAgentMode
  userPrompt: string
  document: WorkspaceDocument | null
  selection: DocumentSelection | null
}

interface DocumentTaskDescriptor {
  prompt: string
  title: string
}

function quoteBlock(label: string, content: string) {
  return `## ${label}\n\n${content.trim()}`
}

export function buildDocumentTaskPrompt({
  mode,
  userPrompt,
  document,
  selection,
}: BuildDocumentPromptOptions): DocumentTaskDescriptor {
  const cleanPrompt = userPrompt.trim()
  const documentTitle = document?.title ?? '未命名文档'
  const documentContent = document?.content.trim() ?? ''
  const hasSelection = Boolean(selection?.text.trim())

  if (mode === 'chat') {
    return {
      prompt: cleanPrompt,
      title: '普通对话',
    }
  }

  const contextSections = [
    '你现在是一个中文 Markdown 文档代理。',
    '请直接输出可用的 Markdown 结果，不要添加多余解释，不要使用代码围栏包裹正文。',
    cleanPrompt ? quoteBlock('用户要求', cleanPrompt) : '',
    document ? quoteBlock('当前文档标题', documentTitle) : '',
    documentContent ? quoteBlock('当前文档内容', documentContent) : '',
  ].filter(Boolean)

  if (mode === 'create') {
    return {
      title: '生成 Markdown 初稿',
      prompt: [
        ...contextSections,
        '## 任务\n\n请根据用户要求生成一份结构清晰、可直接保存的 Markdown 文档初稿。需要有明确标题、分节、小标题和要点列表。',
      ].join('\n\n'),
    }
  }

  if (mode === 'rewrite') {
    const rewriteTask = hasSelection
      ? [
          '## 任务',
          '',
          '请只改写“当前选中内容”本身，输出时必须严格遵守以下要求：',
          '1. 只输出改写后的段落正文，不要添加标题、说明、前言、总结、注释或代码围栏。',
          '2. 不要输出“以下是改写结果”“修改说明”“优化版本”等提示语。',
          '3. 不要复述整篇文档，只返回这个选中片段改写后的最终内容。',
          '4. 保持原有 Markdown 语义；如果选中内容本身是列表、引用或普通段落，就按原结构返回。',
          '5. 如果用户要求不明确，也只输出可直接替换选区的版本，不要提问。',
        ].join('\n')
      : '## 任务\n\n请基于当前文档进行改写，保持 Markdown 结构自然、表达更清晰。输出只包含最终可替换的 Markdown 内容。'

    return {
      title: hasSelection ? '改写选中内容' : '改写当前文档',
      prompt: [
        ...contextSections,
        hasSelection ? quoteBlock('当前选中内容', selection!.text) : '',
        rewriteTask,
      ].filter(Boolean).join('\n\n'),
    }
  }

  if (mode === 'expand') {
    const expandScope = hasSelection
      ? [
          quoteBlock('当前选中内容', selection!.text),
          '## 扩写范围\n\n用户已选中文本。请只围绕这段选中内容生成“新增补充内容”，不要改写或复述选中内容本身。',
        ]
      : [
          '## 扩写范围\n\n用户未选中文本。请基于当前文档结构判断最适合补充的位置，但输出时只给出新增内容片段，不要输出完整文档。',
        ]

    return {
      title: '扩写当前文档',
      prompt: [
        ...contextSections,
        ...expandScope,
        [
          '## 任务',
          '',
          '请生成可直接插入当前 Markdown 文档的“增量扩写内容”。必须严格遵守：',
          '1. 只输出新增/补充的 Markdown 内容，不要输出完整文档。',
          '2. 不要复述、复制或改写“当前文档内容”里的已有段落。',
          '3. 不要输出“以下是扩写内容”“扩写建议”“可以添加”等说明性前后缀。',
          '4. 内容要和现有文档的语气、标题层级、列表风格保持一致。',
          '5. 如果需要小标题，只输出新增小标题和新增正文；如果只需补充段落，就直接输出段落。',
          '6. 如果用户要求不明确，也不要提问，直接给出一段最有价值的增量补充内容。',
        ].join('\n'),
      ].filter(Boolean).join('\n\n'),
    }
  }

  return {
    title: '扩写当前文档',
    prompt: [
      ...contextSections,
      '## 任务\n\n请生成可直接插入当前 Markdown 文档的增量扩写内容。',
    ].join('\n\n'),
  }
}
