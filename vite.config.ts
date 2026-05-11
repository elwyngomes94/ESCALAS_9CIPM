import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    base: '/',
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      // Polyfill process for libraries that might expect it, though define is better
      'process.env': env,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 3000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('firebase')) return 'vendor-firebase';
              if (id.includes('lucide-react')) return 'vendor-lucide';
              if (id.includes('date-fns')) return 'vendor-date-fns';
              if (id.includes('jspdf') || id.includes('xlsx') || id.includes('html2canvas')) return 'vendor-utils';
              if (id.includes('motion') || id.includes('framer-motion')) return 'vendor-motion';
              return 'vendor-base';
            }
          },
        },
      },
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
  };
});
