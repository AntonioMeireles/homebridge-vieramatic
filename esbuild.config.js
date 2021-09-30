/* eslint-disable @typescript-eslint/no-var-requires */
const esbuild = require('esbuild')
// https://github.com/evanw/esbuild/issues/619#issuecomment-751995294
const makeAllPackagesExternalPlugin = {
  name: 'make-all-packages-external',
  setup(build) {
    const filter = /^[^./]|^\.[^./]|^\.\.[^/]/ // Must not start with "/" or "./" or "../"
    build.onResolve({ filter }, (args) => ({ external: true, path: args.path }))
  }
}

esbuild
  .build({
    bundle: true,
    entryPoints: ['./src/index.ts', './src/pair.ts'],
    metafile: true,
    minify: true,
    outdir: 'dist/',
    platform: 'node',
    plugins: [makeAllPackagesExternalPlugin],
    sourcemap: true,
    target: ['node10']
  })
  .then((result) => esbuild.analyzeMetafile(result.metafile))
  .then((analytics) => console.log(analytics))
  .catch((err) => {
    console.log(err)
    process.exit(1)
  })
