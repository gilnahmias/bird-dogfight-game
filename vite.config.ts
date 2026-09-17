import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative, so the build runs from any sub-path (GitHub Pages serves it under /<repo>/).
  base: './',
})
