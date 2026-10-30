import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../Plugin/calendar-task-timer');
await mkdir(output, { recursive: true });
const license = await readFile(path.join(root, '../LICENSE.md'), 'utf8');
const { version } = JSON.parse(await readFile(path.join(root, 'Clients/Obsidian/manifest.json'), 'utf8'));
await build({ entryPoints: [path.join(root, 'Clients/Obsidian/plugin.ts')], outfile: path.join(output, 'main.js'), bundle: true,
  platform: 'node', format: 'cjs', target: 'es2022', external: ['obsidian'], minify: true, banner: { js: `/* Calendar Task Timer ${version}\n${license.replaceAll('*/', '* /')}\n*/` } });
for (const file of ['manifest.json', 'styles.css']) await copyFile(path.join(root, 'Clients/Obsidian', file), path.join(output, file));
const previewDir = path.resolve(root, '../Results/Preview'); await mkdir(previewDir, { recursive: true });
await build({ entryPoints: [path.join(root, 'Preview/preview.ts')], outfile: path.join(previewDir, 'app.js'), bundle: true, format: 'iife', platform: 'browser', target: 'es2022' });
await copyFile(path.join(root, 'Clients/Obsidian/styles.css'), path.join(previewDir, 'styles.css'));
await writeFile(path.join(previewDir, 'index.html'), (await readFile(path.join(root, 'Preview/index.html'), 'utf8')).replaceAll('__VERSION__', version));
console.log('Built Plugin/calendar-task-timer (3 files) and Results/Preview');
