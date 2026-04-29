export type RoleAvatarCategory = 'common' | 'profession' | 'animal' | 'abstract'

export type RoleAvatarAccent =
  | 'amber'
  | 'sky'
  | 'emerald'
  | 'rose'
  | 'cyan'
  | 'teal'
  | 'violet'
  | 'orange'
  | 'slate'

export type RoleAvatarKind = 'person' | 'robot' | 'owl' | 'fox' | 'astronaut'

export type RoleAvatarHair = 'short' | 'side' | 'round' | 'waves' | 'cap' | 'none'

export type RoleAvatarFeature =
  | 'spark'
  | 'glasses'
  | 'headset'
  | 'pen'
  | 'book'
  | 'board'
  | 'bowtie'
  | 'kanban'
  | 'chart'
  | 'globe'
  | 'chat'
  | 'magnifier'
  | 'folder'
  | 'megaphone'
  | 'palette'
  | 'scales'
  | 'medical'
  | 'coin'
  | 'support'
  | 'sales'
  | 'hr'
  | 'rocket'
  | 'lamp'
  | 'reader'
  | 'detective'

export interface RoleAvatarDefinition {
  id: string
  name: string
  category: RoleAvatarCategory
  accent: RoleAvatarAccent
  kind: RoleAvatarKind
  hair: RoleAvatarHair
  glyph: string
  features: RoleAvatarFeature[]
}

export const ROLE_AVATAR_CATEGORIES: Array<{ id: RoleAvatarCategory; label: string }> = [
  { id: 'common', label: '常用' },
  { id: 'profession', label: '职业' },
  { id: 'animal', label: '动物' },
  { id: 'abstract', label: '抽象' },
]

export const DEFAULT_BUILT_IN_AVATAR_IDS: Record<string, string> = {
  'builtin-general': 'assistant-general',
  'builtin-engineer': 'assistant-engineer',
  'builtin-writer': 'assistant-writer',
  'builtin-tutor': 'assistant-tutor',
  'builtin-pm': 'assistant-pm',
  'builtin-data-analyst': 'assistant-data',
  'builtin-translator': 'assistant-translator',
  'builtin-researcher': 'assistant-researcher',
}

