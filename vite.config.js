import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// vite-plugin-monaco-editor calls fs.rmdirSync({ recursive: true }) in workerMiddleware.js,
// which crashes on Node 22+. Dynamic import() of monaco-editor is sufficient here:
// Vite's code-splitting auto-emits the worker files (ts.worker, json.worker, css.worker, etc.)
// as separate chunks, giving Monaco the same worker setup the plugin would have provided.

export default defineConfig({
  plugins: [
    react(),
  ],
  base: './',
  build: {
    outDir: 'dist-react',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
