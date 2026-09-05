/**
 * Workspace Tailwind theme. Every colour, radius and type size below is a
 * reference to a CSS variable defined in packages/ui/src/tokens.css — this file
 * declares no values of its own (technical/09 §2). v1's scale is preserved
 * verbatim; the design decision at the top of design-language.md is still open.
 */
import animate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
    darkMode: ["class"],
    content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['IBM Plex Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        heading: ['Chivo', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      // Typography bump for LED-screen readability (Feb 2026)
      // text-xs stays 12px for chips/timestamps; body copy = text-sm (14px+)
      fontSize: {
        xs:   ['12px', { lineHeight: '18px' }],
        sm:   ['14px', { lineHeight: '20px' }],
        base: ['15px', { lineHeight: '22px' }],
        lg:   ['17px', { lineHeight: '26px' }],
        xl:   ['20px', { lineHeight: '28px' }],
        '2xl':['22px', { lineHeight: '30px' }],
        '3xl':['28px', { lineHeight: '36px' }],
        '4xl':['36px', { lineHeight: '44px' }],
        '5xl':['44px', { lineHeight: '52px' }],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))'
        },
        // Pranava HomeFlow brand palette
        navy: {
          900: '#0D1B3D',
          800: '#182B5C',
          700: '#243B78',
        },
        brand: {
          DEFAULT: '#E8431A',
          50: '#FFF3EE',
          100: '#FEE7DE',
          200: '#FDC5B0',
          300: '#F79C77',
          400: '#F16F3F',
          500: '#E8431A',
          600: '#C4331A',
          700: '#9E2914',
          fg: '#FFFFFF',
        },
        warm: {
          50: '#FBF9F5',
          100: '#EFE9DF',
          200: '#DDD3C2',
        },
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' }
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' }
        }
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out'
      }
    }
  },
  plugins: [animate],
};
