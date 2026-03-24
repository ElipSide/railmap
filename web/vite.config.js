import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const isRailmapSubpath = process.env.VITE_USE_RAILMAP_SUBPATH === "1";

export default defineConfig({
  base: isRailmapSubpath ? "/railmap/home/" : "/",
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5175,
    allowedHosts: isRailmapSubpath ? ["csort-news.ru"] : true,
    hmr: isRailmapSubpath
      ? {
          protocol: "wss",
          host: "csort-news.ru",
          clientPort: 443,
        }
      : undefined,
    proxy: isRailmapSubpath
      ? {
          "/railmap/api": {
            target: "http://route_api:3000",
            changeOrigin: true,
          },
          "/railmap/route": {
            target: "http://route_api:3000",
            changeOrigin: true,
          },
          "/railmap/health": {
            target: "http://route_api:3000",
            changeOrigin: true,
          },
        }
      : {
          "/route": {
            target: "http://route_api:3000",
            changeOrigin: true,
          },
          "/api": {
            target: "http://route_api:3000",
            changeOrigin: true,
          },
          "/health": {
            target: "http://route_api:3000",
            changeOrigin: true,
          },
        },
  },
});