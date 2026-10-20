import { execFileSync } from "node:child_process";

export async function fetchRemote(): Promise<string[]> {
  if (!process.env.EXAMPLE_API_KEY) return [];
  const res = await fetch("https://api.example.com/v1/items");
  return (await res.json()) as string[];
}

export function headSha(): string {
  return execFileSync("git", ["rev-parse", "HEAD"]).toString().trim();
}
