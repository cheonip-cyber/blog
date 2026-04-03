import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      // VITE_GEMINI_API_KEY → 브라우저 번들에 주입
      // 보안: Google Cloud Console에서 HTTP Referrer 제한 설정 필요
      'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(
        env.VITE_GEMINI_API_KEY || env.GEMINI_API_KEY || ''
      ),
    },
    resolve: {
      alias: { '@': path.resolve(__dirname, '.') },
    },
    root: '.',
    build: { outDir: 'dist' },
  };
});
