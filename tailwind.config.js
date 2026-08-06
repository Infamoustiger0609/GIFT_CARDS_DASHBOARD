/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#1b2430',
          light: '#2a3646',
          border: '#31404f'
        },
        // Header ribbon color, sampled directly from pvr-inox-logo.jpeg's
        // own background pixels (#231F20, confirmed via a pixel probe, not
        // guessed) so the logo's JPEG background — which can't be made
        // transparent — blends into the header with no visible box edge.
        ribbon: '#231f20',
        cream: '#faf8f4',
        card: '#ffffff',
        warmgray: {
          border: '#e2ddd3',
          muted: '#8a8478'
        },
        gold: {
          DEFAULT: '#c8952e',
          dark: '#a8791f',
          light: '#f4e6c8'
        },
        teal: {
          DEFAULT: '#00805a',
          dark: '#00664a',
          light: '#d7ece3'
        },
        coral: {
          DEFAULT: '#c1502e',
          dark: '#9e3f22',
          light: '#f6ddd2'
        },
        cat: {
          blue: '#3568b3',
          plum: '#9c3f8a',
          olive: '#6b7a1f',
          gray: '#9a9890'
        }
      },
      fontFamily: {
        serif: ['Georgia', 'Cambria', '"Times New Roman"', 'serif'],
        sans: ['"Segoe UI"', 'system-ui', '-apple-system', 'Roboto', 'sans-serif']
      }
    }
  },
  plugins: []
}
