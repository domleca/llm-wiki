/**
 * Custom ESLint rule: forbids direct calls to app.vault.create(),
 * app.vault.adapter.write(), app.vault.modify(), and app.vault.delete()
 * outside files under src/vault/.
 *
 * The plugin's safety guarantee is that all writes go through
 * src/vault/safe-write.ts. This rule enforces it at lint time.
 */
"use strict";

const FORBIDDEN_METHODS = new Set([
  "create",
  "modify",
  "delete",
  "write",
  "writeBinary",
  "trash",
]);

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid direct vault write calls outside src/vault/. Use safeWrite* helpers.",
    },
    schema: [],
    messages: {
      forbidden:
        "Direct vault write '{{name}}' is not allowed outside src/vault/. Use a safeWrite* helper from src/vault/safe-write.ts.",
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (filename.includes("/src/vault/") || filename.includes("\\src\\vault\\")) {
      return {};
    }
    if (filename.includes("/tests/") || filename.includes("\\tests\\")) {
      return {};
    }
    return {
      MemberExpression(node) {
        if (
          node.property &&
          node.property.type === "Identifier" &&
          FORBIDDEN_METHODS.has(node.property.name) &&
          node.parent &&
          node.parent.type === "CallExpression" &&
          node.parent.callee === node
        ) {
          const objectText = context.getSourceCode().getText(node.object);
          if (
            objectText.includes("vault") ||
            objectText.includes("adapter") ||
            objectText.includes("fileManager")
          ) {
            context.report({
              node,
              messageId: "forbidden",
              data: { name: node.property.name },
            });
          }
        }
      },
    };
  },
};
