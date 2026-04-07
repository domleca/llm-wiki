"use strict";

module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint", "local-rules"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  rules: {
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "@typescript-eslint/no-explicit-any": "warn",
    "local-rules/no-direct-vault-write": "error",
  },
  ignorePatterns: ["node_modules/", "main.js", "dist/", "coverage/", ".eslintplugin/"],
  overrides: [
    {
      files: ["*.cjs", "*.mjs"],
      env: { node: true },
    },
  ],
};
