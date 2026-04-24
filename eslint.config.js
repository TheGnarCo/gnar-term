import tseslint from "typescript-eslint";
import sveltePlugin from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import securityPlugin from "eslint-plugin-security";

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "dist/",
      "src-tauri/",
      "node_modules/",
      "*.config.*",
      // These files trigger a crash in @typescript-eslint/no-unused-vars
      // (TypeError: Cannot read properties of undefined reading 'type') due to a bug
      // in svelte-eslint-parser with {@const} blocks in Svelte templates.
      // TODO: Re-test after svelte-eslint-parser > 1.6.0 — remove exclusions if fixed.
      "src/lib/components/SettingsOverlay.svelte",
      "src/lib/components/WorkspaceItem.svelte",
    ],
  },

  // Base TypeScript rules
  ...tseslint.configs.recommended,

  // Enable type-aware parsing for no-floating-promises (async safety).
  // Only this rule requires the project service — keep the rest lightweight.
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.config.*"],
          defaultProject: "tsconfig.json",
        },
        extraFileExtensions: [".svelte"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Security rules
  securityPlugin.configs.recommended,

  // Svelte files
  {
    files: ["**/*.svelte"],
    plugins: { svelte: sveltePlugin },
    languageOptions: {
      parser: svelteParser,
      parserOptions: { parser: tseslint.parser },
    },
    rules: {
      ...sveltePlugin.configs.recommended.rules,
    },
  },

  // Project-wide overrides
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "separate-type-imports",
          disallowTypeAnnotations: false,
        },
      ],
      // Allow console.warn and console.error for legitimate error reporting;
      // block console.log to prevent debug leaks in production.
      "no-console": ["error", { allow: ["warn", "error"] }],
      // Catch unhandled promise rejections — critical for a Tauri app where
      // invoke() calls are async and silent failures mask real errors.
      "@typescript-eslint/no-floating-promises": "error",
      // Too noisy for a desktop app — flags every array[idx] access.
      // All indices come from internal state, not external user input.
      "security/detect-object-injection": "off",
    },
  },

  // Test files are excluded from tsconfig.json — disable type-checked rules
  // so they don't fail the project service lookup.
  {
    files: ["src/__tests__/**", "src/**/__tests__/**"],
    ...tseslint.configs.disableTypeChecked,
  },
);
