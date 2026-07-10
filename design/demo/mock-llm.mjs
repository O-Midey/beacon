import { createServer } from "node:http";

/**
 * Deterministic Anthropic Messages API stand-in for recording the demo GIF.
 * Routes on the system prompt: ping → "OK", significance filter → a score,
 * technical content writer → platform drafts. Stateful so the two commits in
 * the demo produce different content. Delays are tuned so spinners visibly
 * spin without dragging the recording.
 */

const PORT = 8787;

const significanceResponses = [
  {
    isSignificant: true,
    score: 8,
    reason: "Ships per-user rate limiting — a real feature with an interesting implementation choice.",
    suggestedAngles: ["why a sliding window over fixed buckets", "one Redis round trip per check"],
  },
  {
    isSignificant: true,
    score: 7,
    reason: "Webhook retries with backoff — meaningful reliability work worth sharing.",
    suggestedAngles: ["exponential backoff with jitter", "dead-lettering after the last attempt"],
  },
];

const draftResponses = [
  {
    twitter: {
      tweets: [
        "Shipped per-user rate limiting in pulse today. Sliding window, 100 req/min, enforced before a request ever touches the database.",
        "The fun part: each window is one Redis sorted set — a single ZADD + ZCOUNT round trip per check. No locks, no races, ~0.4ms overhead.",
      ],
      hashtags: ["buildinpublic", "devtools"],
    },
    linkedin: {
      hook: "Rate limiting is one of those features nobody notices until it's missing.",
      body: "Rate limiting is one of those features nobody notices until it's missing.\n\nToday pulse got per-user sliding windows: 100 requests a minute, checked at the edge in a single Redis round trip. I went with sorted sets over fixed buckets — smoother limits, no thundering herd at the window boundary.\n\nSmall feature, big difference in how the API behaves under pressure.",
    },
  },
  {
    twitter: {
      tweets: [
        "Webhooks in pulse now retry with exponential backoff + jitter — 5 attempts over ~15 minutes, then dead-lettered with the full delivery log.",
        "Deliveries that used to vanish on a consumer's 500 now just... arrive late. Reliability is a feature.",
      ],
      hashtags: ["buildinpublic", "webhooks"],
    },
    linkedin: {
      hook: "A webhook that fails once shouldn't fail forever.",
      body: "A webhook that fails once shouldn't fail forever.\n\npulse now retries failed deliveries with exponential backoff and jitter — five attempts spread over fifteen minutes, then a dead-letter queue with the full delivery log so nothing disappears silently.\n\nThe kind of work users never see, and always feel.",
    },
  },
];

let sigCalls = 0;
let draftCalls = 0;

function respond(system) {
  if (system.includes("significance filter")) {
    const body = significanceResponses[Math.min(sigCalls++, significanceResponses.length - 1)];
    return { delay: 1100, text: JSON.stringify(body) };
  }
  if (system.includes("technical content writer")) {
    const body = draftResponses[Math.min(draftCalls++, draftResponses.length - 1)];
    return { delay: 1700, text: JSON.stringify(body) };
  }
  return { delay: 400, text: "OK" }; // pingProvider
}

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    let system = "";
    try {
      system = String(JSON.parse(raw).system ?? "");
    } catch {
      /* ping-shaped garbage still gets OK */
    }
    const { delay, text } = respond(system);
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ content: [{ type: "text", text }] }));
    }, delay);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock anthropic listening on http://127.0.0.1:${PORT}/v1/messages`);
});
