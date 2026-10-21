import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "railing.mjs");

/** A throwaway git project with the given files. */
export function project(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "railing-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "commit.gpgsign", "false");
  put(dir, files);
  return dir;
}

export function put(dir, files) {
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
}

export const git = (dir, ...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });

export function commit(dir, message = "c") {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
}

/** Runs the CLI in a project. Returns { code, out, err }. */
export function railing(dir, args, input) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: dir, encoding: "utf8", input });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
