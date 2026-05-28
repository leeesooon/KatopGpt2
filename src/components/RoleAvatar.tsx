import { useId, type ReactNode } from 'react'
import { getRoleAvatarDefinition } from '../services/roleAvatars'
import type { RoleAvatarDefinition, RoleAvatarKind } from '../services/roleAvatars'

type RoleAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

interface RoleAvatarProps {
  avatarId?: string | null
  emoji?: string | null
  size?: RoleAvatarSize
  className?: string
  title?: string
}

interface AnimalPalette {
  bg: string
  bgGlow: string
  fur: string
  furDark: string
  furLight: string
  muzzle: string
  inner: string
  nose: string
  blush: string
}

const SIZE_CLASS_NAMES: Record<RoleAvatarSize, string> = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
  xl: 'h-24 w-24 text-3xl',
}

const ANIMAL_PALETTES: Record<RoleAvatarKind, AnimalPalette> = {
  bear: {
    bg: '#fef3c7',
    bgGlow: '#fff7ed',
    fur: '#b7794b',
    furDark: '#7c4a2d',
    furLight: '#d8a16f',
    muzzle: '#fde7c7',
    inner: '#f6c69a',
    nose: '#5b341f',
    blush: '#f9a8a8',
  },
  cat: {
    bg: '#ffe4e6',
    bgGlow: '#fff7ed',
    fur: '#f2b8a2',
    furDark: '#a1624f',
    furLight: '#ffd8c7',
    muzzle: '#fff4ea',
    inner: '#f8aeb2',
    nose: '#9f5258',
    blush: '#fb9aa9',
  },
  deer: {
    bg: '#fef3c7',
    bgGlow: '#fefce8',
    fur: '#c8915f',
    furDark: '#7a5134',
    furLight: '#e8bd83',
    muzzle: '#fff0d8',
    inner: '#f2b98c',
    nose: '#6b3f2b',
    blush: '#f6a7a7',
  },
  dog: {
    bg: '#ffedd5',
    bgGlow: '#fff7ed',
    fur: '#d99b52',
    furDark: '#815126',
    furLight: '#f1c27d',
    muzzle: '#fff2d8',
    inner: '#eeb17a',
    nose: '#4b2a18',
    blush: '#f7a8a8',
  },
  duck: {
    bg: '#fef9c3',
    bgGlow: '#ecfeff',
    fur: '#ffe58f',
    furDark: '#d8a21a',
    furLight: '#fff6bf',
    muzzle: '#fb923c',
    inner: '#fbbf24',
    nose: '#f97316',
    blush: '#fda4af',
  },
  fox: {
    bg: '#ffedd5',
    bgGlow: '#fff7ed',
    fur: '#ee8f3b',
    furDark: '#9a4a1e',
    furLight: '#f7be72',
    muzzle: '#fff4df',
    inner: '#f7b08a',
    nose: '#4a2515',
    blush: '#fb9c9c',
  },
  frog: {
    bg: '#dcfce7',
    bgGlow: '#f0fdfa',
    fur: '#80c77b',
    furDark: '#347a3f',
    furLight: '#b8e6a0',
    muzzle: '#d9f99d',
    inner: '#9ee493',
    nose: '#265c31',
    blush: '#f9a8a8',
  },
  hamster: {
    bg: '#fef3c7',
    bgGlow: '#fff7ed',
    fur: '#e7b66d',
    furDark: '#9c6230',
    furLight: '#ffd994',
    muzzle: '#fff2d8',
    inner: '#f2ba92',
    nose: '#674128',
    blush: '#f8a9a9',
  },
  hedgehog: {
    bg: '#fde68a',
    bgGlow: '#fff7ed',
    fur: '#c99a6b',
    furDark: '#6f4a2d',
    furLight: '#e7c08c',
    muzzle: '#ffe7c2',
    inner: '#e9b487',
    nose: '#4a2b1b',
    blush: '#f3a2a2',
  },
  koala: {
    bg: '#e2e8f0',
    bgGlow: '#f8fafc',
    fur: '#a8b2bf',
    furDark: '#64748b',
    furLight: '#d7dee8',
    muzzle: '#f8fafc',
    inner: '#cbd5e1',
    nose: '#334155',
    blush: '#f3a4b6',
  },
  otter: {
    bg: '#dbeafe',
    bgGlow: '#ecfeff',
    fur: '#a9704a',
    furDark: '#5d3b28',
    furLight: '#d49c6a',
    muzzle: '#fee8c8',
    inner: '#d99d7b',
    nose: '#4b2a1d',
    blush: '#f8a7a7',
  },
  owl: {
    bg: '#ede9fe',
    bgGlow: '#fff7ed',
    fur: '#b18a58',
    furDark: '#6a4a2f',
    furLight: '#dfbd7c',
    muzzle: '#fff2cc',
    inner: '#d6a66f',
    nose: '#e28f2f',
    blush: '#f5a0a8',
  },
  panda: {
    bg: '#e0f2fe',
    bgGlow: '#f8fafc',
    fur: '#f8fafc',
    furDark: '#334155',
    furLight: '#ffffff',
    muzzle: '#ffffff',
    inner: '#cbd5e1',
    nose: '#111827',
    blush: '#f4a0af',
  },
  penguin: {
    bg: '#dbeafe',
    bgGlow: '#f8fafc',
    fur: '#334155',
    furDark: '#0f172a',
    furLight: '#f8fafc',
    muzzle: '#fff7ed',
    inner: '#fbbf24',
    nose: '#f97316',
    blush: '#fda4af',
  },
  rabbit: {
    bg: '#fce7f3',
    bgGlow: '#fff7ed',
    fur: '#f4d8df',
    furDark: '#a97586',
    furLight: '#fff1f5',
    muzzle: '#fff8f8',
    inner: '#f3adc2',
    nose: '#a8556a',
    blush: '#f697ad',
  },
  raccoon: {
    bg: '#e5e7eb',
    bgGlow: '#f8fafc',
    fur: '#9ca3af',
    furDark: '#374151',
    furLight: '#d1d5db',
    muzzle: '#f3f4f6',
    inner: '#cbd5e1',
    nose: '#111827',
    blush: '#f4a0ae',
  },
  seal: {
    bg: '#cffafe',
    bgGlow: '#f8fafc',
    fur: '#cbd5e1',
    furDark: '#64748b',
    furLight: '#eef6ff',
    muzzle: '#ffffff',
    inner: '#d8e6f2',
    nose: '#475569',
    blush: '#f5a2b4',
  },
  squirrel: {
    bg: '#fed7aa',
    bgGlow: '#fff7ed',
    fur: '#c9783d',
    furDark: '#824225',
    furLight: '#edb16f',
    muzzle: '#fff0d0',
    inner: '#e99b70',
    nose: '#4d2c1b',
    blush: '#f8a1a1',
  },
  whale: {
    bg: '#dbeafe',
    bgGlow: '#f0f9ff',
    fur: '#6aa8dc',
    furDark: '#285c8f',
    furLight: '#a9d6f8',
    muzzle: '#e0f2fe',
    inner: '#93c5fd',
    nose: '#1e3a8a',
    blush: '#f4a6b8',
  },
}

