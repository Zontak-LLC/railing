import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Rules a linter cannot express, found with plain text search. Each built-in has an id that the config switches on
 * (true), off (false) or, for `max-lines`, sets to a number. The patterns are written so this file does not trip them.
 */
const TS_PRAGMA = new RegExp(`@ts-(${"ignore"}|${"nocheck"})`);
export const BUILT_IN = {
  "no-ts-ignore": { message: "no @ts-ignore / @ts-nocheck (use @ts-expect-error with a reason)", re: TS_PRAGMA },
  "no-double-cast": {
    message: "no `as unknown as` double casts in app code",
    re: /\bas unknown as\b/,
    skip: /(__tests__|\.test\.|\.spec\.|(^|\/)tests?\/)/,
  },
  "todo-needs-issue": {
    message: "TODO/FIXME/HACK must name an issue, e.g. TODO(#41)",
    re: new RegExp(`\\b(${["TO", "DO"].join("")}|FIX${"ME"}|HA${"CK"})\\b(?!\\(#\\d+\\))`),
  },
  "no-eval": { message: "no eval / new Function", re: new RegExp(`\\b${"eval"}\\(|new ${"Function"}\\(`) },
  "no-focused-tests": {
    message: "no .only, no unconditional .skip in tests",
    re: /\b(it|test|describe)\.only\(|\b(it|test|describe)\.skip\(\s*["'`]/,
    only: /(__tests__|\.test\.|\.spec\.|(^|\/)tests?\/|e2e)/,
  },
};

/**
 * An exemption is `railing-ok: <reason>`; a reason is required. It covers its own line, and the NEXT line only when it
 * sits on a line of its own (a comment), so a trailing comment cannot also silence the line below it.
 */
const EXEMPT = /railing-ok:\s*(\S.{2,})/;
const COMMENT_ONLY = /^\s*(\/\/|\/\*|\*|#|<!--)/;
const BARE_EXEMPT = /railing-ok:\s*$/;
const EXEMPT_WINDOW = 5;

/** Tracked and new (not ignored) files under the configured folders with the configured extensions. */
export function listFiles(cwd, config) {
  let out;
  try {
    // -z and quotePath=false keep names with spaces or non-ASCII letters intact.
    out = execFileSync("git", ["-c", "core.quotePath=false", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    throw new Error("railing needs a git repository (it checks the files git knows about). Run `git init` first.");
  }
  const exts = new Set(config.extensions.map((e) => e.replace(/^\./, "")));
  const excludes = config.exclude.map((e) => new RegExp(e));
  return out
    .split("\0")
    .filter(Boolean)
    .filter((f) => existsSync(join(cwd, f))) // listed by git but deleted from disk
    .filter((f) => exts.has(f.split(".").pop() ?? ""))
    .filter((f) => config.include.length === 0 || config.include.some((d) => f === d || f.startsWith(`${d.replace(/\/$/, "")}/`)))
    .filter((f) => !excludes.some((re) => re.test(f)));
}

function buildRules(config) {
  const rules = [];
  for (const [id, setting] of Object.entries(config.rules)) {
    if (id === "max-lines" || setting !== true) continue;
    const rule = BUILT_IN[id];
    if (!rule) throw new Error(`Unknown rule "${id}" in the config. Known rules: ${Object.keys(BUILT_IN).join(", ")}, max-lines.`);
    rules.push({ name: rule.message, re: rule.re, only: rule.only, skip: rule.skip });
  }
  for (const c of config.custom) {
    rules.push({ name: c.name, re: new RegExp(c.pattern), only: c.only && new RegExp(c.only), skip: c.skip && new RegExp(c.skip) });
  }
  return rules;
}

/** Checks every file. Returns { files, failures: [{ file, line, rule }] }. */
export function checkRules(cwd, config) {
  const files = listFiles(cwd, config);
  const rules = buildRules(config);
  const maxLines = typeof config.rules["max-lines"] === "number" ? config.rules["max-lines"] : 0;
  const failures = [];
  for (const file of files) {
    const lines = readFileSync(join(cwd, file), "utf8").split("\n");
    const exemptAt = (i) => EXEMPT.test(lines[i] ?? "") || (COMMENT_ONLY.test(lines[i - 1] ?? "") && EXEMPT.test(lines[i - 1]));
    lines.forEach((line, i) => {
      if (BARE_EXEMPT.test(line)) failures.push({ file, line: i + 1, rule: "an exemption needs a reason: railing-ok: <why>" });
      if (exemptAt(i)) return;
      for (const r of rules) {
        if (r.only && !r.only.test(file)) continue;
        if (r.skip?.test(file)) continue;
        if (r.re.test(line)) failures.push({ file, line: i + 1, rule: r.name });
      }
    });
    const count = lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
    if (maxLines > 0 && count > maxLines && !lines.slice(0, EXEMPT_WINDOW).some((l) => COMMENT_ONLY.test(l) && EXEMPT.test(l))) {
      failures.push({ file, line: 1, rule: `file is ${count} lines (limit ${maxLines}): split it, or add railing-ok: <why> at the top` });
    }
  }
  return { files: files.length, failures };
}

export function formatFailures(failures) {
  return failures.map((f) => `${f.file}:${f.line}  ${f.rule}`).join("\n");
}
