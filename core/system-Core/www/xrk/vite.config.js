import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mount = '/xrk';
const port = 5177;
const rootDir = path.dirname(fileURLToPath(import.meta.url));
/** AGT 在 ≤2.5G 主机上 spawn build 时会设 XRK_WWW_BUILD_LOW_MEM=1 */
const lowMem = process.env.XRK_WWW_BUILD_LOW_MEM === '1';

export default defineConfig({
  plugins: [vue()],
  base: `${mount}/`,
  resolve: {
    alias: {
      '@': path.join(rootDir, 'src'),
    },
  },
  server: {
    port,
    strictPort: true,
    host: '127.0.0.1',
    hmr: {
      protocol: 'ws',
      host: '127.0.0.1',
      port,
      clientPort: port,
    },
  },
  preview: {
    port,
    strictPort: true,
    host: '127.0.0.1',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // 低配：少并行、不算 gzip 体积，峰值内存明显下降
    reportCompressedSize: !lowMem,
    cssCodeSplit: true,
    rollupOptions: lowMem
      ? { maxParallelFileOps: 1 }
      : undefined,
  },
});