const TRIANGLE_EAR_KINDS = new Set<RoleAvatarKind>(['cat', 'fox', 'raccoon', 'squirrel'])
const ROUND_EAR_KINDS = new Set<RoleAvatarKind>(['bear', 'hamster', 'koala', 'panda'])

export default function RoleAvatar({
  avatarId,
  emoji,
  size = 'md',
  className = '',
  title,
}: RoleAvatarProps) {
  const definition = getRoleAvatarDefinition(avatarId)
  const label = title ?? definition?.name
  const fallbackText = emoji || definition?.glyph || '*'
  const baseClassName = [
    'inline-flex shrink-0 items-center justify-center overflow-visible bg-transparent',
    'drop-shadow-[0_5px_10px_rgba(15,23,42,0.32)]',
    SIZE_CLASS_NAMES[size],
    className,
  ].filter(Boolean).join(' ')

  return (
    <span
      className={baseClassName}
      title={label}
    >
      {definition ? (
        <CuteAnimalAvatar definition={definition} />
      ) : (
        <span className="max-w-full truncate px-0.5 leading-none text-surface-100">
          {fallbackText}
        </span>
      )}
    </span>
  )
}

function CuteAnimalAvatar({ definition }: { definition: RoleAvatarDefinition }) {
  const rawId = useId().replace(/:/g, '')
  const palette = ANIMAL_PALETTES[definition.kind]
  const bgId = `role-avatar-bg-${rawId}`

  return (
    <svg
      viewBox="0 0 64 64"
      className="h-full w-full select-none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={bgId} cx="35%" cy="20%" r="76%">
          <stop offset="0%" stopColor={palette.bgGlow} />
          <stop offset="58%" stopColor={palette.bg} />
          <stop offset="100%" stopColor="#dbeafe" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill={`url(#${bgId})`} />
      <circle cx="16" cy="17" r="2.1" fill="#ffffff" opacity="0.72" />
      <circle cx="49" cy="20" r="1.7" fill="#ffffff" opacity="0.58" />
      <circle cx="14" cy="44" r="1.6" fill="#ffffff" opacity="0.52" />
      <circle cx="32" cy="32" r="28" fill="none" stroke="#ffffff" strokeOpacity="0.58" strokeWidth="1.5" />
      {renderAnimal(definition.kind, palette)}
    </svg>
  )
}

