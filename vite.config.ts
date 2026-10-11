import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works from any subpath, e.g. GitHub Pages' /outspell/.
  base: './',
  server: { open: true },
});
