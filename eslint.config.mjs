import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Generated output is not source. Linting .next produces thousands of errors
  // about machine-written code and buries anything real.
  { ignores: ["node_modules/**", "dist/**", "coverage/**", ".next/**", "next-env.d.ts"] },

  js.configs.recommended,

  // Type-aware rules apply only to TypeScript sources that are part of the
  // tsconfig project. Config files written in .mjs are linted without type
  // information, because they are not in the project and do not need to be.
  {
    files: ["**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Domain rules are deterministic; an implicit `any` can silently turn a
      // feasibility comparison into a no-op. Treat it as an error, not a warning.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Consistent type-only imports keep the domain layer erasable at runtime.
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // Plain JS/MJS config files: syntax and correctness only, no type information.
  {
    files: ["**/*.mjs", "**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
