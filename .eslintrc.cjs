module.exports = {
  env: { es6: true, node: true },
  ignorePatterns: ['dist'],
  overrides: [
    {
      extends: [
        'plugin:jsonc/auto-config',
        'plugin:jsonc/recommended-with-json',
        'plugin:jsonc/prettier',
        'plugin:prettier/recommended'
      ],
      files: ['*.json'],
      parser: 'jsonc-eslint-parser',
      plugins: ['jsonc']
    },

    {
      extends: [
        'eslint:recommended',
        'preact',
        'plugin:import/errors',
        'plugin:import/warnings',
        'plugin:import/typescript',
        'plugin:jest/recommended',
        'plugin:node/recommended',

        'plugin:regexp/recommended',
        'plugin:promise/recommended',
        'plugin:eslint-comments/recommended',

        'plugin:@typescript-eslint/eslint-recommended',
        'plugin:@typescript-eslint/recommended',
        // 'plugin:@typescript-eslint/recommended-requiring-type-checking',
        'plugin:unicorn/recommended',
        'plugin:prettier/recommended'
      ],
      files: ['*.ts', '*.tsx', '*.cjs'],
      overrides: [{ files: ['*.cjs'], rules: { '@typescript-eslint/no-var-requires': 'off' } }],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        ecmaFeatures: { impliedStrict: true, jsx: true, modules: true },
        ecmaVersion: 'latest',
        project: './tsconfig.json',
        sourceType: 'module'
      },

      rules: {
        '@typescript-eslint/no-unnecessary-condition': 'error',
        '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_' }],
        'eslint-comments/disable-enable-pair': 'off',
        'eslint-comments/no-unused-disable': 'error',
        'import/exports-last': 'error',
        'import/group-exports': 'error',
        'import/order': [
          'error',
          { alphabetize: { caseInsensitive: true, order: 'asc' }, 'newlines-between': 'always' }
        ],
        'no-process-exit': 'off', // unicorn already covers this
        'node/no-missing-import': 'off',
        'node/shebang': 'off',
        'sort-exports/sort-exports': [
          'error',
          { ignoreCase: true, sortDir: 'asc', sortExportKindFirst: 'type' }
        ],
        'sort-keys': ['error', 'asc', { caseSensitive: false, natural: true }],
        'sort-vars': ['error', { ignoreCase: true }],
        'unicorn/consistent-function-scoping': 'off',
        'unicorn/filename-case': 'off',
        'unicorn/new-for-builtins': 'off',
        'unicorn/prevent-abbreviations': 'off'
      }
    }
  ],
  plugins: [
    '@typescript-eslint/eslint-plugin',
    'unicorn',
    'eslint-comments',
    'import',
    'jest',
    'node',
    'prettier',
    'promise',
    'regexp',
    'sort-exports'
  ],
  root: true,
  settings: {
    'import/core-modules': ['homebridge'],
    'import/extensions': ['.ts', '.tsx'],
    'import/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx'] },
    'import/resolver': { node: { extensions: ['.ts', '.tsx'] }, typescript: {} }
  }
}
