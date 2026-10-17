// Minimal static server over public/ so LDrawLoader can fetch parts in Node tests.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/', import.meta.url));

// three's FileLoader reports progress with the browser-only ProgressEvent
globalThis.ProgressEvent ??= class extends Event {
  constructor(type, init) { super(type); Object.assign(this, init); }
};

export async function servePublic() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.includes('..')) return res.writeHead(400).end();
    try {
      const body = await readFile(root + path.slice(1));
      res.writeHead(200).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}
