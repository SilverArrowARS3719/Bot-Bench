import { loadEnv } from 'vite';
import { createAiHandler } from './server/assistant-ai.js';

// Cross-origin isolation lets the Python worker read sensor values from shared memory while your
// program is in a tight loop (e.g. `while distance_sensor.distance(port.C) > 100: pass`).
const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

export default ({ mode }) => {
  // GEMINI_API_KEY comes from .env.local (never bundled into the page: only VITE_ variables are)
  const { GEMINI_API_KEY } = loadEnv(mode, process.cwd(), '');
  const ai = createAiHandler({ apiKey: GEMINI_API_KEY });
  const mount = server => { server.middlewares.use((req, res, next) => (req.url.startsWith('/api/assistant') ? ai(req, res, next) : next())); }; // (returning a function would make Vite call it as a later hook)
  return {
    server: { headers: isolation },
    preview: { headers: isolation },
    plugins: [{ name: 'assistant-ai', configureServer: mount, configurePreviewServer: mount }],
    build: {
      target: 'es2022', // top-level await in the page scripts
      rollupOptions: { input: { home: 'index.html', about: 'about.html', account: 'account.html', studio: 'studio.html' } },
    },
  };
};
