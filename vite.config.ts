import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const SERVER_PORT = 8787;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // The realtime session lives on the Node server because the Azure key
      // must never reach the browser. Vite proxies the WebSocket in dev.
      "/realtime": {
        target: `ws://localhost:${SERVER_PORT}`,
        ws: true,
      },
      "/api": {
        target: `http://localhost:${SERVER_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
