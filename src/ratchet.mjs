import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The ratchet: numbers that may only get stricter. The file holds `floors` (must not go down, e.g. coverage) and
 * `ceilings` (must not go up, e.g. allowed warnings). The current file is compared with the one on the base branch,
 * so loosening a number takes a visible change that fails here, not a quiet edit.
 */
function parse(text, where) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${where} is not valid JSON.`);
  }
  const clean = (group) => {
    const out = {};
    for (const [k, v] of Object.entries(data?.[group] ?? {})) {
      if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${where}: ${group}.${k} must be a number.`);
      out[k] = v;
    }
    return out;
  };
  return { floors: clean("floors"), ceilings: clean("ceilings") };
}

/** The file as it is on the base branch. `./` makes git resolve it from the working folder, not the repo root. */
function gitShow(cwd, base, file) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${base}^{commit}`], { cwd, stdio: "ignore" });
  } catch {
    return { state: "no-base" };
  }
  try {
    return { state: "ok", text: execFileSync("git", ["show", `${base}:./${file}`], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (err) {
    // Only "that path is not on the base" means the file is new; any other git trouble must not read as a pass.
    if (/does not exist in|exists on disk, but not in/.test(String(err.stderr))) return { state: "new-file" };
    return { state: "error", message: String(err.stderr || err.message).trim().split("\n")[0] };
  }
}

/** Returns { status: "ok" | "skipped", notes: [], failures: [] }. `strict` turns a missing base into a failure. */
export function checkRatchet(cwd, config, { strict = false } = {}) {
  const file = config.ratchet.file;
  const before = gitShow(cwd, config.ratchet.base, file);
  const present = existsSync(join(cwd, file));
  // Deleting the file must not be a way round the ratchet: if the base has it, it has to stay.
  if (before.state === "ok" && !present) return { status: "ok", notes: [], failures: [`${file} was deleted (it exists on ${config.ratchet.base})`] };
  if (!present) return { status: "skipped", notes: [`no ${file}: nothing to hold`], failures: [] };
  const now = parse(readFileSync(join(cwd, file), "utf8"), file);
  if (before.state === "error") return { status: "skipped", notes: [], failures: [`could not read ${file} from ${config.ratchet.base}: ${before.message}`] };
  if (before.state === "no-base") {
    const msg = `base "${config.ratchet.base}" not found (in CI, fetch full history or set ratchet.base)`;
    return strict ? { status: "skipped", notes: [], failures: [msg] } : { status: "skipped", notes: [`${msg}; skipped`], failures: [] };
  }
  if (before.state === "new-file") return { status: "ok", notes: [`${file} is new on this branch`], failures: [] };
  const base = parse(before.text, `${file} on ${config.ratchet.base}`);
  const failures = [];
  for (const [k, v] of Object.entries(base.floors)) {
    if (!(k in now.floors)) failures.push(`floor "${k}" was removed (it was ${v})`);
    else if (now.floors[k] < v) failures.push(`floor "${k}" went down: ${v} to ${now.floors[k]}`);
  }
  for (const [k, v] of Object.entries(base.ceilings)) {
    if (!(k in now.ceilings)) failures.push(`ceiling "${k}" was removed (it was ${v})`);
    else if (now.ceilings[k] > v) failures.push(`ceiling "${k}" went up: ${v} to ${now.ceilings[k]}`);
  }
  return { status: "ok", notes: [], failures };
}
