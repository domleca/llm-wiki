import { createRequire } from "node:module";

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

const require = createRequire(import.meta.url);
const noDirectVaultWrite = require("./.eslintplugin/no-direct-vault-write.cjs");

export default [
  {
    ignores: ["node_modules/**", "main.js", "dist/**", "coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: "./tsconfig.json" },
    },
    plugins: {
      "local-rules": {
        rules: { "no-direct-vault-write": noDirectVaultWrite },
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      // Type-aware "no-unsafe-*" rules fire heavily on JSON parsing and
      // would require a large refactor that's out of scope for the
      // Obsidian review pass. Re-enable later if we want stricter typing.
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-base-to-string": "off",
      // Popout-window-correctness rules. Out of scope for this Obsidian
      // review pass — the bot does not flag them. Re-enable later.
      "obsidianmd/prefer-active-doc": "off",
      "obsidianmd/prefer-active-window-timers": "off",
      "obsidianmd/prefer-create-el": "off",
      "obsidianmd/prefer-instanceof": "off",
      "local-rules/no-direct-vault-write": "error",
    },
  },
  {
    files: ["**/*.cjs", "**/*.mjs"],
    languageOptions: {
      globals: {
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        process: "readonly",
      },
    },
  },
];
