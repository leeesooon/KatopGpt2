import type { ReactNode } from 'react'
import { getRoleAvatarDefinition } from '../services/roleAvatars'
import type { RoleAvatarDefinition, RoleAvatarFeature } from '../services/roleAvatars'

type RoleAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

interface RoleAvatarProps {
  avatarId?: string | null
  emoji?: string | null
  size?: RoleAvatarSize
  className?: string
  title?: string
}

const SIZE_CLASS_NAMES: Record<RoleAvatarSize, string> = {
  xs: 'h-6 w-6 rounded-lg text-[10px]',
  sm: 'h-8 w-8 rounded-lg text-xs',
  md: 'h-10 w-10 rounded-xl text-sm',
  lg: 'h-14 w-14 rounded-2xl text-lg',
  xl: 'h-24 w-24 rounded-[1.75rem] text-3xl',
}

const ACCENT_CLASS_NAMES: Record<RoleAvatarDefinition['accent'], string> = {
  amber: 'from-amber-100 via-stone-50 to-amber-300/80',
  sky: 'from-sky-100 via-stone-50 to-sky-300/80',
  emerald: 'from-emerald-100 via-stone-50 to-emerald-300/80',
  rose: 'from-rose-100 via-stone-50 to-rose-300/80',
  cyan: 'from-cyan-100 via-stone-50 to-cyan-300/80',
  teal: 'from-teal-100 via-stone-50 to-teal-300/80',
  violet: 'from-violet-100 via-stone-50 to-violet-300/80',
  orange: 'from-orange-100 via-stone-50 to-orange-300/80',
  slate: 'from-slate-100 via-stone-50 to-slate-300/80',
}

function hasFeature(definition: RoleAvatarDefinition, feature: RoleAvatarFeature) {
  return definition.features.includes(feature)
}

function renderHair(definition: RoleAvatarDefinition) {
  if (definition.hair === 'none') return null
  if (definition.hair === 'side') {
    return <path d="M31 34c2-12 13-20 28-14 5 2 8 7 8 13-8-5-19-6-36 1Z" fill="#0f172a" />
  }
  if (definition.hair === 'short') {
    return <path d="M31 33c3-10 11-16 23-14 8 1 13 6 14 14-12-6-24-6-37 0Z" fill="#0f172a" />
  }
  if (definition.hair === 'waves') {
    return <path d="M29 36c1-11 9-18 19-18 12 0 19 7 20 18-7-5-11 2-18-2-6-4-12 2-21 2Z" fill="#0f172a" />
  }
  if (definition.hair === 'cap') {
    return (
      <>
        <path d="M31 30c5-8 26-9 34 0v7H31v-7Z" fill="#0f172a" />
        <path d="M28 37h42" stroke="#0f172a" strokeWidth="4" strokeLinecap="round" />
      </>
    )
  }
  return <path d="M30 34c3-11 11-17 22-16 11 1 17 8 18 19-12-7-23-8-40-3Z" fill="#0f172a" />
}

function renderGlasses() {
  return (
    <g stroke="#0f172a" strokeWidth="3" fill="none" strokeLinecap="round">
      <circle cx="40" cy="43" r="6" />
      <circle cx="56" cy="43" r="6" />
      <path d="M46 43h4M34 42l-5-2M62 42l5-2" />
    </g>
  )
}

function renderHeadset() {
  return (
    <g stroke="#0f172a" strokeWidth="3" fill="none" strokeLinecap="round">
      <path d="M30 42c0-14 8-24 19-24s18 10 18 24" />
      <path d="M28 42v8M68 42v8" />
      <path d="M67 51c-2 7-7 10-14 10" />
      <circle cx="52" cy="61" r="2" fill="#0f172a" />
    </g>
  )
}

function renderFeatureBadge(definition: RoleAvatarDefinition) {
  return (
    <g>
      <rect x="58" y="60" width="25" height="18" rx="7" fill="#f8fafc" stroke="#0f172a" strokeWidth="3" />
      <text
        x="70.5"
        y="72.8"
        textAnchor="middle"
        fontSize={definition.glyph.length > 2 ? 7 : 10}
        fontWeight="800"
        fill="#0f172a"
      >
        {definition.glyph}
      </text>
    </g>
  )
}