function renderAnimal(kind: RoleAvatarKind, palette: AnimalPalette): ReactNode {
  if (kind === 'owl') return renderOwl(palette)
  if (kind === 'penguin') return renderPenguin(palette)
  if (kind === 'duck') return renderDuck(palette)
  if (kind === 'frog') return renderFrog(palette)
  if (kind === 'deer') return renderDeer(palette)
  if (kind === 'seal') return renderSeal(palette)
  if (kind === 'whale') return renderWhale(palette)
  return renderMammal(kind, palette)
}

function renderMammal(kind: RoleAvatarKind, palette: AnimalPalette) {
  return (
    <>
      {kind === 'squirrel' && (
        <path
          d="M44 24C54 23 59 33 54 42C50 49 42 47 41 41C48 41 50 34 44 31Z"
          fill={palette.furLight}
          stroke={palette.furDark}
          strokeOpacity="0.16"
          strokeWidth="1"
        />
      )}
      {kind === 'hedgehog' && (
        <path
          d="M13 29L18 21L20 28L25 19L27 28L32 18L37 28L42 19L44 28L49 21L51 30C48 22 41 17 32 17C23 17 16 22 13 29Z"
          fill={palette.furDark}
          opacity="0.92"
        />
      )}
      {renderMammalEars(kind, palette)}
      <path
        d={kind === 'otter'
          ? 'M17 34C17 23 23 17 32 17C42 17 48 24 47 35C46 46 40 52 32 52C24 52 18 46 17 34Z'
          : 'M16 32C16 22 23 17 32 17C41 17 48 22 48 32C48 43 41 51 32 51C23 51 16 43 16 32Z'}
        fill={palette.fur}
        stroke={palette.furDark}
        strokeOpacity="0.18"
        strokeWidth="1.3"
      />
      {renderMammalMarkings(kind, palette)}
      {renderEyes(kind, palette)}
      <ellipse cx="32" cy="39" rx={kind === 'panda' ? 10 : 8.5} ry="6.8" fill={palette.muzzle} opacity="0.95" />
      <path
        d="M28.5 37C30 35.8 34 35.8 35.5 37L32 40.4Z"
        fill={palette.nose}
      />
      <path d="M32 40.2V42.5M28.8 43.3C30.4 45 33.6 45 35.2 43.3" fill="none" stroke={palette.nose} strokeLinecap="round" strokeWidth="1.4" />
      <circle cx="22.5" cy="39.2" r="2.4" fill={palette.blush} opacity="0.7" />
      <circle cx="41.5" cy="39.2" r="2.4" fill={palette.blush} opacity="0.7" />
      {kind === 'cat' && renderWhiskers(palette)}
      {kind === 'fox' && renderWhiskers(palette)}
      {kind === 'hamster' && renderWhiskers(palette)}
      {kind === 'otter' && renderWhiskers(palette)}
    </>
  )
}

