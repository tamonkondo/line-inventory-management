import { build } from 'esbuild';
import { GasPlugin } from 'esbuild-gas-plugin';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/main.js',
  target: 'es2019',
  charset: 'utf8',
  plugins: [GasPlugin],
});
