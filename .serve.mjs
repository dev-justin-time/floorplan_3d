import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const port = Number(process.argv[2] || 8765);

const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.jsx': 'text/javascript; charset=utf-8',
    '.ts': 'text/javascript; charset=utf-8',
    '.tsx': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.glb': 'model/gltf-binary',
    '.md': 'text/markdown; charset=utf-8'
};

createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        const path = decodeURIComponent(url.pathname);
        let file = normalize(join(root, path === '/' ? 'index.html' : path));
        if (!file.startsWith(root)) {
            res.writeHead(403).end('forbidden');
            return;
        }
        const info = await stat(file).catch(() => null);
        if (info && info.isDirectory()) file = join(file, 'index.html');
        const body = await readFile(file);
        res.writeHead(200, {
            'Content-Type': types[extname(file).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store'
        });
        res.end(body);
        console.log(req.method, req.url);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    }
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
