import type { Config } from 'tailwindcss';

/**
 * Theme colours are CSS variables holding hex values (so light/dark swap at
 * runtime). Tailwind 3 cannot apply opacity modifiers (`bg-accent-bills/10`,
 * `hover:bg-status-rejected/90`) to a bare `var(--x)` — it silently emits no
 * CSS at all. Routing each token through `color-mix` with `<alpha-value>`
 * makes every modifier work while keeping the hex variables untouched.
 */
const token = (name: string) =>
  `color-mix(in srgb, var(${name}) calc(<alpha-value> * 100%), transparent)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        page: token('--page'),
        card: token('--card'),
        inset: token('--inset'),
        hover: token('--hover'),
        accent: {
          primary: token('--accent-primary'),
          'primary-light': token('--accent-primary-soft'),
          bills: token('--c-bills'),
          voting: token('--c-voting'),
          players: token('--c-players'),
          offices: token('--c-offices'),
          favours: token('--c-favours'),
          tickets: token('--c-tickets'),
          moderation: token('--c-moderation'),
          graveyard: token('--c-graveyard'),
          simulation: token('--c-simulation'),
        },
        // Deep "ink" tones for fills that carry cream text (buttons, avatars,
        // active pagination). In dark mode they equal the lifted accents and
        // pair with the dark `text-inverse`.
        ink: {
          primary: token('--accent-primary-ink'),
          bills: token('--c-bills-ink'),
          voting: token('--c-voting-ink'),
          players: token('--c-players-ink'),
          offices: token('--c-offices-ink'),
          tickets: token('--c-tickets-ink'),
          moderation: token('--c-moderation-ink'),
          graveyard: token('--c-graveyard-ink'),
          simulation: token('--c-simulation-ink'),
          pending: token('--status-pending-ink'),
          rejected: token('--status-rejected-ink'),
          passed: token('--status-passed-ink'),
        },
        text: {
          primary: token('--text-primary'),
          secondary: token('--text-secondary'),
          tertiary: token('--text-tertiary'),
          inverse: token('--text-inverse'),
        },
        border: {
          subtle: token('--border-subtle'),
          DEFAULT: token('--border'),
          strong: token('--border-strong'),
        },
        status: {
          open: token('--status-open'),
          active: token('--status-active'),
          pending: token('--status-pending'),
          closed: token('--status-closed'),
          rejected: token('--status-rejected'),
          passed: token('--status-passed'),
          deceased: token('--status-deceased'),
        },
        health: {
          healthy: token('--health-healthy'),
          minor: token('--health-minor'),
          major: token('--health-major'),
          critical: token('--health-critical'),
        },
      },
      fontFamily: {
        display: ['"Crimson Pro"', 'serif'],
        body: ['Lora', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        card: '6px',
      },
      fontSize: {
        display: ['1.75rem', { lineHeight: '1.2', fontWeight: '600', letterSpacing: '-0.01em' }],
        'heading-1': ['1.25rem', { lineHeight: '1.3', fontWeight: '600' }],
        'heading-2': ['1rem', { lineHeight: '1.4', fontWeight: '500' }],
        body: ['0.9375rem', { lineHeight: '1.7' }],
        'body-sm': ['0.875rem', { lineHeight: '1.6' }],
        label: ['0.75rem', { lineHeight: '1.4', fontWeight: '500', letterSpacing: '0.03em' }],
      },
      // Text utilities for accent/status/health use the darker "ink"
      // variants so small text meets WCAG AA; fills, borders, and bars keep
      // the pastel palette above.
      textColor: {
        accent: {
          primary: token('--accent-primary-ink'),
          bills: token('--c-bills-ink'),
          voting: token('--c-voting-ink'),
          players: token('--c-players-ink'),
          offices: token('--c-offices-ink'),
          favours: token('--c-favours-ink'),
          tickets: token('--c-tickets-ink'),
          moderation: token('--c-moderation-ink'),
          graveyard: token('--c-graveyard-ink'),
          simulation: token('--c-simulation-ink'),
        },
        status: {
          open: token('--status-open-ink'),
          active: token('--status-active-ink'),
          pending: token('--status-pending-ink'),
          closed: token('--status-closed-ink'),
          rejected: token('--status-rejected-ink'),
          passed: token('--status-passed-ink'),
          deceased: token('--status-deceased-ink'),
        },
        health: {
          healthy: token('--health-healthy-ink'),
          minor: token('--health-minor-ink'),
          major: token('--health-major-ink'),
          critical: token('--health-critical-ink'),
        },
      },
      // Bare `border` (no colour class) should use the warm hairline, not
      // Tailwind's default cool grey, which glares on the dark palette.
      borderColor: {
        DEFAULT: 'var(--border-subtle)',
      },
      transitionDuration: {
        400: '400ms',
      },
      keyframes: {
        'pulse-subtle': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(2px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: {
        'pulse-subtle': 'pulse-subtle 2.4s ease-in-out infinite',
        // `backwards`, not `both`: a finished animation that keeps holding
        // `transform` makes the element a containing block for `fixed`
        // descendants, which clips overlays rendered inside the page.
        'fade-in': 'fade-in 160ms ease-out backwards',
      },
      boxShadow: {
        modal: 'var(--shadow-modal)',
        'modal-warm': 'var(--shadow-modal-warm)',
      },
    },
  },
  plugins: [],
} satisfies Config;
