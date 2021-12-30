/* eslint-disable node/no-unpublished-require, no-process-exit, unicorn/no-process-exit, @typescript-eslint/no-var-requires */
const fs = require('fs')

const esbuild = require('esbuild')

// https://github.com/evanw/esbuild/issues/619#issuecomment-751995294
const makeAllPackagesExternalPlugin = {
  name: 'make-all-packages-external',
  setup(build) {
    const filter = /^[^./]|^\.[^./]|^\.\.[^/]/ // Must not start with "/" or "./" or "../"
    build.onResolve({ filter }, (arguments_) => ({ external: true, path: arguments_.path }))
  }
}

const catcher = (error) => {
  console.error(error)

  process.exit(1)
}
const targets = { Browser: 'browser', Node: 'node' }

const builder = (entryPoints, outdir = 'dist', target = targets.Node) =>
  esbuild
    .build({
      bundle: true,
      entryPoints,
      format: 'esm',
      metafile: true,
      minify: true,
      outdir,
      sourcemap: true,
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

for (const payload of deliverables) builder(...payload).catch(catcher)
