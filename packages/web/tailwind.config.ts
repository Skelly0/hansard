import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        page: 'var(--page)',
        card: 'var(--card)',
        inset: 'var(--inset)',
        hover: 'var(--hover)',
        accent: {
          primary: 'var(--accent-primary)',
          'primary-light': 'var(--accent-primary-soft)',
          bills: 'var(--c-bills)',
          voting: 'var(--c-voting)',
          players: 'var(--c-players)',
          offices: 'var(--c-offices)',
          favours: 'var(--c-favours)',
          tickets: 'var(--c-tickets)',
          moderation: 'var(--c-moderation)',
          graveyard: 'var(--c-graveyard)',
          simulation: 'var(--c-simulation)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)',
          inverse: 'var(--text-inverse)',
        },
        border: {
          subtle: 'var(--border-subtle)',
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)',
        },
        status: {
          open: 'var(--status-open)',
          active: 'var(--status-active)',
          pending: 'var(--status-pending)',
          closed: 'var(--status-closed)',
          rejected: 'var(--status-rejected)',
          passed: 'var(--status-passed)',
          deceased: 'var(--status-deceased)',
        },
        health: {
          healthy: 'var(--health-healthy)',
          minor: 'var(--health-minor)',
          major: 'var(--health-major)',
          critical: 'var(--health-critical)',
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
      boxShadow: {
        modal: 'var(--shadow-modal)',
        'modal-warm': 'var(--shadow-modal-warm)',
      },
    },
  },
  plugins: [],
} satisfies Config;
