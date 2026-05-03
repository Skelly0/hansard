import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        page: '#FAF9F5',
        card: '#FFFFFF',
        inset: '#F2F0E8',
        hover: '#EDEADF',
        accent: {
          primary: '#D97757',
          'primary-light': '#F5E6DF',
          bills: '#C4873B',
          voting: '#6A9BCC',
          players: '#788C5D',
          offices: '#9B7CB8',
          favours: '#C4873B',
          tickets: '#7B8BA8',
          moderation: '#C25B4E',
          graveyard: '#9C9890',
          simulation: '#5D8C7B',
        },
        text: {
          primary: '#141413',
          secondary: '#524F48',
          tertiary: '#7A7770',
          inverse: '#FAF9F5',
        },
        border: {
          subtle: '#E8E6DC',
          DEFAULT: '#D4D1C7',
          strong: '#B0AEA5',
        },
        status: {
          open: '#6A9BCC',
          active: '#788C5D',
          pending: '#C4873B',
          closed: '#9C9890',
          rejected: '#C25B4E',
          passed: '#788C5D',
          deceased: '#B0AEA5',
        },
        health: {
          healthy: '#788C5D',
          minor: '#C4873B',
          major: '#D97757',
          critical: '#C25B4E',
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
        modal: '0 4px 12px rgba(20, 20, 19, 0.08)',
        'modal-warm': '0 8px 32px rgba(120, 90, 60, 0.18)',
      },
    },
  },
  plugins: [],
} satisfies Config;
