import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      'adapters/stripe': 'src/adapters/stripe.ts',
      'adapters/x402': 'src/adapters/x402.ts',
    },
    format: ['esm'],
    outDir: 'dist/esm',
    dts: { outDir: 'dist' },
    sourcemap: true,
    clean: true,
    target: 'node18',
  },
  {
    entry: {
      index: 'src/index.ts',
      'adapters/stripe': 'src/adapters/stripe.ts',
      'adapters/x402': 'src/adapters/x402.ts',
    },
    format: ['cjs'],
    outDir: 'dist/cjs',
    outExtension: () => ({ js: '.cjs' }),
    dts: false,
    sourcemap: true,
    clean: false,
    target: 'node18',
  },
  // CLI — ESM only, separate output
  // Inject createRequire so bundled CJS deps (yoctocolors-cjs) can require() Node builtins
  {
    entry: { 'cli/init': 'src/cli/init.ts' },
    format: ['esm'],
    outDir: 'dist',
    banner: {
      js: [
        '#!/usr/bin/env node',
        'import { createRequire as __cr } from "node:module";',
        'const require = __cr(import.meta.url);',
      ].join('\n'),
    },
    dts: false,
    sourcemap: false,
    clean: false,
    target: 'node18',
  },
])
