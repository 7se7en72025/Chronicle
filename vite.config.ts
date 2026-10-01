import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], server: { port: 5173, strictPort: true, watch: { ignored: ['**/.chronicle/**', '**/.npm-cache/**'] }, proxy: { '/api': 'http://127.0.0.1:4317', '/artifacts': 'http://127.0.0.1:4317', '/sandbox': 'http://127.0.0.1:4317' } } });
