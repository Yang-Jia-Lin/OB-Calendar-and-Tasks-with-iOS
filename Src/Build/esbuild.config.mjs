import esbuild from 'esbuild';
import { builtinModules } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'Data/manifest.json'), 'utf8'));
if (!/^[a-z0-9-]+$/.test(manifest.id)) throw new Error('Invalid plugin id');
const install = path.join(root, 'Plugin', manifest.id);
const production = process.argv.includes('production');

const context = await esbuild.context({
  absWorkingDir: root,
  nodePaths: [path.join(root, 'Src/node_modules')],
  entryPoints: ['Src/main.ts'],
  outfile: path.join(install, 'main.js'),
  write: false,
  bundle: true,
  format: 'cjs',
  target: 'es2022',
  minify: production,
  sourcemap: production ? false : 'inline',
  legalComments: 'eof',
  loader: { '.md': 'text' },
  external: ['obsidian', 'electron', '@codemirror/*', ...builtinModules, ...builtinModules.map(name => 'node:' + name)],
  alias: {
    react: 'preact/compat',
    'react-dom/client': 'preact/compat/client',
    'react-dom': 'preact/compat',
    moment: path.join(root, 'Src/Stubs/moment-shim.ts'),
    'moment-timezone': path.join(root, 'Src/Stubs/moment-timezone-shim.ts'),
    'date-holidays': path.join(root, 'Src/Vendor/date-holidays-custom.min.js')
  },
  plugins: [{
    name: 'package-plugin',
    setup(build) {
      build.onEnd(result => {
        if (result.errors.length) return;
        const js = result.outputFiles.find(file => path.basename(file.path) === 'main.js');
        const css = result.outputFiles.find(file => path.basename(file.path) === 'main.css');
        if (!js || !css) throw new Error('Missing plugin JavaScript or CSS output');
        fs.mkdirSync(install, { recursive: true });
        fs.writeFileSync(path.join(install, 'main.js'), js.contents);
        fs.writeFileSync(path.join(install, 'styles.css'), css.contents);
        fs.copyFileSync(path.join(root, 'Data/manifest.json'), path.join(install, 'manifest.json'));
        console.log('Install files: ' + install);
      });
    }
  }]
});
if (production) { await context.rebuild(); await context.dispose(); }
else { await context.watch(); console.log('Watching source files…'); }
