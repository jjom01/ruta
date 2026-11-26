// Carga .env.local (clave de Croma, URL del feed GTFS-RT). Debe importarse primero.
const fs = require("fs");
const path = require("path");
try {
  for (const l of fs.readFileSync(path.join(path.join(__dirname, ".."), ".env.local"), "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

