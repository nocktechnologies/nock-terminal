/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        nock: {
          bg: '#0A0A0F',
          card: '#111116',
          border: '#1A1A2E',
          'accent-blue': '#3B6FD4',
          'accent-purple': '#7C5CFC',
          text: '#E0E0E0',
          'text-dim': '#888888',
          green: '#34D399',
          yellow: '#FBBF24',
          red: '#F87171',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
        sans: ['DM Sans', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
