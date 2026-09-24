import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    // Tailnet-Zugriff über Tailscale serve (Spiel testen aus dem Heimnetz/Tailnet)
    allowedHosts: ['hermes.tail4f4e06.ts.net', 'hermes', '100.111.20.115'],
  },
});
