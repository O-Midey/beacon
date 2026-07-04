"use client";

import { useRef, useState } from "react";

interface CopyButtonProps {
  text: string;
  className?: string;
  label?: string;
}

export function CopyButton({ text, className = "copybtn", label = "copy" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const [popKey, setPopKey] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* clipboard unavailable — nothing else to try */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setPopKey((k) => k + 1);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1400);
  };

  return (
    <button
      key={popKey}
      type="button"
      className={popKey > 0 ? `${className} copied-pop` : className}
      onClick={onCopy}
    >
      {copied ? "copied!" : label}
    </button>
  );
}
