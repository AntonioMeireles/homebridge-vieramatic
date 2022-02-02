const fs = require('fs')

const esbuild = require('esbuild')

const catcher = (error) => {
  console.error(error)
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1)
}
const targets = { Browser: 'browser', Node: 'node' }

const builder = (entryPoints, outdir = 'dist', platform = targets.Node) =>
  esbuild
    .build({
      bundle: true,
      entryPoints,
      format: 'esm',
      metafile: true,
      minify: true,
      outdir,
      platform,
      sourcemap: true,
      ...(platform === targets.Node
        ? { external: ['./node_modules/*'], target: 'node14' }
        : {
            inject: ['src/ui/react-shim.ts'],
            jsxFactory: 'h',
            jsxFragment: 'Fragment',
            target: ['es2018', 'chrome58', 'firefox57', 'safari11', 'edge18', 'ios11']
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
