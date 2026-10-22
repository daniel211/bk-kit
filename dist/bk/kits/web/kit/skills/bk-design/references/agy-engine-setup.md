# Running the agy Engine (bk-design)

Figma is read the same way on both engines — over REST, by `figma-cli.mjs`, before any model
is involved. So the agy engine needs no MCP server and no Figma setup beyond the token every
engine needs. What it does need:

1. `agy` on PATH, authenticated once by running it.
2. Narrow allow-rules in `~/.gemini/antigravity-cli/settings.json`, because headless agy
   cannot prompt for tool approval and auto-denies anything unapproved:
   ```json
   { "permissions": { "allow": [
       "read_file(*)", "write_file(/absolute/path/to/repo/bk/**)" ] } }
   ```
   The write rule is scoped to the repo's whole `bk/` tree, not to one flow: a rule that has
   to be re-added for every feature is a rule nobody keeps, which would make `auto` pick
   claude forever.
   The write rule must be an **absolute** path: agy checks permissions against the absolute
   path it resolved, and it resolves relative paths against its own workspace rather than the
   calling shell's directory. The runner prints the exact rule to add.

The kit prints these and never writes that file itself — it is shared with every other agy
session on the machine. `--dangerously-skip-permissions` is never used: it would auto-approve
every tool, shell commands included, on the user's repo. A run that cannot get permission
falls back to the claude engine.
