import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '"Inter Variable"',
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          '"SF Pro Text"',
          'system-ui',
          'sans-serif',
        ],
      },
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        subtle: 'rgb(var(--subtle) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        text: {
          DEFAULT: 'rgb(var(--text) / <alpha-value>)',
          muted: 'rgb(var(--text-muted) / <alpha-value>)',
          subtle: 'rgb(var(--text-subtle) / <alpha-value>)',
        },
        brand: {
          green: 'rgb(var(--brand-green) / <alpha-value>)',
          'green-soft': 'rgb(var(--brand-green-soft) / <alpha-value>)',
          magenta: 'rgb(var(--brand-magenta) / <alpha-value>)',
        },
        success: 'rgb(var(--success) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        primary: 'rgb(var(--primary) / <alpha-value>)',
        'on-primary': 'rgb(var(--on-primary) / <alpha-value>)',
        // Tokens de glassmorphism
        glass: 'rgb(var(--glass-bg) / <alpha-value>)',
        'glass-border': 'rgb(var(--glass-border) / <alpha-value>)',
        neon: {
          green:   'rgb(var(--neon-green) / <alpha-value>)',
          violet:  'rgb(var(--neon-violet) / <alpha-value>)',
          cyan:    'rgb(var(--neon-cyan) / <alpha-value>)',
          magenta: 'rgb(var(--neon-magenta) / <alpha-value>)',
        },
        // Paleta estática para hero / landing (marca LearningAI)
        'positivo-green': '#00C228',
        'positivo-magenta': '#E11D74',
        'apple-gray': '#86868b',
      },
      fontSize: {
        'display-xl': ['clamp(3.5rem, 7vw + 1rem, 6rem)', { lineHeight: '1.02', letterSpacing: '-0.045em' }],
        'display-lg': ['clamp(2.75rem, 5vw + 1rem, 4.5rem)', { lineHeight: '1.05', letterSpacing: '-0.04em' }],
        'display-md': ['clamp(2rem, 3vw + 1rem, 3rem)', { lineHeight: '1.1', letterSpacing: '-0.035em' }],
        headline: ['1.75rem', { lineHeight: '1.2', letterSpacing: '-0.025em' }],
        title: ['1.3125rem', { lineHeight: '1.3', letterSpacing: '-0.015em' }],
        body: ['1.0625rem', { lineHeight: '1.6' }],
        caption: ['0.8125rem', { lineHeight: '1.4', letterSpacing: '0.005em' }],
      },
      borderRadius: {
        '4xl': '2rem',
      },
      transitionTimingFunction: {
        apple: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      boxShadow: {
        glass:        '0 8px 24px -4px rgb(0 0 0 / 0.1), 0 1px 0 0 rgb(0 0 0 / 0.04) inset',
        'glass-lg':   '0 16px 48px -10px rgb(0 0 0 / 0.15), 0 1px 0 0 rgb(0 0 0 / 0.05) inset',
        'neon-green':  '0 4px 16px rgb(0 0 0 / 0.12)',
        'neon-violet': '0 4px 16px rgb(0 0 0 / 0.12)',
        'neon-cyan':   '0 4px 16px rgb(0 0 0 / 0.1)',
        'card-hover':  '0 12px 32px -8px rgb(0 0 0 / 0.1), 0 0 0 1px rgb(0 0 0 / 0.05)',
      },
      backdropBlur: {
        xs:   '4px',
        sm:   '8px',
        lg:   '24px',
        xl:   '40px',
        '2xl': '64px',
      },
      keyframes: {
        shimmer: {
          '0%':   { backgroundPosition: '-200% center' },
          '100%': { backgroundPosition: '200% center' },
        },
        'glow-pulse': {
          '0%, 100%': { opacity: '0.6' },
          '50%':       { opacity: '1' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':       { transform: 'translateY(-6px)' },
        },
      },
      animation: {
        shimmer:     'shimmer 3s linear infinite',
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
        float:       'float 4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
