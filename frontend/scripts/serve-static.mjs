import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = normalize(process.env.DIST_DIR || join(process.cwd(), "dist"));

// Optional same-origin API proxy for local development: when API_PROXY_TARGET
// is set (e.g. http://127.0.0.1:8000), any /api/* request is forwarded to the
// backend. Unset in production, so behaviour there is unchanged.
const API_PROXY_TARGET = (process.env.API_PROXY_TARGET || "").trim().replace(/\/+$/, "");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

async function send(res, code, body, type) {
  res.writeHead(code, {
    "Content-Type": type || "text/plain; charset=utf-8",
    "Cache-Control": code === 200 ? "public, max-age=0, must-revalidate" : "no-store",
  });
  res.end(body);
}

function proxyToBackend(req, res, parsedUrl) {
  const target = new URL(API_PROXY_TARGET);
  const headers = { ...req.headers, host: target.host };
  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: req.method,
      headers,
    },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);
    }
  );
  upstream.on("error", () => send(res, 502, "Bad Gateway"));
  req.pipe(upstream);
}

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url || "/", "http://localhost");
    let pathname = decodeURIComponent(parsedUrl.pathname);
    if (API_PROXY_TARGET && pathname.startsWith("/api")) {
      return proxyToBackend(req, res, parsedUrl);
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, "Method Not Allowed");
    }
    if (pathname.indexOf("\0") !== -1) return send(res, 400, "Bad Request");
    if (pathname.endsWith("/")) pathname += "index.html";

    let filePath = normalize(join(ROOT, pathname));
    if (!filePath.startsWith(ROOT)) return send(res, 403, "Forbidden");

    let candidate = filePath;
    try {
      const meta = await stat(candidate);
      if (meta.isDirectory()) candidate = join(candidate, "index.html");
    } catch {
      candidate = join(filePath, "index.html");
    }

    const body = await readFile(candidate);
    const type = MIME[extname(candidate).toLowerCase()] || "application/octet-stream";
    return send(res, 200, body, type);
  } catch {
    return send(res, 404, "Not Found");
  }
});

const PORT = Number(process.env.PORT) || 3444;
server.listen(PORT, () => {
  console.log(`static-export server: serving ${ROOT} on http://0.0.0.0:${PORT}`);
  if (API_PROXY_TARGET) console.log(`static-export server: proxying /api/* -> ${API_PROXY_TARGET}`);
});