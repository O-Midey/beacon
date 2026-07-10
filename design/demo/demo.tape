# Demo GIF for the Beacon README: init → commit drafting via the hook → review.
# Records against the mock LLM on 127.0.0.1:8787 (start mock-llm.mjs first,
# run setup-demo.sh to build the fake HOME).

Output "../../assets/demo.gif"

Set Shell "bash"
Set FontSize 14
Set Width 1180
Set Height 680
Set Padding 24
Set TypingSpeed 55ms
Set Theme { "name": "beacon", "background": "#171714", "foreground": "#e8e6df", "cursor": "#ffc900", "black": "#2a2926", "red": "#ff6b6b", "green": "#23a094", "yellow": "#ffc900", "blue": "#8ab8ff", "magenta": "#ff90e8", "cyan": "#7ad9d0", "white": "#e8e6df", "brightBlack": "#55534b", "brightRed": "#ff8f8f", "brightGreen": "#37c0b2", "brightYellow": "#ffd84d", "brightBlue": "#a9c9ff", "brightMagenta": "#ffb0ef", "brightCyan": "#9ce6de", "brightWhite": "#f4f4f0" }

Hide
Type `export HOME="$PWD/home"`
Enter
Type `export PATH="$HOME/bin:$PATH"; export COLORTERM=truecolor; unset HISTFILE`
Enter
Type `cd "$HOME/dev/pulse"`
Enter
Type `export PS1='\[\033[38;2;255;201;0m\]> \[\033[0m\]'`
Enter
Type `clear`
Enter
Show

Sleep 800ms
Type "beacon init"
Sleep 500ms
Enter
Sleep 1.6s

# Provider: Anthropic (default)
Enter
Sleep 1.1s

# API key
Type "demo-key-not-a-real-token-4f2a"
Sleep 400ms
Enter
Sleep 1.1s

# Personalize now? → yes
Type "y"
Sleep 900ms

# Bio
Type "an indie hacker building devtools in public"
Sleep 300ms
Enter
Sleep 800ms

# Voice notes → skip
Enter
Sleep 700ms

# Language → English (default)
Enter
Sleep 1.6s

# Test the connection? → yes (mock replies OK)
Type "y"
Sleep 2s

# Install the post-commit hook? → yes
Type "y"
Sleep 1.4s

# Draft from the latest commit right now? → yes
Type "y"
Sleep 5.5s
Sleep 2s

# The hook at work: a normal commit drafts in the background.
Type "git commit -am 'feat: retry failed webhooks with backoff'"
Sleep 400ms
Enter
Sleep 4.5s

Type "beacon review"
Sleep 400ms
Enter
Sleep 2s

# First card: read it, approve, copy Twitter/X to the clipboard.
Sleep 2.8s
Enter
Sleep 1.2s
Enter
Sleep 2s

# Second card: leave it for later.
Sleep 2.6s
Down
Sleep 250ms
Down
Sleep 250ms
Down
Sleep 350ms
Enter
Sleep 1.2s

Sleep 3s
