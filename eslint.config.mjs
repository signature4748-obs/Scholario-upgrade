import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // ─────────────────────────────────────────────────────────────────────
    // Phase 4 (item 13) — production lint must catch meaningful defects.
    //
    // Phase 0/1 kept the lint config permissive (`0 problems` gates were
    // trivially green). These rules are now ON at ERROR level and CI fails
    // on any violation. Stylistic rules stay OFF — the bar here is
    // "would this rule catch a real bug", not "is the style uniform".
    // ─────────────────────────────────────────────────────────────────────

    // Dead / contradictory code — always a defect.
    "no-unreachable": "error",
    "no-fallthrough": "error",
    "no-async-promise-executor": "error",
    "no-compare-neg-zero": "error",
    "no-cond-assign": ["error", "except-parens"],
    "no-constant-binary-expression": "error",
    "no-constructor-return": "error",
    "no-self-compare": "error",
    "no-shadow-restricted-names": "error",
    "no-unsafe-negation": "error",
    "no-useless-catch": "error",
    "valid-typeof": "error",
    "no-debugger": "error",
    "no-irregular-whitespace": "error",

    // Unused code — real signal (typos, half-finished edits, dead branches).
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrors: "none",
        ignoreRestSiblings: true,
      },
    ],

    // React hooks correctness — stale-closure bugs are the most common
    // meaningful React defect class. Kept at WARN (not error): this is a
    // large pre-existing codebase; the error-level rollout happens as
    // warnings are burned down. All other rules above are error-level.
    "react-hooks/exhaustive-deps": "warn",

    // ── eslint-config-next 16.4 / eslint-plugin-react-hooks upgrade ────
    // (2026-10-25 security-bump session): the new analyzer surfaced 8
    // error-level hits on pre-existing code. 1 was a GENUINE temporal-
    // dead-zone defect (tab-errors.tsx referenced `openDetail` in a
    // useEffect placed BEFORE its const declaration) — FIXED properly by
    // reordering the declaration, not by suppression. The remaining 7 are
    // react-hooks/preserve-manual-memoization "Compilation Skipped"
    // notices: they state the REACT COMPILER cannot preserve certain
    // manual useCallback/useMemo boundaries — but this app does NOT
    // enable React Compiler (next.config.ts has no reactCompiler key;
    // babel-plugin-react-compiler is an uninstalled optional peer), so
    // the manual memoization runs unchanged and the notices are
    // informational. Classified WARN — NOT off — so they stay visible
    // and must be re-examined if the compiler is ever enabled.
    "react-hooks/preserve-manual-memoization": "warn",

    // ── Intentionally permissive (documented, not defects) ──────────────
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    "prefer-const": "off",
    "no-console": "off",
    "no-empty": "off",
    "no-case-declarations": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-useless-escape": "off",
    "react-hooks/purity": "off",
    "react-hooks/set-state-in-effect": "off",
    "react-hooks/refs": "off",
    "react-compiler/react-compiler": "off",
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills", "mini-services/**", "upload/**", "tool-results/**", "public/**", ".audit-work/**", "db/**", "dev.log"]
}];

export default eslintConfig;
