import http from "node:http";
import { listItems, addItem } from "./db";
import { startSync } from "./jobs";

export function handle(req: http.IncomingMessage, res: http.ServerResponse): void {
  const method = req.method;
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  if (method === "GET" && pathname === "/api/items") {
    res.end(JSON.stringify(listItems()));
    return;
  }
  if (method === "POST" && pathname === "/api/items") {
    addItem("manual");
    res.end("{}");
    return;
  }
  res.statusCode = 404;
  res.end();
}

const server = http.createServer(handle);
server.listen(3000, "127.0.0.1");
startSync();
