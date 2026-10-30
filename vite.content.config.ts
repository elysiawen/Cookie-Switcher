import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

/**
 * content script 必须是 IIFE：注入的脚本不支持 ESM，也不能依赖代码分割。
 * 因此单独跑一次 lib 模式的构建，产物与主构建一起放在 dist 根目录。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    // 主构建先执行，这里只补一个文件，不能清空目录
    emptyOutDir: false,
    target: 'chrome114',
    sourcemap: false,
    lib: {
      entry: fileURLToPath(new URL('./src/content/panel.ts', import.meta.url)),
      name: 'CookieProfilePanel',
      formats: ['iife'],
      fileName: () => 'content-panel.js',
    },
  },
});