function renderDeskFeature(definition: RoleAvatarDefinition) {
  if (hasFeature(definition, 'chart')) {
    return (
      <g stroke="#0f172a" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 75h24" />
        <path d="M23 75V63M31 75V57M39 75V66" />
        <path d="M22 55l8 5 12-12" />
      </g>
    )
  }
  if (hasFeature(definition, 'globe')) {
    return (
      <g stroke="#0f172a" strokeWidth="3" fill="none" strokeLinecap="round">
        <circle cx="29" cy="67" r="10" />
        <path d="M19 67h20M29 57c3 3 4 17 0 20M29 57c-3 3-4 17 0 20" />
      </g>
    )
  }
  if (hasFeature(definition, 'kanban')) {
    return (
      <g stroke="#0f172a" strokeWidth="3" fill="none" strokeLinecap="round">
        <rect x="18" y="58" width="26" height="18" rx="4" />
        <path d="M27 58v18M36 58v18M22 64h3M31 69h2M39 63h2" />
      </g>
    )
  }
  if (hasFeature(definition, 'book') || hasFeature(definition, 'reader')) {
    return (
      <g stroke="#0f172a" strokeWidth="3" fill="#f8fafc" strokeLinejoin="round">
        <path d="M17 61c7-3 13-2 18 3v14c-5-4-11-5-18-2V61Z" />
        <path d="M35 64c5-5 11-6 18-3v15c-7-3-13-2-18 2V64Z" />
      </g>
    )
  }
  if (hasFeature(definition, 'pen')) {
    return (
      <g stroke="#0f172a" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 75l5-13 18-18 8 8-18 18-13 5Z" />
        <path d="M39 47l8 8" />
      </g>
    )
  }
  if (hasFeature(definition, 'magnifier')) {
    return (
      <g stroke="#0f172a" strokeWidth="3" fill="none" strokeLinecap="round">
        <circle cx="29" cy="64" r="9" />
        <path d="M36 71l10 8" />
      </g>
    )
  }
  if (hasFeature(definition, 'palette')) {
    return (
      <g stroke="#0f172a" strokeWidth="3" fill="#f8fafc">
        <path d="M29 55c-10 0-15 7-13 15 2 7 10 10 18 7 3-1 3-4 1-6-1-2 1-4 4-4 4 0 6-3 5-6-2-4-7-6-15-6Z" />
        <circle cx="25" cy="63" r="1.5" fill="#0f172a" />
        <circle cx="33" cy="62" r="1.5" fill="#0f172a" />
      </g>
    )
  }
  if (hasFeature(definition, 'scales')) {
    return (
      <g stroke="#0f172a" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M31 55v22M22 59h18M22 59l-6 12h12l-6-12ZM40 59l-6 12h12l-6-12Z" />
      </g>
    )
  }
  if (hasFeature(definition, 'medical')) {
    return (
      <g stroke="#0f172a" strokeWidth="3" fill="none" strokeLinecap="round">
        <path d="M30 57v19M21 66h18" />
        <path d="M17 76h26" />
      </g>
    )
  }
  if (hasFeature(definition, 'coin')) {
    return (
      <g stroke="#0f172a" strokeWidth="3" fill="#f8fafc">
        <circle cx="30" cy="67" r="11" />
        <path d="M30 60v14M25 64c1-3 10-3 10 0 0 5-10 1-10 6 0 4 9 4 11 1" fill="none" strokeLinecap="round" />
      </g>
    )
  }
  if (hasFeature(definition, 'megaphone') || hasFeature(definition, 'sales')) {
    return (
      <g stroke="#0f172a" strokeWidth="3" fill="#f8fafc" strokeLinejoin="round">
        <path d="M18 66h8l16-8v20l-16-7h-8v-5Z" />
        <path d="M25 71l4 9" />
      </g>
    )
  }
  if (hasFeature(definition, 'lamp')) {
    return (
      <g stroke="#0f172a" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M28 56c-7 2-10 11-5 16 2 2 4 4 4 7h9c0-3 1-5 4-8 5-6 0-16-8-16-1 0-3 0-4 1Z" />
        <path d="M27 84h10M29 79h7" />
      </g>
    )
  }
  if (hasFeature(definition, 'hr')) {
    return (
      <g stroke="#0f172a" strokeWidth="3" fill="#f8fafc" strokeLinecap="round">
        <circle cx="24" cy="63" r="5" />
        <circle cx="38" cy="63" r="5" />
        <path d="M15 77c2-7 15-7 18 0M29 77c2-7 15-7 18 0" fill="none" />
      </g>
    )
  }
  return null
}

