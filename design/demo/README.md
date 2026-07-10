# demo rig

Reproducible recordings for the two README GIFs. Everything runs against a
**mock LLM on `127.0.0.1:8787`** — the real pipeline executes end to end, but
no key and no diff ever leave the machine, and the output is deterministic.

## Pieces

| File | What it is |
| --- | --- |
| `mock-llm.mjs` | Anthropic Messages API stand-in. Routes on the system prompt (ping / significance / drafter); stateful so the two demo commits draft different content. |
| `setup-demo.sh` | Builds a disposable fake `HOME` here (`home/`): seeded config pointed at the mock, a `beacon` shim on PATH, and the `pulse` demo repo with one commit to draft plus a working-tree change for the live commit. |
| `demo.tape` | The terminal GIF ([vhs](https://github.com/charmbracelet/vhs)): `beacon init` → hook commit → `beacon review`. Theme derived from the brand palette. |
| `ui-demo.mjs` | The browser GIF (playwright-core, uses installed Chrome): seeds the queue, starts `beacon serve --port 4340`, walks the UI — expand, inline edit, a live SSE card arrival, copy, approve — and saves `ui-demo.webm`. |

## Recording

Prereqs: `npm run build` at the repo root; `brew install vhs gifsicle`;
Google Chrome installed; `npm install` in this directory (playwright-core).

```bash
cd design/demo

# terminal GIF → ../../assets/demo.gif
./setup-demo.sh
node mock-llm.mjs &          # fresh start per recording — it is stateful
vhs demo.tape
kill %1

# browser GIF → ui-demo.webm, then encode
./setup-demo.sh
node mock-llm.mjs &
node ui-demo.mjs
kill %1
ffmpeg -y -i ui-demo.webm \
  -vf "fps=7,scale=880:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5" \
  ui-demo-raw.gif
gifsicle -O3 --lossy=80 ui-demo-raw.gif -o ../../assets/ui-demo.gif
```

Always re-run `setup-demo.sh` **and** restart the mock between takes: the repo
state (one commit drafted, one pending) and the mock's response counters both
assume a fresh start.

The `beacon ui` recording uses port **4340**, not the default 2322, so a real
`beacon ui` session can keep running while you record.
