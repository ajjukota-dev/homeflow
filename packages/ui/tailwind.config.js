/** Tailwind config for packages/ui's own preview pages — dogfoods the shared preset. */
import preset from "./src/tailwind-preset.js";

/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./preview/**/*.{html,ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};
