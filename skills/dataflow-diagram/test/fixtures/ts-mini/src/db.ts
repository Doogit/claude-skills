import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("data.sqlite");

export function addItem(name: string): void {
  db.prepare("INSERT INTO items (name) VALUES (?)").run(name);
}

export function listItems(): unknown[] {
  return db.prepare("SELECT id, name FROM items ORDER BY id").all();
}

export function logSync(n: number): void {
  db.prepare("INSERT INTO sync_log (count) VALUES (?)").run(n);
}
