module.exports = {
  extends: [
    'eslint:recommended',

    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:import/typescript',
    'plugin:jest/recommended',
    'plugin:node/recommended',
    'plugin:json/recommended',
    'plugin:regexp/recommended',
    'plugin:promise/recommended',
    'plugin:eslint-comments/recommended',

    'preact',

    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:@typescript-eslint/recommended',
    // 'plugin:@typescript-eslint/recommended-requiring-type-checking',

    'plugin:prettier/recommended'
  ],
  ignorePatterns: ['dist'],
  parser: '@typescript-eslint/parser',

  parserOptions: {
    ecmaFeatures: {
      jsx: true
    },
    ecmaVersion: 'latest',
    project: './tsconfig.json',
    sourceType: 'module'
  },
  plugins: [
    '@typescript-eslint',
    'eslint-comments',
    'import',
    'jest',
    'node',
    'json',
    'prettier',
    'promise',
    'regexp',
    'sort-exports'
  ],
  root: true,
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        varsIgnorePattern: '^_'
      }
    ],
    'eslint-comments/disable-enable-pair': 'off',
    'eslint-comments/no-unused-disable': 'error',
    'import/exports-last': 'error',
    'import/group-exports': 'error',
    'import/order': [
      'error',
      {
        alphabetize: {
          caseInsensitive: true,
          order: 'asc'
        },
        'newlines-between': 'always'
      }
    ],
    'json/*': ['error', 'allowComments'],
    'node/no-missing-import': 'off',
    'node/no-unsupported-features/es-syntax': 'off',
    'node/shebang': 'off',
    'sort-exports/sort-exports': [
      'error',
      {
        ignoreCase: true,
        sortDir: 'asc',
        sortExportKindFirst: 'type'
      }
    ],
    'sort-keys': [
      'error',
      'asc',
      {
        caseSensitive: false,
        natural: true
      }
    ],
    'sort-vars': [
      'error',
      {
        ignoreCase: true
      }
    ]
  },
  settings: {
    'import/core-modules': ['homebridge']
  }
}
