module.exports = {
  extends: [
    'eslint:recommended',
    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:import/typescript',
    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:json/recommended',
    'plugin:promise/recommended',
    'plugin:eslint-comments/recommended',
    'standard',
    'standard-with-typescript',
    'plugin:prettier/recommended',
    'prettier/@typescript-eslint',
    'prettier/standard'
  ],
  ignorePatterns: ['dist'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2018,
    project: './tsconfig.json',
    sourceType: 'module'
  },
  plugins: ['prettier', '@typescript-eslint', 'import', 'json', 'promise'],
  rules: {
    '@typescript-eslint/no-misused-promises': [
      'error',
      { checksVoidReturn: false }
    ],
    'eslint-comments/no-unused-disable': 'error',
    'import/order': [
      'error',
      {
        alphabetize: { caseInsensitive: true, order: 'asc' },
        'newlines-between': 'always'
      }
    ],
    'import/prefer-default-export': 'error',
    'json/*': ['error', 'allowComments'],
    'sort-imports': ['error', { ignoreDeclarationSort: true }],
    'sort-keys': ['error', 'asc', { caseSensitive: false, natural: true }],
    'sort-vars': ['error', { ignoreCase: true }]
  },
  settings: { 'import/core-modules': ['homebridge'] }
}
