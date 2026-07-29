/** @type {import('tailwindcss').Config} */
const withMT = require("@material-tailwind/react/utils/withMT");

module.exports = withMT({
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // `slate` has to be declared here or it does not exist.
        //
        // withMT REPLACES Tailwind's colour palette with Material Tailwind's own,
        // which has blue-gray but no slate. The dashboard is written throughout in
        // dark:bg-slate-950/90, dark:border-slate-800, dark:text-slate-100 — and every
        // one of those compiled to nothing. Measured on the live site: 0 rules
        // mentioning slate, and only 15 `dark:` rules in the entire 1,534-rule sheet.
        // That is why the dashboard top bar stayed white in dark mode while carrying
        // a dark:bg-slate-950/90 class, and it is why tailwind.css had to hand-write
        // `.dark .cb-activity-chip` instead of using a utility.
        //
        // The values are NOT Tailwind's slate, which is blue-tinted and is the other
        // half of why dark mode read as blue. This is a neutral inked with the Pyxis
        // dark tone (#072824, --sk-color-two on pyxis-discovery.com), so restoring the
        // palette also moves the whole dark theme onto brand without touching a single
        // component's class list.
        // withMT renders green-* as Material Design green (#4CAF50 at 500) — the
        // bright grass green on every COMPLETED chip, and the "non-Pyxis green" that
        // prompted this. Status colour has to stay green (success reads as green, and
        // recolouring it citron would both lose that signal and collide with the
        // brand accent), so this shifts hue rather than abandoning it: ~95° instead of
        // Material's ~122°, which makes it a yellow-leaning green that sits beside the
        // citron #b4b239 instead of clashing with it.
        green: {
          50: "#f2f7ed",
          100: "#e0edd6",
          200: "#c3dcaf",
          300: "#a1c883",
          400: "#83b45f",
          500: "#6a9d45",
          600: "#558235",
          700: "#43672a",
          800: "#344f21",
          900: "#263a18",
        },
        slate: {
          50: "#f0f5f4",
          100: "#dde8e6",
          200: "#bccfcb",
          300: "#93aeaa",
          400: "#648b85",
          500: "#456f68",
          600: "#325852",
          700: "#234440",
          800: "#143430",
          900: "#072824",
          950: "#03120f",
        },
        // Brand color family resolving to runtime CSS variables. Channel form
        // with the alpha-value placeholder is required so opacity modifiers
        // (e.g. shadow-brand-500/20) work. Plain hex would break every /N
        // modifier. Defaults live in src/tailwind.css :root and are overridden
        // at runtime by BrandingProvider.
        brand: {
          50: "rgb(var(--brand-50) / <alpha-value>)",
          100: "rgb(var(--brand-100) / <alpha-value>)",
          200: "rgb(var(--brand-200) / <alpha-value>)",
          300: "rgb(var(--brand-300) / <alpha-value>)",
          400: "rgb(var(--brand-400) / <alpha-value>)",
          500: "rgb(var(--brand-500) / <alpha-value>)",
          600: "rgb(var(--brand-600) / <alpha-value>)",
          700: "rgb(var(--brand-700) / <alpha-value>)",
          800: "rgb(var(--brand-800) / <alpha-value>)",
          900: "rgb(var(--brand-900) / <alpha-value>)",
        },
      },
    },
  },
  plugins: [],
});
