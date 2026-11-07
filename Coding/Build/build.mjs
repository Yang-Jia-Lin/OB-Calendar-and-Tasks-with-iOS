import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const license = await readFile(path.join(root, '../LICENSE.md'), 'utf8');
const { version } = JSON.parse(await readFile(path.join(root, 'Clients/Obsidian/manifest.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid plugin version.');
const channel = process.env.CTT_RELEASE_CHANNEL || '';
if (!['', 'preview', 'stable'].includes(channel)) throw new Error('Invalid release channel.');
const artifact = `V${version}_calendar-task-timer${channel ? `_${channel}` : ''}`;
const output = path.resolve(root, '../Results/Obsidian', artifact);
await mkdir(output, { recursive: true });
const bundled=await build({ entryPoints: [path.join(root, 'Clients/Obsidian/plugin.ts')], outfile: path.join(output, 'main.js'), bundle: true, metafile:true,
  platform: 'node', format: 'cjs', target: 'es2022', external: ['obsidian'], minify: true, banner: { js: `/* Calendar Task Timer ${version}\n${license.replaceAll('*/', '* /')}\n*/` } });
await copyFile(path.join(root,'Clients/Obsidian/manifest.json'),path.join(output,'manifest.json'));
for(const emitted of Object.values(bundled.metafile.outputs))for(const [file,info] of Object.entries(emitted.inputs))if(info.bytesInOutput>0&&/(Providers\/|Shared\/(timer|sync)\.ts|Desktop\/(runtime|store|service)\.ts|calendarStorage\.ts)/.test(file.replaceAll('\\','/')))throw new Error('Thin OB plugin unexpectedly contains a local engine: '+file);
const styles=await readFile(path.join(root,'Clients/Obsidian/styles.css'),'utf8');
await writeFile(path.join(output,'styles.css'),styles);

const previewDir = path.resolve(root, '../Results/Preview/Obsidian'); await mkdir(previewDir, { recursive: true });
await build({ entryPoints: [path.join(root, 'Preview/preview.ts')], outfile: path.join(previewDir, 'app.js'), bundle: true, loader:{'.py':'text','.txt':'text'}, format: 'iife', platform: 'browser', target: 'es2022' });
await writeFile(path.join(previewDir,'styles.css'),styles);
await writeFile(path.join(previewDir, 'index.html'), (await readFile(path.join(root, 'Preview/index.html'), 'utf8')).replaceAll('__VERSION__', version));
console.log(`Built Results/Obsidian/${artifact} (3 files) and Results/Preview/Obsidian; local timer/cloud engine excluded.`);
