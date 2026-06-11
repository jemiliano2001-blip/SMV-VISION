module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "google",
    "plugin:@typescript-eslint/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.json", "tsconfig.dev.json"],
    sourceType: "module",
  },
  ignorePatterns: [
    "/lib/**/*", // Ignore built files.
    "/generated/**/*", // Ignore generated files.
  ],
  plugins: [
    "@typescript-eslint",
    "import",
  ],
  rules: {
    "quotes": ["error", "double"],
    "import/no-unresolved": 0,
    "indent": ["error", 2],
    // Los campos de Odoo son snake_case (date_order, qty_delivered, etc.).
    "camelcase": "off",
    // JSDoc no es obligatorio en este paquete.
    "require-jsdoc": "off",
    "valid-jsdoc": "off",
    // Las respuestas XML-RPC de Odoo son dinámicas; max-len no debe frenar deploy.
    "max-len": ["warn", {"code": 100, "ignoreUrls": true}],
  },
};