function renderMammalEars(kind: RoleAvatarKind, palette: AnimalPalette) {
  if (kind === 'rabbit') {
    return (
      <>
        <path d="M22 21C15 10 16 3 22 3C29 3 29 16 26 24Z" fill={palette.fur} stroke={palette.furDark} strokeOpacity="0.18" strokeWidth="1.2" />
        <path d="M42 21C49 10 48 3 42 3C35 3 35 16 38 24Z" fill={palette.fur} stroke={palette.furDark} strokeOpacity="0.18" strokeWidth="1.2" />
        <path d="M23 10C24 14 24 18 23 21M41 10C40 14 40 18 41 21" stroke={palette.inner} strokeLinecap="round" strokeWidth="2.2" />
      </>
    )
  }

  if (kind === 'dog') {
    return (
      <>
        <path d="M19 22C12 23 10 30 14 36C20 34 22 28 22 22Z" fill={palette.furDark} opacity="0.92" />
        <path d="M45 22C52 23 54 30 50 36C44 34 42 28 42 22Z" fill={palette.furDark} opacity="0.92" />
      </>
    )
  }

  if (ROUND_EAR_KINDS.has(kind)) {
    return (
      <>
        <circle cx="20" cy="22" r={kind === 'koala' ? 9 : 7.2} fill={palette.furDark} opacity={kind === 'panda' ? 1 : 0.84} />
        <circle cx="44" cy="22" r={kind === 'koala' ? 9 : 7.2} fill={palette.furDark} opacity={kind === 'panda' ? 1 : 0.84} />
        <circle cx="20" cy="22" r={kind === 'koala' ? 4.7 : 3.8} fill={palette.inner} opacity="0.92" />
        <circle cx="44" cy="22" r={kind === 'koala' ? 4.7 : 3.8} fill={palette.inner} opacity="0.92" />
      </>
    )
  }

  if (TRIANGLE_EAR_KINDS.has(kind)) {
    return (
      <>
        <path d="M18 24L14 10L28 18Z" fill={palette.fur} stroke={palette.furDark} strokeOpacity="0.18" strokeWidth="1.2" />
        <path d="M46 24L50 10L36 18Z" fill={palette.fur} stroke={palette.furDark} strokeOpacity="0.18" strokeWidth="1.2" />
        <path d="M19 20L18 14L25 19M45 20L46 14L39 19" fill="none" stroke={palette.inner} strokeLinecap="round" strokeWidth="1.8" />
      </>
    )
  }

  return (
    <>
      <circle cx="21" cy="23" r="5.5" fill={palette.furDark} opacity="0.68" />
      <circle cx="43" cy="23" r="5.5" fill={palette.furDark} opacity="0.68" />
    </>
  )
}

function renderMammalMarkings(kind: RoleAvatarKind, palette: AnimalPalette) {
  if (kind === 'fox') {
    return (
      <>
        <path d="M17 32C22 34 26 38 28 47C22 44 18 38 17 32ZM47 32C42 34 38 38 36 47C42 44 46 38 47 32Z" fill={palette.muzzle} opacity="0.9" />
        <path d="M27 18C29 23 35 23 37 18C36 25 28 25 27 18Z" fill={palette.furLight} opacity="0.65" />
      </>
    )
  }

  if (kind === 'panda') {
    return (
      <>
        <ellipse cx="25" cy="31" rx="7" ry="7.8" fill={palette.furDark} transform="rotate(-18 25 31)" />
        <ellipse cx="39" cy="31" rx="7" ry="7.8" fill={palette.furDark} transform="rotate(18 39 31)" />
      </>
    )
  }

  if (kind === 'raccoon') {
    return (
      <path
        d="M18 30C24 23 40 23 46 30C42 36 36 38 32 38C28 38 22 36 18 30Z"
        fill={palette.furDark}
        opacity="0.9"
      />
    )
  }

  if (kind === 'hedgehog') {
    return (
      <path
        d="M19 31C23 25 29 23 37 24C44 26 48 33 47 39C43 33 37 30 31 30C25 30 21 33 17 39C16 36 17 33 19 31Z"
        fill={palette.furLight}
        opacity="0.8"
      />
    )
  }

  if (kind === 'squirrel') {
    return (
      <path d="M23 21C28 24 36 24 41 21C40 26 24 26 23 21Z" fill={palette.furLight} opacity="0.6" />
    )
  }

  return null
}

function renderEyes(kind: RoleAvatarKind, palette: AnimalPalette) {
  const eyeFill = kind === 'panda' || kind === 'raccoon' || kind === 'penguin'
    ? '#ffffff'
    : '#172033'

  return (
    <>
      <circle cx="25.5" cy="32" r="3.2" fill={eyeFill} />
      <circle cx="38.5" cy="32" r="3.2" fill={eyeFill} />
      <circle cx="26.5" cy="31" r="0.9" fill="#ffffff" opacity={eyeFill === '#ffffff' ? 0 : 0.95} />
      <circle cx="39.5" cy="31" r="0.9" fill="#ffffff" opacity={eyeFill === '#ffffff' ? 0 : 0.95} />
      {(kind === 'panda' || kind === 'raccoon' || kind === 'penguin') && (
        <>
          <circle cx="25.5" cy="32" r="1.55" fill={palette.nose} />
          <circle cx="38.5" cy="32" r="1.55" fill={palette.nose} />
        </>
      )}
    </>
  )
}

