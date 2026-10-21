# CLAUDE.md: railing

A small zero-dependency Node tool (ESM, Node 20+) that puts guardrails around AI-written code. Read `README.md` first.

- `src/rules.mjs` (text rules), `src/ratchet.mjs` (numbers that only tighten), `src/gate.mjs` (the one command), `src/hook.mjs` (Claude Code Stop hook), `src/init.mjs` (adds it all to a project), `src/config.mjs`.
- Tests are scenarios: each file runs the real CLI in a throwaway git repo (`test/helpers.mjs`). No mocks of git or the file system.
- Run `npm run gate` before saying a task is done. It runs railing on itself.
- No dependencies. Everything uses Node built-ins.
- Every bug fix ships with a test that fails without the fix.
- Thresholds only get tighter.