export const ROLE_AVATAR_DEFINITIONS: RoleAvatarDefinition[] = [
  {
    id: 'assistant-general',
    name: '通用圆脸助手',
    category: 'common',
    accent: 'amber',
    kind: 'person',
    hair: 'round',
    glyph: 'AI',
    features: ['spark'],
  },
  {
    id: 'assistant-engineer',
    name: '代码工程师',
    category: 'common',
    accent: 'sky',
    kind: 'person',
    hair: 'side',
    glyph: '</>',
    features: ['glasses', 'headset'],
  },
  {
    id: 'assistant-writer',
    name: '写作编辑',
    category: 'common',
    accent: 'rose',
    kind: 'person',
    hair: 'short',
    glyph: '文',
    features: ['pen'],
  },
  {
    id: 'assistant-tutor',
    name: '学习导师',
    category: 'common',
    accent: 'emerald',
    kind: 'person',
    hair: 'round',
    glyph: '书',
    features: ['book', 'board'],
  },
  {
    id: 'assistant-pm',
    name: '产品经理',
    category: 'common',
    accent: 'orange',
    kind: 'person',
    hair: 'side',
    glyph: '路',
    features: ['bowtie', 'kanban'],
  },
  {
    id: 'assistant-data',
    name: '数据分析师',
    category: 'common',
    accent: 'cyan',
    kind: 'person',
    hair: 'short',
    glyph: 'Σ',
    features: ['glasses', 'chart'],
  },
  {
    id: 'assistant-translator',
    name: '翻译专家',
    category: 'common',
    accent: 'teal',
    kind: 'person',
    hair: 'waves',
    glyph: '译',
    features: ['globe', 'chat'],
  },
  {
    id: 'assistant-researcher',
    name: '研究助手',
    category: 'common',
    accent: 'violet',
    kind: 'person',
    hair: 'cap',
    glyph: '研',
    features: ['magnifier', 'folder'],
  },
  {
    id: 'avatar-engineer',
    name: '工程师',
    category: 'profession',
    accent: 'sky',
    kind: 'person',
    hair: 'short',
    glyph: '{ }',
    features: ['glasses'],
  },
  {
    id: 'avatar-writer',
    name: '作家',
    category: 'profession',
    accent: 'rose',
    kind: 'person',
    hair: 'waves',
    glyph: '✎',
    features: ['pen'],
  },
  {
    id: 'avatar-teacher',
    name: '教师',
    category: 'profession',
    accent: 'emerald',
    kind: 'person',
    hair: 'round',
    glyph: '课',
    features: ['board', 'book'],
  },
  {
    id: 'avatar-researcher',
    name: '研究员',
    category: 'profession',
    accent: 'violet',
    kind: 'person',
    hair: 'cap',
    glyph: '证',
    features: ['magnifier'],
  },
  {
    id: 'avatar-analyst',
    name: '分析师',
    category: 'profession',
    accent: 'cyan',
    kind: 'person',
    hair: 'side',
    glyph: '%',
    features: ['chart', 'glasses'],
  },
  {
    id: 'avatar-translator',
    name: '翻译',
    category: 'profession',
    accent: 'teal',
    kind: 'person',
    hair: 'short',
    glyph: 'A',
    features: ['globe', 'chat'],
  },
  {
    id: 'avatar-product',
    name: '产品',
    category: 'profession',
    accent: 'orange',
    kind: 'person',
    hair: 'side',
    glyph: 'MVP',
    features: ['kanban'],
  },
  {
    id: 'avatar-operations',
    name: '运营',
    category: 'profession',
    accent: 'amber',
    kind: 'person',
    hair: 'round',
    glyph: '增',
    features: ['megaphone', 'chart'],
  },
  {
    id: 'avatar-designer',
    name: '设计师',
    category: 'profession',
    accent: 'rose',
    kind: 'person',
    hair: 'waves',
    glyph: 'UI',
    features: ['palette'],
  },
  {
    id: 'avatar-lawyer',
    name: '律师',
    category: 'profession',
    accent: 'slate',
    kind: 'person',
    hair: 'side',
    glyph: '法',
    features: ['scales'],
  },
  {
    id: 'avatar-doctor',
    name: '医生',
    category: 'profession',
    accent: 'emerald',
    kind: 'person',
    hair: 'short',
    glyph: '+',
    features: ['medical'],
  },
  {
    id: 'avatar-finance',
    name: '财务',
    category: 'profession',
    accent: 'amber',
    kind: 'person',
    hair: 'round',
    glyph: '¥',
    features: ['coin', 'glasses'],
  },
  {
    id: 'avatar-support',
    name: '客服',
    category: 'profession',
    accent: 'teal',
    kind: 'person',
    hair: 'short',
    glyph: 'Hi',
    features: ['headset', 'support'],
  },
  {
    id: 'avatar-sales',
    name: '销售',
    category: 'profession',
    accent: 'orange',
    kind: 'person',
    hair: 'side',
    glyph: '$',
    features: ['sales', 'chat'],
  },
  {
    id: 'avatar-marketing',
    name: '市场',
    category: 'profession',
    accent: 'rose',
    kind: 'person',
    hair: 'waves',
    glyph: '声',
    features: ['megaphone'],
  },
  {
    id: 'avatar-hr',
    name: 'HR',
    category: 'profession',
    accent: 'sky',
    kind: 'person',
    hair: 'round',
    glyph: '人',
    features: ['hr'],
  },
  {
    id: 'avatar-project-manager',
    name: '项目经理',
    category: 'profession',
    accent: 'violet',
    kind: 'person',
    hair: 'cap',
    glyph: 'GTD',
    features: ['kanban', 'chart'],
  },
  {
    id: 'avatar-creative',
    name: '创意顾问',
    category: 'profession',
    accent: 'amber',
    kind: 'person',
    hair: 'waves',
    glyph: '!',
    features: ['lamp'],
  },
  {
    id: 'avatar-reader',
    name: '阅读者',
    category: 'profession',
    accent: 'emerald',
    kind: 'person',
    hair: 'short',
    glyph: '阅',
    features: ['reader', 'book'],
  },
  {
    id: 'avatar-robot',
    name: '机器人',
    category: 'abstract',
    accent: 'slate',
    kind: 'robot',
    hair: 'none',
    glyph: '01',
    features: ['spark'],
  },
  {
    id: 'avatar-owl',
    name: '猫头鹰',
    category: 'animal',
    accent: 'amber',
    kind: 'owl',
    hair: 'none',
    glyph: '智',
    features: ['glasses'],
  },
  {
    id: 'avatar-fox',
    name: '狐狸',
    category: 'animal',
    accent: 'orange',
    kind: 'fox',
    hair: 'none',
    glyph: '策',
    features: ['spark'],
  },
  {
    id: 'avatar-astronaut',
    name: '宇航员',
    category: 'abstract',
    accent: 'sky',
    kind: 'astronaut',
    hair: 'none',
    glyph: '星',
    features: ['rocket'],
  },
  {
    id: 'avatar-detective',
    name: '侦探',
    category: 'profession',
    accent: 'slate',
    kind: 'person',
    hair: 'cap',
    glyph: '?',
    features: ['detective', 'magnifier'],
  },
]

const ROLE_AVATAR_BY_ID = new Map(ROLE_AVATAR_DEFINITIONS.map((avatar) => [avatar.id, avatar]))

export function getRoleAvatarDefinition(avatarId?: string | null) {
  if (!avatarId) return undefined
  return ROLE_AVATAR_BY_ID.get(avatarId)
}

export function getDefaultAvatarIdForProfile(profileId?: string | null) {
  if (!profileId) return undefined
  return DEFAULT_BUILT_IN_AVATAR_IDS[profileId]
}

export function getRoleAvatarCategoryLabel(category: RoleAvatarCategory) {
  return ROLE_AVATAR_CATEGORIES.find((item) => item.id === category)?.label ?? category
}
