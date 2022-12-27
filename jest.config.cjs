module.exports = {
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  moduleNameMapper: {
    '^react$': 'preact/compat',
    '^react/jsx-runtime$': 'preact/jsx-runtime',
    '^react-dom$': 'preact/compat',
    '^react-dom/test-utils$': 'preact/test-utils'
  },
  preset: 'ts-jest/presets/default-esm',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        isolatedModules: true,
        useESM: true
      }
    ]
  },
  verbose: true
}
