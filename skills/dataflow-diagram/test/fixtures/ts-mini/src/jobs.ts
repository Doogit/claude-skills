import { spawn } from "node:child_process";
import { Worker } from "node:worker_threads";
import { addItem, logSync } from "./db";
import { fetchRemote } from "./client";

export function scheduleJob(name: string, ms: number, fn: () => void): NodeJS.Timeout {
  return setInterval(fn, ms);
}

export function startSync(): void {
  scheduleJob("sync.pull", 60_000, async () => {
    const names = await fetchRemote();
    for (const name of names) addItem(name);
    logSync(names.length);
  });
}

function heartbeat(): void {}
setInterval(heartbeat, 5_000);

export const bootTimer = setTimeout(startSync, 3_000);

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function runReport(): Promise<string> {
  return new Promise((resolve) => {
    const child = spawnFn(`node report.js --fast`);
    const killTimer = setTimeout(() => child.kill(), 30_000);
    child.on("exit", () => {
      clearTimeout(killTimer);
      resolve("done");
    });
  });
}

const spawnFn = (cmd: string) => spawn(cmd, { shell: true });

export function hashInWorker(): Worker {
  return new Worker(
    new URL("./hash-worker.js", import.meta.url),
  );
}

class Runner {
  exec(from: string): boolean {
    return /^v\d+/.exec(from) !== null;
  }
}
