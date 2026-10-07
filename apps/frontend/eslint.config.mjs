import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// eslint-plugin-jsx-a11y's "strict" preset. next/core-web-vitals registers the
// plugin but enables only a handful of its rules; screen-reader support needs
// all of them (see docs/ACCESSIBILITY.md). Listed by name so the plugin stays
// eslint-config-next's dependency rather than a second, separately pinned copy.
const jsxA11yStrict = {
  "jsx-a11y/alt-text": "error",
  "jsx-a11y/anchor-has-content": "error",
  "jsx-a11y/anchor-is-valid": "error",
  "jsx-a11y/aria-activedescendant-has-tabindex": "error",
  "jsx-a11y/aria-props": "error",
  "jsx-a11y/aria-proptypes": "error",
  "jsx-a11y/aria-role": "error",
  "jsx-a11y/aria-unsupported-elements": "error",
  "jsx-a11y/autocomplete-valid": "error",
  "jsx-a11y/click-events-have-key-events": "error",
  "jsx-a11y/heading-has-content": "error",
  "jsx-a11y/html-has-lang": "error",
  "jsx-a11y/iframe-has-title": "error",
  "jsx-a11y/img-redundant-alt": "error",
  "jsx-a11y/interactive-supports-focus": ["error", {
    tabbable: ["button", "checkbox", "link", "progressbar", "searchbox", "slider", "spinbutton", "switch", "textbox"],
  }],
  "jsx-a11y/label-has-associated-control": "error",
  "jsx-a11y/media-has-caption": "error",
  "jsx-a11y/mouse-events-have-key-events": "error",
  "jsx-a11y/no-access-key": "error",
  "jsx-a11y/no-autofocus": "error",
  "jsx-a11y/no-distracting-elements": "error",
  "jsx-a11y/no-interactive-element-to-noninteractive-role": "error",
  "jsx-a11y/no-noninteractive-element-interactions": ["error", {
    body: ["onError", "onLoad"], iframe: ["onError", "onLoad"], img: ["onError", "onLoad"],
  }],
  "jsx-a11y/no-noninteractive-element-to-interactive-role": "error",
  // A scroll container with nothing focusable inside must itself take focus
  // (role="region" + a name) or keyboard users can't scroll it.
  "jsx-a11y/no-noninteractive-tabindex": ["error", { tags: [], roles: ["tabpanel", "region"], allowExpressionValues: true }],
  // Tailwind's preflight sets `list-style: none`, and Safari/VoiceOver then
  // stops announcing <ul>/<ol> as lists unless role="list" is explicit.
  "jsx-a11y/no-redundant-roles": ["error", { ul: ["list"], ol: ["list"] }],
  "jsx-a11y/no-static-element-interactions": "error",
  "jsx-a11y/role-has-required-aria-props": "error",
  "jsx-a11y/role-supports-aria-props": "error",
  "jsx-a11y/scope": "error",
  "jsx-a11y/tabindex-no-positive": "error",
};

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["**/*.tsx"],
    rules: jsxA11yStrict,
  },
];

export default eslintConfig;
