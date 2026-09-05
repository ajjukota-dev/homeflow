/**
 * ESLint rule: no Tailwind arbitrary values (technical/09 §2).
 *
 * `bg-[#E8431A]` and `h-[13px]` are how a design system leaks. Colours,
 * spacing, radii and type come from packages/ui/src/tokens.css and the Tailwind
 * theme that references it — so an arbitrary value in a class string is an
 * error, not a style choice.
 *
 * Written as a local rule rather than a dependency: eslint-plugin-tailwindcss
 * needs the Tailwind config resolved at lint time and does not support Tailwind
 * 3 + flat config cleanly. ~30 lines beats another node_modules tree.
 */

const ARBITRARY = /(?:^|[\s:])[a-z-]+-\[(#[0-9a-fA-F]{3,8}|[\d.]+(?:px|rem|em|vh|vw|%)|rgb|hsl)/;

/** @type {import("eslint").Rule.RuleModule} */
const noArbitraryTailwind = {
  meta: {
    type: "problem",
    docs: { description: "Ban Tailwind arbitrary colour and length values; use design tokens." },
    schema: [],
    messages: {
      arbitrary:
        "Tailwind arbitrary value in `{{value}}`. Colours, spacing, radii and type come from packages/ui/src/tokens.css and the Tailwind theme.",
    },
  },
  create(context) {
    /** @param {string} value @param {import("estree").Node} node */
    function check(value, node) {
      if (typeof value !== "string" || !value.includes("[")) return;
      if (!ARBITRARY.test(` ${value}`)) return;
      context.report({ node, messageId: "arbitrary", data: { value: value.slice(0, 80) } });
    }
    return {
      Literal(node) {
        check(node.value, node);
      },
      TemplateElement(node) {
        check(node.value.cooked ?? "", node);
      },
    };
  },
};

export default {
  rules: { "no-arbitrary-tailwind": noArbitraryTailwind },
};
