import type { ReactNode } from "react";
import { Children, isValidElement } from "react";
import { CopyButton } from "./CopyButton";

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/**
 * Replaces `pre` in MDX output: bordered block with a working copy button.
 * The copied text is the block's full text content.
 */
export function CodeBlock({ children }: { children?: ReactNode }) {
  const text = Children.toArray(children).map(textOf).join("").replace(/\n$/, "");
  return (
    <div className="codeblock">
      <CopyButton text={text} />
      <pre>{children}</pre>
    </div>
  );
}
