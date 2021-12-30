module.exports = {
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  globals: {
    'ts-jest': {
      isolatedModules: true,
      useESM: true
    }
  },
  testEnvironment: 'node',
  transform: {
    '^.+\\.(ts|tsx)?$': [
      'esbuild-jest',
      {
        format: 'esm',
        sourcemap: true,
        target: 'esnext'
      }
    ]
  },
  verbose: true
}
