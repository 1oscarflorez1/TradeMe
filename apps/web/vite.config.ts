import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Hosts autorizados para el servidor de preview (producción). Vite bloquea por defecto los
// dominios que no conoce; al servir detrás de un túnel (Tailscale Funnel, Cloudflare, etc.) hay
// que declararlos. Un valor que empieza por '.' autoriza el dominio y todos sus subdominios.
const extra = (process.env.ALLOWED_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  preview: {
    port: 5173,
    host: true,
    allowedHosts: ['localhost', '127.0.0.1', '.ts.net', '.trycloudflare.com', ...extra],
  },
});
