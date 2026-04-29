import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// vite-plugin-monaco-editor calls fs.rmdirSync({ recursive: true }) in workerMiddleware.js.
// That option was deprecated in Node 16 (DEP0147) and removed in Node 22, making the plugin
// crash at build time on Node 22+. Dynamic import() of monaco-editor is sufficient here:
// Vite's code-splitting auto-emits the worker files (ts.worker, json.worker, css.worker, etc.)
// as separate chunks, giving Monaco the same worker setup the plugin would have provided.
// import monacoEditorPlugin from 'vite-plugin-monaco-editor';

export default defineConfig({
  plugins: [
    react(),
    // monacoEditorPlugin({ languageWorkers: ['editorWorkerService', 'typescript', 'json', 'css', 'html'] }),
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
