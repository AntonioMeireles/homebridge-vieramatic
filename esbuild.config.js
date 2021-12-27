/* eslint-disable node/no-unpublished-require */
/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs')

const esbuild = require('esbuild')

// https://github.com/evanw/esbuild/issues/619#issuecomment-751995294
const makeAllPackagesExternalPlugin = {
  name: 'make-all-packages-external',
  setup(build) {
    const filter = /^[^./]|^\.[^./]|^\.\.[^/]/ // Must not start with "/" or "./" or "../"
    build.onResolve({ filter }, (args) => ({ external: true, path: args.path }))
  }
}

const catcher = (err) => {
  console.log(err)
  // eslint-disable-next-line no-process-exit
  process.exit(1)
}
const targets = { Browser: 'browser', Node: 'node' }

const builder = (entryPoints, outdir = 'dist', target = targets.Node) =>
  esbuild
    .build({
      ...{ bundle: true, metafile: true, minify: true, sourcemap: true },
      entryPoints,
      outdir,
      ...(target === targets.Node
        ? { platform: 'node', plugins: [makeAllPackagesExternalPlugin], target: 'node12' }
        : {
            inject: ['src/ui/react-shim.ts'],
            jsxFactory: 'h',
            jsxFragment: 'Fragment',
            target: ['chrome58', 'firefox57', 'safari11', 'edge18']
          })
    })
    .then((result) => esbuild.analyzeMetafile(result.metafile))
    .then(console.info)

fs.mkdirSync('dist/homebridge-ui/public', { recursive: true })
fs.copyFileSync('src/ui/public/index.html', 'dist/homebridge-ui/public/index.html')

const deliverables = [
  [['src/index.ts', 'src/pair.ts']],
  [['src/ui/server.ts'], 'dist/homebridge-ui/'],
  [['src/ui/index.tsx'], 'dist/homebridge-ui/public/', targets.Browser]
]

deliverables.forEach((payload) => builder(...payload).catch(catcher))
