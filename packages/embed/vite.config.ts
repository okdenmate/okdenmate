import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/*
 * The widget ships as one self-mounting IIFE with no dependencies and no
 * external stylesheet, because it has to drop into whatever the website
 * already is without a build step on that side.
 *
 * It is emitted into the server's static directory so there is one thing to
 * deploy, served from the same origin as the API.
 */
export default defineConfig({
  build: {
    outDir: resolve(import.meta.dirname, '../web/dist'),
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/widget.ts'),
      name: 'UknEnquiry',
      formats: ['iife'],
      fileName: () => 'ukn-enquiry.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
    target: 'es2019',
    minify: 'esbuild',
  },
});
