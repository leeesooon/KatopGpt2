export type RoleAvatarCategory = 'common' | 'profession' | 'animal' | 'abstract'

export type RoleAvatarKind =
  | 'bear'
  | 'cat'
  | 'deer'
  | 'dog'
  | 'duck'
  | 'fox'
  | 'frog'
  | 'hamster'
  | 'hedgehog'
  | 'koala'
  | 'otter'
  | 'owl'
  | 'panda'
  | 'penguin'
  | 'rabbit'
  | 'raccoon'
  | 'seal'
  | 'squirrel'
  | 'whale'

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
  kind: RoleAvatarKind
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
    name: '云朵小猫',
    category: 'common',
    kind: 'cat',
    glyph: '喵',
    features: ['spark'],
  },
  {
    id: 'assistant-engineer',
    name: '代码小浣熊',
    category: 'common',
    kind: 'raccoon',
    glyph: '码',
    features: ['glasses', 'headset'],
  },
  {
    id: 'assistant-writer',
    name: '软尾小狐',
    category: 'common',
    kind: 'fox',
    glyph: '写',
    features: ['pen'],
  },
  {
    id: 'assistant-tutor',
    name: '圆眼小猫头鹰',
    category: 'common',
    kind: 'owl',
    glyph: '学',
    features: ['book', 'board'],
  },
  {
    id: 'assistant-pm',
    name: '短腿小柯基',
    category: 'common',
    kind: 'dog',
    glyph: '路',
    features: ['bowtie', 'kanban'],
  },
  {
    id: 'assistant-data',
    name: '图表小熊猫',
    category: 'common',
    kind: 'panda',
    glyph: '数',
    features: ['glasses', 'chart'],
  },
  {
    id: 'assistant-translator',
    name: '双语小企鹅',
    category: 'common',
    kind: 'penguin',
    glyph: '译',
    features: ['globe', 'chat'],
  },
  {
    id: 'assistant-researcher',
    name: '放大镜小水獭',
    category: 'common',
    kind: 'otter',
    glyph: '研',
    features: ['magnifier', 'folder'],
  },
  {
    id: 'avatar-engineer',
    name: '键盘小浣熊',
    category: 'profession',
    kind: 'raccoon',
    glyph: '构',
    features: ['glasses'],
  },
  {
    id: 'avatar-writer',
    name: '墨尾小狐',
    category: 'profession',
    kind: 'fox',
    glyph: '✎',
    features: ['pen'],
  },
  {
    id: 'avatar-teacher',
    name: '讲台小猫头鹰',
    category: 'profession',
    kind: 'owl',
    glyph: '课',
    features: ['board', 'book'],
  },
  {
    id: 'avatar-researcher',
    name: '资料小水獭',
    category: 'profession',
    kind: 'otter',
    glyph: '证',
    features: ['magnifier'],
  },
  {
    id: 'avatar-analyst',
    name: '表格小熊猫',
    category: 'profession',
    kind: 'panda',
    glyph: '%',
    features: ['chart', 'glasses'],
  },
  {
    id: 'avatar-translator',
    name: '翻译小企鹅',
    category: 'profession',
    kind: 'penguin',
    glyph: 'A',
    features: ['globe', 'chat'],
  },
  {
    id: 'avatar-product',
    name: '路线小柯基',
    category: 'profession',
    kind: 'dog',
    glyph: 'MVP',
    features: ['kanban'],
  },
  {
    id: 'avatar-operations',
    name: '松果小松鼠',
    category: 'profession',
    kind: 'squirrel',
    glyph: '增',
    features: ['megaphone', 'chart'],
  },
  {
    id: 'avatar-designer',
    name: '画笔小猫',
    category: 'profession',
    kind: 'cat',
    glyph: 'UI',
    features: ['palette'],
  },
  {
    id: 'avatar-lawyer',
    name: '鹿角小法官',
    category: 'profession',
    kind: 'deer',
    glyph: '法',
    features: ['scales'],
  },
  {
    id: 'avatar-doctor',
    name: '绷带小海豹',
    category: 'profession',
    kind: 'seal',
    glyph: '+',
    features: ['medical'],
  },
  {
    id: 'avatar-finance',
    name: '金币小仓鼠',
    category: 'profession',
    kind: 'hamster',
    glyph: '¥',
    features: ['coin', 'glasses'],
  },
  {
    id: 'avatar-support',
    name: '耳机小兔',
    category: 'profession',
    kind: 'rabbit',
    glyph: 'Hi',
    features: ['headset', 'support'],
  },
  {
    id: 'avatar-sales',
    name: '招手小狗',
    category: 'profession',
    kind: 'dog',
    glyph: '$',
    features: ['sales', 'chat'],
  },
  {
    id: 'avatar-marketing',
    name: '喇叭小鸭',
    category: 'profession',
    kind: 'duck',
    glyph: '声',
    features: ['megaphone'],
  },
  {
    id: 'avatar-hr',
    name: '抱抱小考拉',
    category: 'profession',
    kind: 'koala',
    glyph: '人',
    features: ['hr'],
  },
  {
    id: 'avatar-project-manager',
    name: '排期小刺猬',
    category: 'profession',
    kind: 'hedgehog',
    glyph: 'GTD',
    features: ['kanban', 'chart'],
  },
  {
    id: 'avatar-creative',
    name: '灵感小青蛙',
    category: 'profession',
    kind: 'frog',
    glyph: '!',
    features: ['lamp'],
  },
  {
    id: 'avatar-reader',
    name: '书页小熊',
    category: 'profession',
    kind: 'bear',
    glyph: '阅',
    features: ['reader', 'book'],
  },
  {
    id: 'avatar-robot',
    name: '糖豆小熊',
    category: 'abstract',
    kind: 'bear',
    glyph: '01',
    features: ['spark'],
  },
  {
    id: 'avatar-owl',
    name: '小猫头鹰',
    category: 'animal',
    kind: 'owl',
    glyph: '智',
    features: ['glasses'],
  },
  {
    id: 'avatar-fox',
    name: '小狐狸',
    category: 'animal',
    kind: 'fox',
    glyph: '策',
    features: ['spark'],
  },
  {
    id: 'avatar-astronaut',
    name: '星星小鲸',
    category: 'abstract',
    kind: 'whale',
    glyph: '星',
    features: ['rocket'],
  },
  {
    id: 'avatar-detective',
    name: '侦探小浣熊',
    category: 'profession',
    kind: 'raccoon',
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