function renderPerson(definition: RoleAvatarDefinition) {
  return (
    <>
      {hasFeature(definition, 'board') && (
        <rect x="17" y="17" width="62" height="40" rx="8" fill="#f8fafc" stroke="#0f172a" strokeWidth="3" opacity="0.55" />
      )}
      <path d="M24 84c3-15 13-23 25-23s22 8 25 23H24Z" fill="#f8fafc" stroke="#0f172a" strokeWidth="3" />
      {hasFeature(definition, 'bowtie') && (
        <path d="M43 66l-8-5v10l8-5Zm10 0 8-5v10l-8-5Z" fill="#0f172a" />
      )}
      <circle cx="48" cy="40" r="19" fill="#f8fafc" stroke="#0f172a" strokeWidth="3" />
      <path d="M28 43h-6M68 43h6" stroke="#0f172a" strokeWidth="4" strokeLinecap="round" />
      {renderHair(definition)}
      {hasFeature(definition, 'headset') && renderHeadset()}
      {hasFeature(definition, 'glasses') ? renderGlasses() : (
        <g fill="#0f172a">
          <circle cx="41" cy="43" r="2" />
          <circle cx="55" cy="43" r="2" />
        </g>
      )}
      <path d="M43 51c3 3 7 3 10 0" stroke="#0f172a" strokeWidth="3" strokeLinecap="round" fill="none" />
      {hasFeature(definition, 'detective') && (
        <path d="M30 29c5-7 31-8 38 0l-4 5H34l-4-5Z" fill="#0f172a" />
      )}
      {renderDeskFeature(definition)}
      {renderFeatureBadge(definition)}
      {hasFeature(definition, 'spark') && (
        <path d="M77 20l3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z" fill="#0f172a" />
      )}
    </>
  )
}

function renderRobot(definition: RoleAvatarDefinition) {
  return (
    <>
      <path d="M48 19v-7" stroke="#0f172a" strokeWidth="3" strokeLinecap="round" />
      <circle cx="48" cy="10" r="3" fill="#0f172a" />
      <rect x="24" y="23" width="48" height="38" rx="13" fill="#f8fafc" stroke="#0f172a" strokeWidth="3" />
      <circle cx="39" cy="42" r="5" fill="#0f172a" />
      <circle cx="57" cy="42" r="5" fill="#0f172a" />
      <path d="M39 53h18" stroke="#0f172a" strokeWidth="3" strokeLinecap="round" />
      <path d="M22 42h-7M74 42h7" stroke="#0f172a" strokeWidth="4" strokeLinecap="round" />
      <path d="M25 83c3-14 13-21 23-21s20 7 23 21H25Z" fill="#f8fafc" stroke="#0f172a" strokeWidth="3" />
      {renderFeatureBadge(definition)}
    </>
  )
}

