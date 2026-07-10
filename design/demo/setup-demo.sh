#!/bin/bash
# Build the disposable environment the demo GIF records against:
# a fake HOME (config pre-pointed at the mock LLM), a `beacon` shim on PATH,
# and a small demo repo with one commit to draft from plus a staged-ready
# change for the live commit in the recording.
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
DEMO_HOME="$DEMO_DIR/home"
BEACON_DIST="$(cd "$DEMO_DIR/../.." && pwd)/dist/index.js"
NODE_BIN="$(command -v node)"

rm -rf "$DEMO_HOME"
mkdir -p "$DEMO_HOME/dev/pulse" "$DEMO_HOME/bin" "$DEMO_HOME/.beacon"

cat > "$DEMO_HOME/.gitconfig" <<'EOF'
[user]
	name = Mide
	email = demo@example.com
[init]
	defaultBranch = main
EOF

# Pre-seed only what init never asks for: the mock endpoint and a two-platform
# demo (keeps the review cards on screen). Everything else defaults.
cat > "$DEMO_HOME/.beacon/config.json" <<'EOF'
{
  "baseUrl": "http://127.0.0.1:8787/v1",
  "platforms": {
    "twitter": true,
    "linkedin": true,
    "devto": false,
    "bluesky": false,
    "mastodon": false
  }
}
EOF
chmod 600 "$DEMO_HOME/.beacon/config.json"

cat > "$DEMO_HOME/bin/beacon" <<EOF
#!/bin/sh
exec "$NODE_BIN" "$BEACON_DIST" "\$@"
EOF
chmod +x "$DEMO_HOME/bin/beacon"

cd "$DEMO_HOME/dev/pulse"
export HOME="$DEMO_HOME"
git init -q

mkdir -p src
cat > src/server.ts <<'EOF'
import { createApp } from "./app.js";

const app = createApp();
app.listen(3000);
EOF
cat > src/webhooks.ts <<'EOF'
export async function deliver(url: string, payload: unknown): Promise<void> {
  await fetch(url, { method: "POST", body: JSON.stringify(payload) });
}
EOF
git add -A
git commit -qm "chore: scaffold the service"

cat > src/rate-limit.ts <<'EOF'
import { redis } from "./redis.js";

const WINDOW_MS = 60_000;
const LIMIT = 100;

/** Sliding-window limiter: one ZADD + ZCOUNT round trip per check. */
export async function allow(userId: string): Promise<boolean> {
  const now = Date.now();
  const key = `rl:${userId}`;
  await redis.zadd(key, now, `${now}`);
  const count = await redis.zcount(key, now - WINDOW_MS, now);
  return count <= LIMIT;
}
EOF
git add -A
git commit -qm "feat: add per-user rate limiting to the API"

# Working-tree change for the live `git commit -am` in the recording.
cat > src/webhooks.ts <<'EOF'
import { withBackoff } from "./retry.js";

const MAX_ATTEMPTS = 5;

export async function deliver(url: string, payload: unknown): Promise<void> {
  await withBackoff(MAX_ATTEMPTS, async () => {
    const res = await fetch(url, { method: "POST", body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`delivery failed: ${res.status}`);
  });
}
EOF

echo "demo home ready at $DEMO_HOME"
