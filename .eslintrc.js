module.exports = {
  extends: [
    'eslint:recommended',

    'plugin:@typescript-eslint/recommended',

    'plugin:json/recommended',
    'plugin:promise/recommended',
    'plugin:eslint-comments/recommended',
    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:import/typescript',

    'standard-with-typescript',

    'plugin:prettier/recommended'
  ],
  ignorePatterns: ['dist', 'jest.config.js'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2018,
    project: './tsconfig.json',
    sourceType: 'module'
  },
  plugins: ['prettier', '@typescript-eslint', 'import', 'json', 'promise', 'eslint-comments'],
  rules: {
    '@typescript-eslint/no-misused-promises': [
      'error',
      {
        checksVoidReturn: false
      }
    ],
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
