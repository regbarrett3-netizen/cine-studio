import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Ship only minified code: no source maps, no readable comments.
  build: { sourcemap: false, minify: 'esbuild' },
  esbuild: { legalComments: 'none' },
});
