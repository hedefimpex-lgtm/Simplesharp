import { defineConfig } from 'vite';

export default defineConfig({
  // Göreli yollar: derleme herhangi bir alt dizinden (ör. GitHub Pages) sunulabilir.
  base: './',
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
});
