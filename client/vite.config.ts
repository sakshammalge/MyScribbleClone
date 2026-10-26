import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { DEFAULT_PORT } from '@inkling/shared';

const serverPort = Number(process.env.PORT ?? DEFAULT_PORT);

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // listen on the LAN too
    proxy: { '/socket.io': { target: `http://localhost:${serverPort}`, ws: true } },
  },
});
