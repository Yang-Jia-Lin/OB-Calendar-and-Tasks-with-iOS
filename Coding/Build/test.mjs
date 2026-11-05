import { build } from 'esbuild';
import { readdir, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const out = path.resolve('../Agents/Tests'); await mkdir(out, { recursive: true });
const tests = (await readdir('Tests')).filter(f => f.endsWith('.test.ts'));
for (const file of tests) await build({ entryPoints: ['Tests/' + file], outfile: path.join(out, file.replace('.ts', '.cjs')), bundle: true, loader:{'.py':'text','.txt':'text'}, platform: 'node', format: 'cjs', external: ['obsidian'] });
const result = spawnSync(process.execPath, ['--test', ...tests.map(f => path.join(out, f.replace('.ts', '.cjs')))], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
