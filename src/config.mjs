import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_FILE = "railing.config.json";

/** What a project gets when its config leaves something out. */
export const DEFAULTS = {
  include: ["src", "app", "lib", "scripts", "test", "tests", "e2e", "bin"],
  extensions: ["ts", "tsx", "js", "jsx", "mjs", "cjs"],
  exclude: [],
  rules: {
    "no-ts-ignore": true,
    "no-double-cast": true,
    "todo-needs-issue": true,
    "no-eval": true,
    "no-focused-tests": true,
    "max-lines": 300,
  },
  custom: [],
  ratchet: { file: ".railing/floors.json", base: "origin/main" },
  steps: [],
};

/** Reads railing.config.json from `cwd` and fills in anything it leaves out. Throws a plain-words Error when it is damaged. */
export function loadConfig(cwd) {
  const path = join(cwd, CONFIG_FILE);
  if (!existsSync(path)) return { ...DEFAULTS, rules: { ...DEFAULTS.rules }, found: false };
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`${CONFIG_FILE} is not valid JSON (${err.message}).`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${CONFIG_FILE} must be a JSON object.`);
  const config = {
    ...DEFAULTS,
    ...raw,
    rules: { ...DEFAULTS.rules, ...(raw.rules ?? {}) },
    ratchet: { ...DEFAULTS.ratchet, ...(raw.ratchet ?? {}) },
    found: true,
  };
  for (const key of ["include", "extensions", "exclude", "custom", "steps"]) {
    if (!Array.isArray(config[key])) throw new Error(`${CONFIG_FILE}: "${key}" must be a list.`);
  }
  for (const [id, value] of Object.entries(config.rules)) {
    if (id === "max-lines") {
      if (value !== false && !(Number.isInteger(value) && value >= 0)) throw new Error(`${CONFIG_FILE}: rules.max-lines must be a whole number (0 or false turns it off).`);
    } else if (typeof value !== "boolean") {
      throw new Error(`${CONFIG_FILE}: rules.${id} must be true or false, not ${JSON.stringify(value)}.`);
    }
  }
  for (const [i, c] of config.custom.entries()) {
    if (!c || typeof c.name !== "string" || typeof c.pattern !== "string") {
      throw new Error(`${CONFIG_FILE}: custom rule ${i + 1} needs a "name" and a "pattern".`);
    }
    for (const field of ["pattern", "only", "skip"]) {
      if (c[field] === undefined) continue;
      try {
        new RegExp(c[field]);
      } catch {
        throw new Error(`${CONFIG_FILE}: custom rule "${c.name}" has an invalid ${field} expression.`);
      }
    }
  }
  for (const [i, s] of config.steps.entries()) {
    if (!s || typeof s.name !== "string" || typeof s.run !== "string") {
      throw new Error(`${CONFIG_FILE}: step ${i + 1} needs a "name" and a "run" command.`);
    }
  }
  return config;
}

/** Folders the gate never scans, whatever "include" says. Build folders named "build" and "out" count only at the top level. */
const ALWAYS_IGNORED_ANYWHERE = new Set(["node_modules", ".git", "dist", ".next", "coverage", ".railing", ".githooks"]);
const ALWAYS_IGNORED_TOP_LEVEL = new Set(["build", "out"]);

/** True for a project-relative path (with / separators) inside a folder the gate always skips, or Railing's own config file. */
export function isAlwaysIgnored(file) {
  if (file === CONFIG_FILE) return true;
  const parts = file.split("/");
  const dirs = parts.slice(0, -1);
  return dirs.some((d, i) => ALWAYS_IGNORED_ANYWHERE.has(d) || (i === 0 && ALWAYS_IGNORED_TOP_LEVEL.has(d)));
}

/** Does `file` sit under one of the "include" folders? An empty list or "." means the whole project (minus the always-ignored folders). */
export function isIncluded(file, include) {
  if (include.length === 0) return true;
  return include.some((d) => {
    const dir = d.replace(/\/$/, "");
    return dir === "." || dir === "" || file === dir || file.startsWith(`${dir}/`);
  });
}
