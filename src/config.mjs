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
