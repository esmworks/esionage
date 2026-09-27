/**
 * Single-process server: Next.js for HTTP, Hocuspocus for realtime collaboration on /collab.
 * Keeping both in one process lets route handlers (MCP, server actions) write into open
 * documents through the collab service instead of racing the websocket clients.
 */
import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import crossws from "crossws/adapters/node";
import next from "next";
import { CLIENT_IP_HEADER, clientIpFrom, trustedProxyCount } from "./src/lib/client-ip";

try {
  process.loadEnvFile();
} catch {}

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? "0.0.0.0";

// Imported after env is loaded: these modules read DATABASE_URL at import time.
const { createCollab } = await import("./src/server/collab/service");
const { registerCollab } = await import("./src/server/collab/bridge");
const { describeMailSetup } = await import("./src/server/mail");
const { startAssignmentEmails } = await import("./src/server/assignments");
const { startShareEmails } = await import("./src/server/share-emails");

const { hocuspocus, service } = createCollab();
registerCollab(service);

const app = next({ dev, hostname, port });
await app.prepare();
const handleRequest = app.getRequestHandler();
const handleNextUpgrade = app.getUpgradeHandler();

const ws = crossws({
  hooks: {
    open(peer) {
      (peer as any)._hp = hocuspocus.handleConnection(peer.websocket as any, peer.request as Request);
    },
    message(peer, message) {
      (peer as any)._hp?.handleMessage(message.uint8Array());
    },
    close(peer, event) {
      (peer as any)._hp?.handleClose({ code: event.code, reason: event.reason });
    },
    error(peer, error) {
      console.error("collab websocket error", peer.id, error);
    },
  },
});

const trustedProxies = trustedProxyCount();

const server = createServer((req, res) => {
  // Overwrites whatever the client sent under this name.
  req.headers[CLIENT_IP_HEADER] = clientIpFrom(req.headers["x-forwarded-for"], req.socket.remoteAddress, trustedProxies);
  handleRequest(req, res).catch((error) => {
    console.error(error);
    res.statusCode = 500;
    res.end("Internal Server Error");
  });
});

server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  if (pathname === "/collab") {
    ws.handleUpgrade(req, socket, head);
  } else {
    // Next dev (HMR) websockets.
    handleNextUpgrade(req, socket, head);
  }
});

server.listen(port, hostname, () => {
  console.log(`esionage ready on http://localhost:${port} (${dev ? "dev" : "production"})`);
  console.log(describeMailSetup());
  startAssignmentEmails();
  startShareEmails();
});

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Persist debounced documents before exiting.
    hocuspocus.flushPendingStores();
    await new Promise((r) => setTimeout(r, 500));
    server.close();
    process.exit(0);
  });
}
