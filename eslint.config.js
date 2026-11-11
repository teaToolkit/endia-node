// The static analysis every check runs: the type-aware rules of typescript-eslint over the sources and the tests.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{ ignores: ["build/", "dist/", "node_modules/", "eslint.config.js"] },
	js.configs.recommended,
	...tseslint.configs.strictTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
			"@typescript-eslint/explicit-module-boundary-types": "error",
			"@typescript-eslint/consistent-type-imports": "error",
			eqeqeq: "error",
			// An aborted request rejects with its signal's reason, as Node's own APIs do, and that reason is typed any.
			"@typescript-eslint/prefer-promise-reject-errors": ["error", { allowThrowingAny: true }],
			// node:test runs the promises describe and it return; awaiting them would change nothing.
			"@typescript-eslint/no-floating-promises": ["error", { allowForKnownSafeCalls: [{ from: "package", package: "node:test", name: ["describe", "it"] }] }],
		},
	},
);
