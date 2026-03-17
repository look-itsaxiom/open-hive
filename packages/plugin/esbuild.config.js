import { build } from 'esbuild';

await build({
  entryPoints: ['src/mcp/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/mcp-server.mjs',
  banner: { js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);' },
  external: [],
});
