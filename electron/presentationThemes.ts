import {
  type PresentationThemeId,
} from './shared/presentation'

export interface PresentationExportTheme {
  id: PresentationThemeId
  name: string
  label: string
  primary: string
  secondary: string
  accent: string
  dark: string
  light: string
  paper: string
  muted: string
  card: string
  titleFont: string
  bodyFont: string
  motif: string
}

export const PRESENTATION_EXPORT_THEMES: Record<PresentationThemeId, PresentationExportTheme> = {
  'executive-midnight': {
    id: 'executive-midnight',
    name: 'Midnight Executive',
    label: '午夜商务',
    primary: '1E2761',
    secondary: 'CADCFC',
    accent: 'FFFFFF',
    dark: '12172F',
    light: 'F4F7FF',
    paper: 'F8FAFF',
    muted: '66739A',
    card: 'FFFFFF',
    titleFont: 'Georgia',
    bodyFont: 'Microsoft YaHei UI',
    motif: 'precision orbit',
  },
  'warm-terra': {
    id: 'warm-terra',
    name: 'Warm Terracotta',
    label: '陶土叙事',
    primary: 'B85042',
    secondary: 'E7E8D1',
    accent: 'A7BEAE',
    dark: '3C241E',
    light: 'FFF7ED',
    paper: 'FBF4E8',
    muted: '876B5C',
    card: 'FFFDF8',
    titleFont: 'Palatino Linotype',
    bodyFont: 'Microsoft YaHei UI',
    motif: 'editorial clay blocks',
  },
  'teal-trust': {
    id: 'teal-trust',
    name: 'Teal Trust',
    label: '青绿信任',
    primary: '028090',
    secondary: '00A896',
    accent: '02C39A',
    dark: '073B4C',
    light: 'E6FFFA',
    paper: 'F0FDFA',
    muted: '42747A',
    card: 'FFFFFF',
    titleFont: 'Trebuchet MS',
    bodyFont: 'Microsoft YaHei UI',
    motif: 'connected signal paths',
  },
  'forest-moss': {
    id: 'forest-moss',
    name: 'Forest & Moss',
    label: '森林苔原',
    primary: '2C5F2D',
    secondary: '97BC62',
    accent: 'F5F5F5',
    dark: '172A19',
    light: 'F0F7E8',
    paper: 'FAFDF4',
    muted: '536B4A',
    card: 'FFFFFF',
    titleFont: 'Cambria',
    bodyFont: 'Microsoft YaHei UI',
    motif: 'organic contour layers',
  },
  'coral-energy': {
    id: 'coral-energy',
    name: 'Coral Energy',
    label: '珊瑚动能',
    primary: 'F96167',
    secondary: 'F9E795',
    accent: '2F3C7E',
    dark: '202A5A',
    light: 'FFF8D6',
    paper: 'FFF4EA',
    muted: '7A6670',
    card: 'FFFFFF',
    titleFont: 'Arial Black',
    bodyFont: 'Microsoft YaHei UI',
    motif: 'bold kinetic cuts',
  },
  'charcoal-minimal': {
    id: 'charcoal-minimal',
    name: 'Charcoal Minimal',
    label: '炭黑极简',
    primary: '36454F',
    secondary: 'F2F2F2',
    accent: '212121',
    dark: '111418',
    light: 'F7F7F4',
    paper: 'F6F4EE',
    muted: '6C747C',
    card: 'FFFFFF',
    titleFont: 'Consolas',
    bodyFont: 'Microsoft YaHei UI',
    motif: 'monochrome editorial grid',
  },
  'berry-cream': {
    id: 'berry-cream',
    name: 'Berry & Cream',
    label: '莓果奶油',
    primary: '6D2E46',
    secondary: 'A26769',
    accent: 'ECE2D0',
    dark: '2D1421',
    light: 'FDF4E3',
    paper: 'F8EEDD',
    muted: '856673',
    card: 'FFF9EC',
    titleFont: 'Georgia',
    bodyFont: 'Microsoft YaHei UI',
    motif: 'soft editorial ribbons',
  },
}

export function getPresentationTheme(themeId: PresentationThemeId) {
  return PRESENTATION_EXPORT_THEMES[themeId] ?? PRESENTATION_EXPORT_THEMES['executive-midnight']
}
