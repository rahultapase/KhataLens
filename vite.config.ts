import { defineConfig } from "vite";

// Minimal shape of the proxy events we use. Vite's ProxyServer extends Node's
// EventEmitter, and this project does not pull in @types/node.
interface ProxyEvents {
  on(event: "proxyReq", cb: (req: { removeHeader(name: string): void }) => void): void;
}

// The browser talks to Ollama through this dev proxy, so there is no CORS setup
// and no API key. Ollama itself stays bound to localhost.
export default defineConfig({
  server: {
    proxy: {
      "/ollama": {
        target: "http://localhost:11434",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama/, ""),
        configure: (proxy) => {
          // Ollama rejects unknown browser origins with 403. Strip Origin so the
          // request looks like a local tool call.
          (proxy as unknown as ProxyEvents).on("proxyReq", (proxyReq) => {
            proxyReq.removeHeader("origin");
            proxyReq.removeHeader("referer");
          });
        },
      },
    },
  },
});
