import { readFileSync } from "node:fs";

import { loadConfig } from "./config.mjs";
import { checkRules, formatFailures } from "./rules.mjs";

/** What Claude Code sent on stdin. Returns null when it cannot be read, which the caller treats as "let go". */
function readInput(stdin) {
  try {
    const text = stdin();
    return text ? JSON.parse(text) : {};
  } catch (err) {
    return err instanceof SyntaxError ? {} : null;
  }
}

const defaultStdin = () => (process.stdin.isTTY ? "" : readFileSync(0, "utf8"));

/**
 * Claude Code "Stop" hook. Exit code 2 refuses to let the assistant finish and feeds stderr back to it, so it keeps
 * working until the rules pass. Any other exit code lets it stop, so a trouble here (a damaged config, git missing)
 * also exits 2 with the reason: a guardrail that fails open is worse than none.
 * `stop_hook_active` is true when the assistant is already continuing because of this hook: it is let go then, so a
 * rule it cannot satisfy cannot loop forever (the gate in CI still fails). The same goes for input that cannot be
 * read at all, because the hook could not tell whether it is in a loop.
 */
export function runStopHook(cwd, { load = loadConfig, stdin = defaultStdin, err = console.error } = {}) {
  const input = readInput(stdin);
  if (input === null || input.stop_hook_active === true) return 0;
  try {
    const { failures } = checkRules(cwd, load(cwd));
    if (failures.length === 0) return 0;
    err(`railing: fix these before finishing (${failures.length}):\n${formatFailures(failures)}`);
  } catch (e) {
    err(`railing: could not check the rules: ${e.message}`);
  }
  return 2;
}
