/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          // منصة التعاونية — palette sampled directly from the cooperative's
          // logo: the green of the Arabic wordmark, the purple of the English
          // one, and the deep purple of the map dots. Green carries nature and
          // destinations, purple carries heritage and culture.
          // Key names kept for backward-compat with existing classNames
          // (brand-red*, etc.) — they are greens now, not reds.
          redDark: "#3A7355",   // deep green — hovers / headings
          red: "#4E946F",       // logo green — primary buttons, links
          redSoft: "#E8F2EC",   // soft green — badges / backgrounds
          primary: "#4E946F",   // logo green
          secondary: "#745088", // logo purple — accents, secondary actions
          dark: "#2A5540",      // darkest green — footers / sidebars
        },
        // Full scales, for when a token needs more range than the six above.
        sand: {
          50: "#FAF7F2",
          100: "#F3ECE0",
          200: "#E5D8C3",
        },
        heritage: {
          light: "#F0EAF3",     // soft purple wash
          DEFAULT: "#745088",   // logo purple
          deep: "#601F73",      // logo map-dot purple
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out forwards',
        'zoom-in': 'zoomIn 0.5s ease-out forwards',
        'slide-up': 'slideUp 0.5s ease-out forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        zoomIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-12px)' },
        }
      }
    },
  },
  plugins: [],
};

