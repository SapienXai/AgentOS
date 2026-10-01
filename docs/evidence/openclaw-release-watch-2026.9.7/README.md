# OpenClaw release-watch evidence

The JSON intake and contract-diff files are the authenticated Actions artifacts. The three generated issue Markdown files are preserved byte-for-byte in `issue-markdown-verbatim.zip`; `issue-markdown-sha256.json` records their original hashes. The watcher intentionally emits trailing spaces for Markdown hard breaks, so these source files are archived verbatim to keep repository whitespace checks clean.

The workflow ran at `fb3f3d6dc9005c78002d54384d4147dbad857fad`, before the
2026.9.7 promotion commit. Its summary's recommended version and production-pin
fields describe that workflow snapshot, not the current promoted AgentOS
contract. Release-watch output is compatibility-intake evidence; the separately
generated 2026.9.7 final certification artifact records the later promotion.
