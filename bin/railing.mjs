#!/usr/bin/env node
import { loadConfig } from "../src/config.mjs";
import { runGate } from "../src/gate.mjs";
import { runStopHook } from "../src/hook.mjs";
import { init } from "../src/init.mjs";
import { checkRatchet } from "../src/ratchet.mjs";
import { checkRules, formatFailures } from "../src/rules.mjs";

const HELP = `railing: guardrails for AI-written code

  railing init            add the config, hooks and CLAUDE.md rules to this project
  railing check           run the rules (fast; used by the pre-commit hook; --strict fails when no file matched)
  railing ratchet         check that no floor went down and no ceiling went up (--strict fails if the base is missing)
  railing gate            rules, ratchet, then the steps in railing.config.json (what CI runs)
  railing hook stop       Claude Code Stop hook: keeps the assistant working until the rules pass
`;

const [command, sub, ...rest] = process.argv.slice(2);
const flags = new Set([sub, ...rest].filter((a) => a?.startsWith("--")));
const unknown = [...flags].filter((f) => f !== "--strict");
const cwd = process.cwd();

try {
  if (unknown.length) throw new Error(`Unknown option ${unknown.join(", ")}. Known: --strict`);
  switch (command) {
    case "init":
      init(cwd);
      break;
    case "check": {
      const { files, failures } = checkRules(cwd, loadConfig(cwd));
      if (failures.length) {
        console.error(`railing: ${failures.length} rule problem(s)\n${formatFailures(failures)}`);
        process.exitCode = 1;
      } else if (files === 0) {
        console.error('railing: no files matched "include" and "extensions" in railing.config.json, so nothing was checked');
        process.exitCode = flags.has("--strict") ? 1 : 0;
      } else console.log(`railing: rules ok (${files} files)`);
      break;
    }
    case "ratchet": {
      const r = checkRatchet(cwd, loadConfig(cwd), { strict: flags.has("--strict") });
      for (const n of r.notes) console.log(`railing: ratchet ${n}`);
      if (r.failures.length) {
        console.error(`railing: the ratchet only tightens\n${r.failures.join("\n")}`);
        process.exitCode = 1;
      } else console.log("railing: ratchet ok");
      break;
    }
    case "gate":
      process.exitCode = runGate(cwd, loadConfig(cwd), { strict: flags.has("--strict") || sub === "--strict" });
      break;
    case "hook":
      if (sub !== "stop") throw new Error("Unknown hook. Known: stop");
      process.exitCode = runStopHook(cwd);
      break;
    default:
      console.log(HELP);
      process.exitCode = command && command !== "help" && command !== "--help" ? 1 : 0;
  }
} catch (err) {
  console.error(`railing: ${err.message}`);
  process.exitCode = 1;
}
