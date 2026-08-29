import { defineConfig } from 'vite';

export default defineConfig({
  // Use relative base so it works under Vercel's subpath and local VPS
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
    target: 'es2019',
  },
  server: {
    port: 5173,
    proxy: {
      // Dev server proxies /scan to the local API (port 4200)
      '/scan': 'http://localhost:4200',
    },
  },
});