function renderWhiskers(palette: AnimalPalette) {
  return (
    <>
      <path d="M17 38L25 40M17 43L25 42M47 38L39 40M47 43L39 42" stroke={palette.furDark} strokeLinecap="round" strokeOpacity="0.42" strokeWidth="1.2" />
    </>
  )
}

function renderOwl(palette: AnimalPalette) {
  return (
    <>
      <path d="M16 29C16 20 23 14 32 17C41 14 48 20 48 29C48 43 41 52 32 52C23 52 16 43 16 29Z" fill={palette.fur} stroke={palette.furDark} strokeOpacity="0.18" strokeWidth="1.3" />
      <path d="M18 23L14 14L25 18ZM46 23L50 14L39 18Z" fill={palette.furDark} opacity="0.82" />
      <circle cx="25" cy="31" r="8" fill={palette.muzzle} />
      <circle cx="39" cy="31" r="8" fill={palette.muzzle} />
      <circle cx="25" cy="31" r="3.1" fill="#172033" />
      <circle cx="39" cy="31" r="3.1" fill="#172033" />
      <circle cx="26" cy="30" r="0.85" fill="#ffffff" />
      <circle cx="40" cy="30" r="0.85" fill="#ffffff" />
      <path d="M32 34L36 38.5L32 42L28 38.5Z" fill={palette.nose} />
      <circle cx="22" cy="41" r="2.2" fill={palette.blush} opacity="0.62" />
      <circle cx="42" cy="41" r="2.2" fill={palette.blush} opacity="0.62" />
    </>
  )
}

function renderPenguin(palette: AnimalPalette) {
  return (
    <>
      <path d="M17 32C17 21 23 14 32 14C41 14 47 21 47 32C47 45 41 53 32 53C23 53 17 45 17 32Z" fill={palette.furDark} />
      <path d="M22 34C22 26 26 21 32 21C38 21 42 26 42 34C42 44 38 50 32 50C26 50 22 44 22 34Z" fill={palette.muzzle} />
      <circle cx="26" cy="29" r="3" fill="#ffffff" />
      <circle cx="38" cy="29" r="3" fill="#ffffff" />
      <circle cx="26" cy="29" r="1.45" fill={palette.nose} />
      <circle cx="38" cy="29" r="1.45" fill={palette.nose} />
      <path d="M29 35L35 35L32 39Z" fill={palette.nose} />
      <circle cx="24" cy="39" r="2.3" fill={palette.blush} opacity="0.7" />
      <circle cx="40" cy="39" r="2.3" fill={palette.blush} opacity="0.7" />
    </>
  )
}

function renderDuck(palette: AnimalPalette) {
  return (
    <>
      <path d="M17 32C17 22 24 17 32 17C41 17 47 23 47 33C47 43 40 51 32 51C24 51 17 43 17 32Z" fill={palette.fur} stroke={palette.furDark} strokeOpacity="0.14" strokeWidth="1.2" />
      <path d="M27 35C30 32 37 32 40 35C38 39 29 39 27 35Z" fill={palette.nose} />
      <circle cx="25.5" cy="30" r="2.7" fill="#172033" />
      <circle cx="38.5" cy="30" r="2.7" fill="#172033" />
      <circle cx="26.4" cy="29.2" r="0.75" fill="#ffffff" />
      <circle cx="39.4" cy="29.2" r="0.75" fill="#ffffff" />
      <path d="M28 21C31 17 36 17 39 21" fill="none" stroke={palette.furLight} strokeLinecap="round" strokeWidth="2.2" />
      <circle cx="23" cy="39" r="2.2" fill={palette.blush} opacity="0.66" />
      <circle cx="41" cy="39" r="2.2" fill={palette.blush} opacity="0.66" />
    </>
  )
}

function renderFrog(palette: AnimalPalette) {
  return (
    <>
      <circle cx="23" cy="23" r="7" fill={palette.fur} />
      <circle cx="41" cy="23" r="7" fill={palette.fur} />
      <path d="M16 34C16 25 23 20 32 20C41 20 48 25 48 34C48 45 41 51 32 51C23 51 16 45 16 34Z" fill={palette.fur} stroke={palette.furDark} strokeOpacity="0.15" strokeWidth="1.2" />
      <circle cx="23" cy="23" r="3.1" fill="#172033" />
      <circle cx="41" cy="23" r="3.1" fill="#172033" />
      <circle cx="24" cy="22" r="0.85" fill="#ffffff" />
      <circle cx="42" cy="22" r="0.85" fill="#ffffff" />
      <path d="M24 38C28 41 36 41 40 38" fill="none" stroke={palette.nose} strokeLinecap="round" strokeWidth="1.8" />
      <circle cx="23" cy="36" r="2.4" fill={palette.blush} opacity="0.7" />
      <circle cx="41" cy="36" r="2.4" fill={palette.blush} opacity="0.7" />
    </>
  )
}

