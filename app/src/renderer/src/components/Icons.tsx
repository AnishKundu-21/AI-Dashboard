/**
 * Inline 24px stroke icons. Bundled rather than fetched so the renderer's
 * strict CSP (`default-src 'self'`) needs no exceptions.
 */
import type { SVGProps } from 'react'

export type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconOverview = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7.5" height="8.5" rx="2" />
    <rect x="13.5" y="3" width="7.5" height="5" rx="2" />
    <rect x="13.5" y="11" width="7.5" height="10" rx="2" />
    <rect x="3" y="14.5" width="7.5" height="6.5" rx="2" />
  </Icon>
)

export const IconAnalytics = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 3v15.5A2.5 2.5 0 0 0 5.5 21H21" />
    <path d="M7 15.5l4-4.5 3.2 3 4.8-6.5" />
    <circle cx="7" cy="15.5" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="19" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
  </Icon>
)

export const IconSessions = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M3 9.5h18M9 9.5V20" />
  </Icon>
)

export const IconForecast = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 16.5l5.5-6 3.5 3.2L21 5" />
    <path d="M15.5 5H21v5.5" />
    <path d="M3 21h18" strokeOpacity=".4" />
  </Icon>
)

export const IconHealth = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 12.5h4l2-5.5 3.5 11 2.5-7 1.8 3.5H21" />
  </Icon>
)

export const IconSettings = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 7h14M5 12h14M5 17h14" strokeOpacity=".35" />
    <circle cx="9" cy="7" r="2.4" />
    <circle cx="15" cy="12" r="2.4" />
    <circle cx="8" cy="17" r="2.4" />
  </Icon>
)

export const IconRefresh = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
    <path d="M20.5 4.5V10H15" />
  </Icon>
)

export const IconDownload = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5v11" />
    <path d="M7.5 10.5 12 15l4.5-4.5" />
    <path d="M4.5 17.5v1A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5v-1" />
  </Icon>
)

export const IconSearch = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Icon>
)

export const IconChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 9.5 6 6 6-6" />
  </Icon>
)

export const IconChevronLeft = (p: IconProps) => (
  <Icon {...p}>
    <path d="m14.5 6-6 6 6 6" />
  </Icon>
)

export const IconClose = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
  </Icon>
)

export const IconSun = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
  </Icon>
)

export const IconMoon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 14.2A8.4 8.4 0 0 1 9.8 4 8.5 8.5 0 1 0 20 14.2Z" />
  </Icon>
)

export const IconWarning = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.3 4.2 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9.5v4.2M12 17.2h.01" />
  </Icon>
)

export const IconInfo = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.6h.01" />
  </Icon>
)

export const IconTokens = (p: IconProps) => (
  <Icon {...p}>
    <ellipse cx="12" cy="6.5" rx="7.5" ry="3" />
    <path d="M4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11" />
    <path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" strokeOpacity=".5" />
  </Icon>
)

export const IconCost = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 6.5v11M14.8 9.3a3 3 0 0 0-2.8-1.6c-1.6 0-2.8.9-2.8 2.2 0 3 5.8 1.6 5.8 4.6 0 1.4-1.3 2.3-3 2.3a3.2 3.2 0 0 1-3-1.7" />
  </Icon>
)

export const IconPulse = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" strokeOpacity=".45" />
    <path d="M7 12.4h2.3l1.5-3.6 2.3 7 1.4-3.4H17" />
  </Icon>
)

export const IconGauge = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 17a8.5 8.5 0 1 1 16 0" />
    <path d="m12 12.8 4.2-3.9" />
    <circle cx="12" cy="14" r="1.4" fill="currentColor" stroke="none" />
  </Icon>
)

export const IconShield = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3 5 6v6c0 4.2 2.9 7.7 7 9 4.1-1.3 7-4.8 7-9V6l-7-3Z" />
    <path d="m9.2 12 2 2 3.6-3.8" />
  </Icon>
)

export const IconSpark = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5 13.6 9 19 10.6 13.6 12.2 12 17.7 10.4 12.2 5 10.6 10.4 9 12 3.5Z" />
    <path d="M18.5 16.5 19.2 19l2.3.8-2.3.8-.7 2.4-.7-2.4-2.3-.8 2.3-.8.7-2.5Z" strokeOpacity=".5" />
  </Icon>
)

export const IconClock = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7v5.3l3.2 2" />
  </Icon>
)

export const IconCollapse = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M9.5 4v16" />
  </Icon>
)

export const IconArrowUp = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
)

export const IconArrowDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M18 13l-6 6-6-6" />
  </Icon>
)

export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Icon>
)
