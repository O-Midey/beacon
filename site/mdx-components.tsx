import type { MDXComponents } from "mdx/types";
import { CodeBlock } from "@/components/CodeBlock";

/**
 * Global MDX element mapping. Fenced code blocks become bordered CodeBlocks
 * with a copy button; inline code and headings are styled by the
 * `.docs-article` CSS scope, so no per-element classes are needed here.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    pre: CodeBlock,
    ...components,
  };
}
