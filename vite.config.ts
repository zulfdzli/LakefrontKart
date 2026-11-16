import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * One Vite project with two pages: the host screen (host/index.html, served at /)
 * and the phone controller (controller/index.html, served at /play).
 * In dev, the Express server runs this config in middleware mode on its own port.
 */
export default defineConfig({
  root,
  publicDir: 'host/public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    // three.js alone is ~550 kB; the host loads once from localhost, so a big chunk is fine
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      input: {
        host: 'host/index.html',
        controller: 'controller/index.html',
      },
    },
  },
});
