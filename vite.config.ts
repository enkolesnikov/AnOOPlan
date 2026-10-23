import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: process.env.BASE_URL || '/',
  plugins:[react()],
  server:{host:'0.0.0.0',port:5173,proxy:{'/api':'http://127.0.0.1:3001'}},
  // APK работает в WebView на Android 7+: собираем под es2019 (Chrome 98+),
  // а не под современный baseline Vite. Полифиллы для отдельных API — в src/compat.ts.
  build:{outDir:'dist', target:'es2019', cssTarget:'chrome61'},
  // PDF.js создаёт module worker; полифиллы воркера собираются в отдельный ES-бандл.
  worker:{format:'es'},
});
