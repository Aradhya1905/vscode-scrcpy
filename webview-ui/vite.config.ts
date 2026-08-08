import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Chunk and stylesheet URLs are resolved against the entry module's own URL,
  // which the extension rewrites to a webview-resource URI under media/build/.
  // The default absolute base would resolve against the webview origin root and 404.
  base: './',
  plugins: [react()],
  build: {
    outDir: '../media/build',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // media/webview.html links webview.js and webview.css by name, so those two
        // stay unhashed. Everything reachable only through a dynamic import gets a
        // hashed name under chunks/ and is fetched by the entry at runtime.
        entryFileNames: 'webview.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        // Vite names a CSS asset after the chunk that owns it, so the entry's
        // stylesheet is "index.css" (the entry chunk is index.html) and every other
        // sheet is named for its lazy app chunk.
        assetFileNames: (asset) =>
          asset.names?.[0] === 'index.css' ? 'webview.[ext]' : 'chunks/[name]-[hash].[ext]',
      },
    },
  },
});
