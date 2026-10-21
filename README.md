# railing

Guardrails for code written with AI assistants. One command, `railing gate`, that CI, your git hooks and the assistant itself all run, so quality doesn't depend on anyone remembering the rules.

It came out of [UseHourly](https://github.com/Zontak-LLC/usehourly), a time tracker built almost entirely with Claude Code, where these checks kept the codebase from turning into a mess. This is those checks, pulled out so you can add them to your own project.

> Status: v0.1. It is small on purpose. It works for JavaScript and TypeScript projects in a git repository. It does not replace your linter, type checker or tests. It runs them, and adds what they can't express.

## Try it

```sh
npm i -D @zontak/railing
npx railing init
npx railing gate
```

`init` is safe to run again. It adds only what's missing:

- `railing.config.json`: the rules, the folders they cover, and the steps the gate runs (it picks up your `lint`, `typecheck` and `test` scripts)
- a Claude Code **Stop hook** in `.claude/settings.json` (merged into what you have)
- a rules section in `CLAUDE.md` for the assistant to read
- `.githooks/pre-commit` and `pre-push`, and it points git at them
- `.railing/floors.json`, for the ratchet

## What it does

**Rules a linter can't express.** Plain text rules with a file and line in the failure: no `@ts-ignore`, no `as unknown as`, TODOs must name an issue, no `eval`, no `.only` in tests, and a maximum file length. Add your own with a regular expression. An exemption is `railing-ok: <reason>` on or above the line, and without a real reason it is a failure too.

**A ratchet.** `.railing/floors.json` holds numbers that may only get stricter: `floors` (such as a coverage minimum) can't go down, `ceilings` (such as allowed warnings) can't go up. `railing ratchet` compares the file with the one on your base branch, so loosening a number takes a visible change that fails the check. Deleting the file fails too. Note that only this file is ratcheted: `railing.config.json` is not, so turning a rule off or adding an `exclude` there is not caught by the gate. Review changes to that file like you review code.

**A Stop hook that keeps the assistant working.** When Claude Code tries to finish, the hook runs the rules. If any fail, it refuses to let the assistant stop and hands it the file, line and reason. It lets go on the second try, so a rule it can't satisfy can't loop forever. CI still fails.

**One gate.** `railing gate` runs the rules, the ratchet, then each step you configured, and stops at the first failure.

```json
{
  "include": ["src", "test"],
  "rules": { "max-lines": 300 },
  "steps": [
    { "name": "lint", "run": "npm run lint" },
    { "name": "types", "run": "npx tsc --noEmit" },
    { "name": "test", "run": "npm test" }
  ]
}
```

## In CI

Fetch full history so the ratchet can see the base branch, and use `--strict` so a missing base fails instead of being skipped:

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
- run: npx railing gate --strict
```

## Limits

- The gate runs the commands in `steps` through a shell, with the same trust as the scripts in your `package.json`. In CI, a pull request that edits `railing.config.json` can change what runs, so treat that file as code that needs review.
- The Stop hook exits 2 when something is wrong or can't be checked, so the assistant keeps working and sees why. It lets go on its second try (and when it can't read its input) so it can never loop forever. CI is the backstop.
- It checks text, not meaning. A regular expression can be fooled, and a rule is only as good as its pattern.
- It does not run your tests for you, it runs the command you give it.
- Only built-in rules and your own patterns for now. Structural checks (for example "browser code never imports server code") are not included yet.

## Licence

MIT
