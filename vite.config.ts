import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// "vite build"             → site de verdade (dist/): só o Supabase, sem modo teste nenhum dentro
// "vite build --mode teste" → site de teste (dist-teste/): banco inventado dentro do navegador (PGlite)
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: './',
  server: { port: 5319, strictPort: true },
  preview: { port: 5319, strictPort: true },
  build: {
    outDir: mode === 'teste' ? 'dist-teste' : 'dist',
    assetsDir: 'app',
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    // o "ajudante" do pdf.js vem como .mjs; sai como .js para qualquer servidor mandar com o tipo certo (senão a prévia do PDF não abre)
    rolldownOptions: { output: { assetFileNames: (a) => /\.mjs$/i.test(a.names?.[0] ?? '') ? 'app/[name]-[hash].js' : 'app/[name]-[hash][extname]' } },
  },
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
}))
