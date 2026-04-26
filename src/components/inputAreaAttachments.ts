export const FILE_INPUT_ACCEPT = '.txt,.md,.markdown,.json,.csv,.pdf,.pptx,.docx,.xlsx'

const EXTRACTABLE_DOCUMENT_EXTENSIONS = ['.pptx', '.pdf', '.docx', '.xlsx', '.csv']

const EXTRACTABLE_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
]

export function looksLikeBinaryText(content: string) {
  if (!content) return false

  const sample = content.slice(0, 4000)
  let suspiciousChars = 0

  for (const char of sample) {
    const code = char.charCodeAt(0)
    const isAllowedControl = code === 9 || code === 10 || code === 13
    const isSuspiciousControl = code === 0 || (code < 32 && !isAllowedControl)
    if (isSuspiciousControl || char === '\u0000' || char === '\u001a' || char === '\u0003') {
      suspiciousChars += 1
    }
  }

  return suspiciousChars > Math.max(8, sample.length * 0.02)
}

export function getFileExtension(fileName: string) {
  const lastDotIndex = fileName.lastIndexOf('.')
  return lastDotIndex >= 0 ? fileName.slice(lastDotIndex).toLowerCase() : ''
}

export function isExtractableDocument(file: File) {
  const extension = getFileExtension(file.name)
  if (EXTRACTABLE_DOCUMENT_EXTENSIONS.includes(extension)) {
    return true
  }

  return EXTRACTABLE_DOCUMENT_MIME_TYPES.includes(file.type)
}

export const IMAGE_PROMPT_PRESETS = [
  { group: '风格', items: ['电影感', '赛博朋克', '水彩插画', '极简海报', '写实摄影', '3D 渲染'] },
  { group: '比例', items: ['1:1 方图', '16:9 横幅', '9:16 竖版', '4:3 构图', '3:2 摄影比例'] },
  { group: '光照', items: ['柔和自然光', '黄昏逆光', '霓虹灯光', '棚拍布光', '高对比明暗'] },
  { group: '镜头', items: ['广角镜头', '长焦压缩', '微距特写', '低角度仰拍', '俯视视角'] },
  { group: '材质', items: ['玻璃质感', '金属材质', '纸张纹理', '丝绸质感', '磨砂塑料'] },
  { group: '构图', items: ['中心构图', '三分法构图', '留白构图', '对称构图', '动态斜线构图'] },
]
