import { webcrypto } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.XLSX = require(path.join(root, "vendor/xlsx.full.min.js"));

const { decryptWithKey, sealDataset } = await import("../js/crypto.mjs");
const { normalizeDataset } = await import("../js/dataset.mjs");
const { datasetFromBuffer } = await import("../js/sheet.mjs");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const input = process.argv[2];
const output = path.resolve(process.argv[3] || path.join(root, "data/gastos.enc"));
const password = process.env.GASTOS_PASSWORD;

if (!input) {
  fail("Uso: GASTOS_PASSWORD='…' node scripts/encrypt.mjs <archivo.xlsx|archivo.json> [salida]");
}
if (typeof password !== "string" || password.length === 0) {
  fail("Define la contraseña en la variable de entorno GASTOS_PASSWORD. No se lee por argumentos.");
}

let dataset;
try {
  const ext = path.extname(input).toLowerCase();
  if (ext === ".json") {
    const raw = JSON.parse(fs.readFileSync(input, "utf8"));
    if (raw && raw.ciphertext && !raw.groups) {
      fail("El JSON ya está cifrado. Hace falta el dataset en claro, con groups.");
    }
    dataset = normalizeDataset(raw);
  } else {
    dataset = datasetFromBuffer(fs.readFileSync(input));
  }
} catch (error) {
  fail(`No se ha podido leer el origen: ${error.message}`);
}

if (!dataset.groups.length) {
  fail("El origen no contiene grupos de gastos.");
}

let envelope;
let key;
try {
  const sealed = await sealDataset(password, dataset);
  const check = await decryptWithKey(sealed.key, sealed.envelope);
  if (!Array.isArray(check.groups) || check.groups.length !== dataset.groups.length) {
    fail("La comprobación del cifrado no ha devuelto los mismos grupos.");
  }
  envelope = sealed.envelope;
  key = sealed.key;
} catch (error) {
  fail(`No se ha podido cifrar: ${error.message}`);
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
key = null;
process.stdout.write(`Escrito ${path.relative(root, output) || output} (${envelope.iterations} iteraciones PBKDF2-SHA256, AES-GCM 256).\n`);
