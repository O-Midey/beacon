"use client";

import { useEffect, useRef } from "react";

export interface FlipEntry {
  w: string;
  bg: string;
  fg: string;
}

/**
 * The hero's rotating platform word. Every word is also rendered as a hidden
 * zero-height sizer inside the box, so the server HTML already reserves the
 * width of the widest word — the headline never re-wraps, even on first
 * paint before hydration. DOM is driven imperatively (classList/textContent
 * on refs) because the out-then-in choreography needs a forced reflow between
 * positions — React only renders the initial word. Cycling pauses on hidden
 * tabs and is disabled under prefers-reduced-motion.
 */
export function FlipWord({
  words,
  intervalMs = 2600,
}: {
  words: FlipEntry[];
  intervalMs?: number;
}) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const wordRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    const inner = wordRef.current;
    if (!box || !inner) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let idx = 0;
    let swap: ReturnType<typeof setTimeout> | undefined;
    const cycle = () => {
      if (document.hidden) return;
      inner.classList.add("flip-out");
      swap = setTimeout(() => {
        idx = (idx + 1) % words.length;
        const next = words[idx];
        inner.textContent = next.w;
        box.style.background = next.bg;
        box.style.color = next.fg;
        inner.classList.remove("flip-out");
        inner.classList.add("flip-in");
        void inner.offsetWidth; // commit the below-the-fold position, then slide up
        inner.classList.remove("flip-in");
      }, 220);
    };
    const id = setInterval(cycle, intervalMs);

    return () => {
      clearInterval(id);
      if (swap) clearTimeout(swap);
    };
  }, [words, intervalMs]);

  return (
    <span className="flip" ref={boxRef}>
      <span className="fw" ref={wordRef}>
        {words[0].w}
      </span>
      {words.map(({ w }) => (
        <span key={w} className="fw-size" aria-hidden="true">
          {w}
        </span>
      ))}
    </span>
  );
}
