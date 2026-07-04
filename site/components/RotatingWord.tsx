"use client";

import { useEffect, useState } from "react";

/**
 * Cycles through words in the hero headline. Server renders the first word
 * (no hydration mismatch); cycling starts client-side and is disabled
 * entirely under prefers-reduced-motion.
 */
export function RotatingWord({
  words,
  intervalMs = 2600,
}: {
  words: string[];
  intervalMs?: number;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % words.length), intervalMs);
    return () => clearInterval(id);
  }, [words.length, intervalMs]);

  return (
    <span className="rotate-word">
      <span className="word" key={index}>
        {words[index]}
      </span>
    </span>
  );
}
