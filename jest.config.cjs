module.exports = {
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  globals: {
    'ts-jest': {
      isolatedModules: true,
      useESM: true
    }
  },
  preset: 'ts-jest/presets/default-esm',
  verbose: true
}