function renderOwl(definition: RoleAvatarDefinition) {
  return (
    <>
      <path d="M25 26l9 5c8-8 20-8 28 0l9-5-4 18c3 18-7 35-19 35S26 62 29 44L25 26Z" fill="#f8fafc" stroke="#0f172a" strokeWidth="3" />
      <circle cx="40" cy="45" r="9" fill="#f8fafc" stroke="#0f172a" strokeWidth="3" />
      <circle cx="56" cy="45" r="9" fill="#f8fafc" stroke="#0f172a" strokeWidth="3" />
      <circle cx="40" cy="45" r="3" fill="#0f172a" />
      <circle cx="56" cy="45" r="3" fill="#0f172a" />
      <path d="M48 52l-5 7h10l-5-7Z" fill="#0f172a" />
      <path d="M36 67c8 4 16 4 24 0" stroke="#0f172a" strokeWidth="3" strokeLinecap="round" fill="none" />
      {renderFeatureBadge(definition)}
    </>
  )
}

function renderFox(definition: RoleAvatarDefinition) {
  return (
    <>
      <path d="M23 24l19 13h12l19-13-9 30c-2 16-10 25-16 25s-14-9-16-25L23 24Z" fill="#f8fafc" stroke="#0f172a" strokeWidth="3" />
      <path d="M35 49c4-5 9-5 13 0M48 49c4-5 9-5 13 0" stroke="#0f172a" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M48 56l-5 6h10l-5-6Z" fill="#0f172a" />
      <path d="M41 70c5 3 9 3 14 0" stroke="#0f172a" strokeWidth="3" strokeLinecap="round" fill="none" />
      {renderFeatureBadge(definition)}
    </>
  )
}

function renderAstronaut(definition: RoleAvatarDefinition) {
  return (
    <>
      <circle cx="48" cy="40" r="25" fill="#f8fafc" stroke="#0f172a" strokeWidth="3" />
      <rect x="29" y="30" width="38" height="24" rx="10" fill="#0f172a" />
      <path d="M35 42h26" stroke="#f8fafc" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
      <path d="M26 84c2-16 11-24 22-24s20 8 22 24H26Z" fill="#f8fafc" stroke="#0f172a" strokeWidth="3" />
      <path d="M23 64l-7 10M73 64l7 10" stroke="#0f172a" strokeWidth="4" strokeLinecap="round" />
      {hasFeature(definition, 'rocket') && (
        <path d="M78 18c7 7 6 15-1 23-8 0-16-8-16-16 8-7 15-8 17-7Z" fill="#f8fafc" stroke="#0f172a" strokeWidth="3" />
      )}
      {renderFeatureBadge(definition)}
    </>
  )
}

function renderAvatarSvg(definition: RoleAvatarDefinition) {
  const renderers: Record<RoleAvatarDefinition['kind'], () => ReactNode> = {
    person: () => renderPerson(definition),
    robot: () => renderRobot(definition),
    owl: () => renderOwl(definition),
    fox: () => renderFox(definition),
    astronaut: () => renderAstronaut(definition),
  }

  return (
    <svg viewBox="0 0 96 96" aria-hidden="true" className="h-full w-full">
      <circle cx="16" cy="18" r="5" fill="#0f172a" opacity="0.12" />
      <path d="M15 86c15-6 45-6 66 0" stroke="#0f172a" strokeWidth="3" strokeLinecap="round" opacity="0.15" />
      {renderers[definition.kind]()}
    </svg>
  )
}

export default function RoleAvatar({
  avatarId,
  emoji,
  size = 'md',
  className = '',
  title,
}: RoleAvatarProps) {
  const definition = getRoleAvatarDefinition(avatarId)
  const baseClassName = [
    'inline-flex shrink-0 items-center justify-center overflow-hidden border border-white/15 shadow-inner shadow-white/15',
    SIZE_CLASS_NAMES[size],
    className,
  ].filter(Boolean).join(' ')

  if (!definition) {
    return (
      <span
        className={`${baseClassName} bg-black/20 text-surface-100`}
        title={title}
      >
        <span className="max-w-full truncate px-0.5 leading-none">{emoji || '★'}</span>
      </span>
    )
  }

  return (
    <span
      className={`${baseClassName} bg-gradient-to-br ${ACCENT_CLASS_NAMES[definition.accent]}`}
      title={title ?? definition.name}
    >
      {renderAvatarSvg(definition)}
    </span>
  )
}
