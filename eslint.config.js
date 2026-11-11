import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "coverage/"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: { allowDefaultProject: ["eslint.config.js"] } },
    },
  },
  {
    rules: {
      // NestJS injects by the constructor parameter's class, so these must stay value imports.
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },
);
