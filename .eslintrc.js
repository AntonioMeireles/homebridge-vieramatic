
module.exports = {
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:json/recommended",
    "plugin:promise/recommended",
    "plugin:import/typescript",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "plugin:prettier/recommended",
    "plugin:eslint-comments/recommended",
    "standard",
    "standard-with-typescript",
    "prettier",
    "prettier/@typescript-eslint",
    "prettier/standard",

  ],
  ignorePatterns: [
    "dist"
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    "ecmaVersion": 2018,
    "project": "./tsconfig.json",
    "sourceType": "module"
  },
  plugins: [
    "prettier",
    "@typescript-eslint",
    "import",
    "json",
    "promise"
  ],
  rules: {
    "indent": "error",
    "@typescript-eslint/no-misused-promises": [
      "error",
      {
        "checksVoidReturn": false
      }
    ],
    "import/order": [
      "error",
      {
        "alphabetize": {
          "caseInsensitive": true,
          "order": "asc"
        },
        "newlines-between": "always"
      }
    ],
    "import/prefer-default-export": "error",
    "json/*": [
      "error",
      "allowComments"
    ]
  },
  settings: {
    "import/core-modules": [
      "homebridge"
    ]
  }
}