function renderDeer(palette: AnimalPalette) {
  return (
    <>
      <path d="M24 20C21 14 18 10 15 7M21 14L16 14M24 15L27 10M40 20C43 14 46 10 49 7M43 14L48 14M40 15L37 10" fill="none" stroke={palette.furDark} strokeLinecap="round" strokeWidth="1.8" />
      <path d="M20 25L11 19L18 33ZM44 25L53 19L46 33Z" fill={palette.fur} stroke={palette.furDark} strokeOpacity="0.14" />
      <path d="M17 32C17 23 23 17 32 17C41 17 47 23 47 32C47 43 40 51 32 51C24 51 17 43 17 32Z" fill={palette.fur} stroke={palette.furDark} strokeOpacity="0.16" strokeWidth="1.2" />
      <path d="M25 23C28 25 36 25 39 23" fill="none" stroke={palette.furLight} strokeLinecap="round" strokeWidth="2" />
      {renderEyes('deer', palette)}
      <ellipse cx="32" cy="39" rx="8.4" ry="6.5" fill={palette.muzzle} />
      <path d="M29 37C30.5 35.8 33.5 35.8 35 37L32 40Z" fill={palette.nose} />
      <path d="M32 40V42.2M29 43C30.6 44.5 33.4 44.5 35 43" fill="none" stroke={palette.nose} strokeLinecap="round" strokeWidth="1.35" />
      <circle cx="23" cy="39" r="2.3" fill={palette.blush} opacity="0.64" />
      <circle cx="41" cy="39" r="2.3" fill={palette.blush} opacity="0.64" />
    </>
  )
}

function renderSeal(palette: AnimalPalette) {
  return (
    <>
      <path d="M14 36C14 25 23 17 34 18C45 19 51 27 49 38C47 48 39 53 29 51C20 49 14 44 14 36Z" fill={palette.fur} stroke={palette.furDark} strokeOpacity="0.14" strokeWidth="1.2" />
      <path d="M42 42L54 48L43 50Z" fill={palette.furLight} />
      <circle cx="26" cy="32" r="3" fill="#172033" />
      <circle cx="39" cy="32" r="3" fill="#172033" />
      <circle cx="27" cy="31" r="0.8" fill="#ffffff" />
      <circle cx="40" cy="31" r="0.8" fill="#ffffff" />
      <ellipse cx="32.5" cy="39" rx="9.2" ry="6.5" fill={palette.muzzle} />
      <path d="M29 37.2C30.6 36 34.4 36 36 37.2L32.5 40.4Z" fill={palette.nose} />
      {renderWhiskers(palette)}
      <circle cx="23" cy="39" r="2.4" fill={palette.blush} opacity="0.65" />
      <circle cx="42" cy="39" r="2.4" fill={palette.blush} opacity="0.65" />
    </>
  )
}

function renderWhale(palette: AnimalPalette) {
  return (
    <>
      <path d="M10 36C15 25 29 19 45 25C52 28 55 35 51 41C44 51 25 51 13 42C10 40 9 38 10 36Z" fill={palette.fur} stroke={palette.furDark} strokeOpacity="0.16" strokeWidth="1.2" />
      <path d="M45 27L56 20L54 33Z" fill={palette.furLight} />
      <path d="M19 41C27 46 41 44 50 35C47 45 32 51 18 43Z" fill={palette.muzzle} opacity="0.9" />
      <circle cx="25" cy="33" r="2.6" fill="#172033" />
      <circle cx="26" cy="32.2" r="0.72" fill="#ffffff" />
      <path d="M34 35C37 37 42 37 45 35" fill="none" stroke={palette.nose} strokeLinecap="round" strokeWidth="1.5" />
      <circle cx="21" cy="38" r="2.2" fill={palette.blush} opacity="0.68" />
      <path d="M30 22C32 17 32 14 30 11M35 22C38 17 38 14 35 11" stroke="#60a5fa" strokeLinecap="round" strokeOpacity="0.72" strokeWidth="1.7" />
    </>
  )
}
