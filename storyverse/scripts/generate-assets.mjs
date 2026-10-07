import { readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = join(root, 'site-assets');
const items = [];
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) { await walk(absolute); continue; }
    const path = '/' + absolute.slice(source.length + 1).split('\\').join('/');
    const ext = extname(entry.name).toLowerCase();
    const bytes = await readFile(absolute);
    const binary = !['.html', '.css', '.js', '.svg'].includes(ext);
    items.push([path, { type: types[ext] ?? 'application/octet-stream', body: binary ? bytes.toString('base64') : bytes.toString('utf8'), binary }]);
  }
}
await walk(source);
items.sort(([a], [b]) => a.localeCompare(b));
await import('node:fs/promises').then(({ mkdir, writeFile }) => mkdir(join(root, 'worker'), { recursive: true }).then(() => writeFile(join(root, 'worker/assets.js'), `export const ASSETS = new Map(${JSON.stringify(items)});\n`)));
console.log(`Embedded ${items.length} Site assets.`);
