// Lokalny server testovacieho rezimu PDA pre firemnu Wi-Fi (test skenera na Zebre).
//
//   npm run pda:lan          -> vypise adresu, napr. http://192.168.x.y:4190/?pda=test&skener=1
//
// Bezpecnost:
//   * build s FALOSNOU adresou Supabase (127.0.0.1:9) - pred spustenim sa overi,
//     ze v builde nie je adresa produkcneho projektu (z .env.local), inak koniec,
//   * obsluhuje len staticky build + POST /__pda-diag (vysledky "Testu skenera"),
//   * prijima len poziadavky z privatnych adries (firemna siet), max. 64 kB,
//   * vysledky skenov uklada do pda-podklady/sken-log.jsonl (mimo gitu).

import { build } from "vite";
import http from "node:http";
import os from "node:os";
import { readFileSync, existsSync, readdirSync, appendFileSync, mkdirSync, statSync } from "node:fs";
import { join, resolve, extname, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = join(tmpdir(), "stenger-pda-lan");
const LOG_DIR = join(ROOT, "pda-podklady");
const LOG = join(LOG_DIR, "sken-log.jsonl");
const PORT = Number(process.env.PORT || 4190);
// HOST=127.0.0.1 = len tento PC (test bez Zebry), predvolene cela firemna siet.
const HOST = process.env.HOST || "0.0.0.0";

// Adresa produkcneho Supabase (len na kontrolu, ze sa do buildu NEDOSTALA).
function produkcnySupabaseHost() {
  for (const f of [".env.local", ".env"]) {
    const p = join(ROOT, f);
    if (!existsSync(p)) continue;
    const m = readFileSync(p, "utf8").match(/^VITE_SUPABASE_URL\s*=\s*(.+)$/m);
    if (m) {
      try { return new URL(m[1].trim().replace(/^["']|["']$/g, "")).host; } catch (e) {}
    }
  }
  return null;
}

process.env.GH_PAGES = "false";
process.env.VITE_SUPABASE_URL = "http://127.0.0.1:9";
process.env.VITE_SUPABASE_ANON_KEY = "lokalny-test-bez-pristupu";

console.log("Build testovacej verzie (falošný Supabase)…");
await build({ root: ROOT, logLevel: "error", base: "/", build: { outDir: DIST, emptyOutDir: true } });

const prodHost = produkcnySupabaseHost();
const assets = readdirSync(join(DIST, "assets")).filter((f) => f.endsWith(".js"));
const unik = prodHost && assets.find((f) => readFileSync(join(DIST, "assets", f), "utf8").includes(prodHost));
if (unik) {
  console.error(`STOP: build obsahuje produkčný Supabase (${prodHost}) v ${unik}. Server sa nespustí.`);
  process.exit(1);
}
console.log(`Kontrola: build neobsahuje produkčný Supabase${prodHost ? ` (${prodHost})` : ""} ✓`);

const INDEX = readFileSync(join(DIST, "index.html"), "utf8").replace("<head>", "<head><script>window.__PDA_LAN_DIAG__=true</script>");
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon", ".woff2": "font/woff2", ".pdf": "application/pdf", ".docx": "application/octet-stream", ".xlsx": "application/octet-stream" };

function privatna(addr) {
  const a = String(addr || "").replace(/^::ffff:/, "");
  return a === "::1" || /^127\./.test(a) || /^10\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a) || /^fe80:/i.test(a);
}

function vypisSken(z) {
  const p = z.parsed || {};
  const konec = z.meta ? z.meta.ukoncenie : "?";
  console.log(`\n[${new Date().toLocaleTimeString()}] ${String(z.stitek || "").toUpperCase()} kód · ${String(z.raw || "").length} znakov · koniec: ${konec} · Chrome ${z.chrome}`);
  console.log("   " + z.viditelne);
  for (const e of p.elements || []) console.log(`   (${e.ai}) ${e.value}${e.date ? "  = " + e.date : ""}`);
  for (const e of p.errors || []) console.log("   ✗ " + e);
}

const server = http.createServer((req, res) => {
  if (!privatna(req.socket.remoteAddress)) {
    res.writeHead(403).end();
    return;
  }
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/__pda-diag" && req.method === "POST") {
    let body = "";
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 64 * 1024) req.destroy();
      else body += c;
    });
    req.on("end", () => {
      try {
        const z = JSON.parse(body);
        mkdirSync(LOG_DIR, { recursive: true });
        appendFileSync(LOG, JSON.stringify({ prijate: new Date().toISOString(), od: req.socket.remoteAddress, ...z }) + "\n");
        vypisSken(z);
        res.writeHead(204).end();
      } catch (e) {
        res.writeHead(400).end();
      }
    });
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  const file = resolve(DIST, "." + decodeURIComponent(url.pathname));
  if (file.startsWith(DIST + sep) && existsSync(file) && statSync(file).isFile() && !file.endsWith("index.html")) {
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(readFileSync(file));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(INDEX);
});

server.listen(PORT, HOST, () => {
  const ips = HOST === "0.0.0.0" ? Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address) : [HOST];
  console.log(`\nServer beží (len testovací režim, bez Supabase). Výsledky skenov: ${LOG}`);
  console.log("Na Zebre otvorte v Chrome:");
  for (const ip of ips) console.log(`   http://${ip}:${PORT}/?pda=test&skener=1`);
  console.log("\nUkončenie: Ctrl+C");
});
