// Production server for a published Robot Studio: serves the built app (npm run build -> dist/) with the
// cross-origin isolation headers the Python runner needs, plus the smart assistant at /api/assistant.
// Run: GEMINI_API_KEY=... PORT=8080 npm start   (on a host like Render or Railway, set them as environment variables)
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAiHandler } from './server/assistant-ai.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const ai = createAiHandler({ apiKey: process.env.GEMINI_API_KEY });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.py': 'text/plain; charset=utf-8', '.dat': 'text/plain', '.ldr': 'text/plain', '.cur': 'image/x-icon', '.gif': 'image/gif' };

http.createServer(async (req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  if (req.url.startsWith('/api/assistant')) return ai(req, res);
  let file = path.normalize(path.join(root, decodeURIComponent(req.url.split('?')[0])));
  if (!file.startsWith(root)) { res.statusCode = 403; return res.end(); } // no ../ escapes
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    await stat(file);
  } catch { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  createReadStream(file).pipe(res);
}).listen(process.env.PORT || 8080, () => console.log(`Robot Studio on http://localhost:${process.env.PORT || 8080}${process.env.GEMINI_API_KEY ? '' : ' (no GEMINI_API_KEY: offline assistant only)'}`));
