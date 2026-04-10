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
      // SettingsOverlay.svelte triggers a crash in @typescript-eslint/no-unused-vars
      // (TypeError: Cannot read properties of undefined reading 'type') due to a bug
      // in svelte-eslint-parser with complex reactive declarations. Ignored until the
      // parser is fixed. Tracked upstream.
      "src/lib/components/SettingsOverlay.svelte",
    ],
  },

  // Base TypeScript rules
  ...tseslint.configs.recommended,

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
      // Too noisy for a desktop app — flags every array[idx] access.
      // All indices come from internal state, not external user input.
      "security/detect-object-injection": "off",
    },
  },
);
