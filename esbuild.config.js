/* eslint-disable @typescript-eslint/no-var-requires */
const esbuild = require('esbuild')
const { nodeExternalsPlugin } = require('esbuild-node-externals')

esbuild
  .build({
    bundle: true,
    entryPoints: ['./src/index.ts', './src/pair.ts'],
    metafile: true,
    minify: true,
    outdir: 'dist/',
    platform: 'node',
    plugins: [nodeExternalsPlugin()],
    sourcemap: true,
    target: ['node10']
  })
  .then((result) => esbuild.analyzeMetafile(result.metafile))
  .then((analytics) => console.log(analytics))
  .catch((err) => {
    console.log(err)
    process.exit(1)
  })
