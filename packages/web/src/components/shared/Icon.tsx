import type { ReactNode } from 'react';

/**
 * Hand-drawn 24px line icons for the chamber UI. Stroke-only, currentColor,
 * 1.5px weight so they sit quietly next to serif text (emoji were too loud
 * and rendered differently on every OS).
 */
const PATHS = {
  dashboard: (
    <>
      <path d="M4 5.5h16" />
      <path d="M4 5.5v13a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-13" />
      <path d="M8 10h8M8 13.5h8M8 17h5" />
    </>
  ),
  tickets: (
    <>
      <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4Z" />
      <path d="M14.5 6v2M14.5 11v2M14.5 16v2" />
    </>
  ),
  moderation: (
    <>
      <path d="m13.5 4.5 6 6" />
      <path d="m10.5 7.5 6 6" />
      <path d="m12 6 4.5 4.5" />
      <path d="M13.5 12 6 19.5" />
      <path d="M4 20h9" />
    </>
  ),
  bills: (
    <>
      <path d="M8 4h10.5A1.5 1.5 0 0 1 20 5.5V7h-3" />
      <path d="M17 7v11.5a1.5 1.5 0 0 1-1.5 1.5h-9A2.5 2.5 0 0 1 4 17.5V17h9v1.5a1.5 1.5 0 0 0 3 0" />
      <path d="M8 4a2 2 0 0 0-2 2v11" />
      <path d="M9.5 9h4.5M9.5 12.5h4.5" />
    </>
  ),
  documents: (
    <>
      <path d="M14 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V7.5Z" />
      <path d="M14 3.5v4h4" />
      <path d="M9 12h6M9 15.5h6" />
    </>
  ),
  voting: (
    <>
      <path d="M4.5 12.5h15v6a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5Z" />
      <path d="M9 12.5h6" strokeWidth="2.2" />
      <path d="M8.5 12.5V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5v7" />
      <path d="m10.5 8.5 1.2 1.2 2.3-2.4" />
    </>
  ),
  players: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  parties: (
    <>
      <path d="M6 21V4" />
      <path d="M6 4.5h11l-2.5 4 2.5 4H6" />
    </>
  ),
  offices: (
    <>
      <path d="M3.5 9.5 12 4l8.5 5.5" />
      <path d="M4.5 9.5h15" />
      <path d="M6.5 12v6M10 12v6M14 12v6M17.5 12v6" />
      <path d="M3.5 20.5h17" />
    </>
  ),
  favours: (
    <>
      <circle cx="12" cy="11" r="6.5" />
      <path d="m12 7.5 1 2.2 2.4.3-1.8 1.6.5 2.4-2.1-1.2-2.1 1.2.5-2.4-1.8-1.6 2.4-.3Z" />
      <path d="m8.5 16.5-1.5 4 2.5-1 1.2 2.1L12 17.5" />
      <path d="m15.5 16.5 1.5 4-2.5-1-1.2 2.1L12 17.5" />
    </>
  ),
  simulation: (
    <>
      <path d="M6.5 3.5h11M6.5 20.5h11" />
      <path d="M7.5 3.5c0 4.5 4.5 5.5 4.5 8.5s-4.5 4-4.5 8.5" />
      <path d="M16.5 3.5c0 4.5-4.5 5.5-4.5 8.5s4.5 4 4.5 8.5" />
      <path d="M9.5 18.5c.8-1.2 1.6-1.8 2.5-1.8s1.7.6 2.5 1.8" />
    </>
  ),
  graveyard: (
    <>
      <path d="M6.5 20V10a5.5 5.5 0 0 1 11 0v10" />
      <path d="M4 20.5h16" />
      <path d="M12 9v6M9.5 11.5h5" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  'chevron-left': <path d="m14.5 6-6 6 6 6" />,
  'chevron-right': <path d="m9.5 6 6 6-6 6" />,
  'chevron-down': <path d="m6 9.5 6 6 6-6" />,
  'panel-left': (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.5-4.5" />
    </>
  ),
  external: (
    <>
      <path d="M13.5 4.5h6v6" />
      <path d="m19.5 4.5-8 8" />
      <path d="M17 13.5v5A1.5 1.5 0 0 1 15.5 20h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7h5" />
    </>
  ),
  'arrow-right': <path d="M5 12h14m-5-5 5 5-5 5" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
    </>
  ),
  moon: <path d="M19.5 14.5A7.5 7.5 0 1 1 9.5 4.5a6 6 0 0 0 10 10Z" />,
  monitor: (
    <>
      <rect x="3.5" y="4.5" width="17" height="11.5" rx="1.5" />
      <path d="M9 20h6M12 16v4" />
    </>
  ),
  'sign-out': (
    <>
      <path d="M14 4.5H6.5A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5H14" />
      <path d="M10.5 12H20m-3.5-3.5L20 12l-3.5 3.5" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /** Accessible label. Omit for decorative icons (the default). */
  title?: string;
}

export function Icon({ name, size = 20, className = '', title }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`flex-shrink-0 ${className}`}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {PATHS[name]}
    </svg>
  );
}
