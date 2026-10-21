import { spawnSync } from "node:child_process";

import { checkRatchet } from "./ratchet.mjs";
import { checkRules, formatFailures } from "./rules.mjs";

/**
 * The one gate: rules, then the ratchet, then each configured step (lint, types, tests...) in order, stopping at the
 * first failure so the message that matters is the last one printed. CI, the git hooks and a person run the same thing.
 */
export function runGate(cwd, config, { strict = false, out = console.log, err = console.error } = {}) {
  const rules = checkRules(cwd, config);
  if (rules.failures.length) {
    err(`railing: ${rules.failures.length} rule problem(s)\n${formatFailures(rules.failures)}`);
    return 1;
  }
  if (rules.files === 0) {
    const msg = "railing: no files matched \"include\" and \"extensions\" in railing.config.json, so nothing was checked";
    if (strict) {
      err(msg);
      return 1;
    }
    err(`${msg} (this fails with --strict)`);
  } else out(`railing: rules ok (${rules.files} files)`);

  const ratchet = checkRatchet(cwd, config, { strict });
  for (const note of ratchet.notes) out(`railing: ratchet ${note}`);
  if (ratchet.failures.length) {
    err(`railing: the ratchet only tightens\n${ratchet.failures.join("\n")}`);
    return 1;
  }
  if (ratchet.status === "ok") out("railing: ratchet ok");

  for (const step of config.steps) {
    out(`railing: ${step.name} ...`);
    const result = spawnSync(step.run, { cwd, shell: true, stdio: "inherit" });
    if (result.status !== 0) {
      err(`railing: step "${step.name}" failed (${step.run})`);
      return result.status || 1;
    }
  }
  out("railing: gate passed");
  return 0;
}
