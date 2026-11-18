import { webcrypto } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.XLSX = require(path.join(root, "vendor/xlsx.full.min.js"));

const { formatEuro, cents } = await import("../js/format.mjs");
const { ITERATIONS, openEnvelope, sealDataset } = await import("../js/crypto.mjs");
const {
  aoaFromDataset,
  collectWarnings,
  datasetFromRows,
  summarize,
} = await import("../js/dataset.mjs");
const { datasetFromWorkbook, readWorkbook, buildWorkbook } = await import("../js/sheet.mjs");

const failures = [];
function check(cond, message) {
  if (!cond) failures.push(message);
}

check(formatEuro(1037.3) === "1.037,30 €", "formato de miles");
check(formatEuro(12.5) === "12,50 €", "formato simple");
check(formatEuro(0) === "0,00 €", "cero");

const rows = [
  [
    { v: "Servicio" },
    { v: "Coste / mes" },
    { v: "Coste / año" },
    { v: "Total / mes" },
    { v: "Alta" },
    { v: "Baja" },
  ],
  [{ v: "Casa" }, null, null, null, null, null],
  [
    { v: "Agua" },
    { v: 10, f: null },
    { v: 120, f: "B3*12" },
    { v: 99 },
    { v: "2024-01-02" },
    null,
  ],
  [
    { v: "Luz" },
    { v: 8 },
    { v: 100 },
    null,
    null,
    null,
  ],
  [{ v: "Archivo" }, null, null, null, null, null],
  [
    { v: "Cuota" },
    { v: 0 },
    { v: 0, f: "B6*12" },
    null,
    null,
    { v: "2020-01-01" },
  ],
  [{ v: "Taller" }, null, null, null, null, null],
  [
    { v: "Cuota" },
    { v: 5.833333333, f: "C8/12" },
    { v: 70 },
    null,
    null,
    null,
  ],
  [{ v: "Vacío" }, null, null, null, null, null],
  [{ v: "Total" }, { v: 1 }, null, null, null, null],
  [{ v: "Total Año" }, { v: 2 }, null, null, null, null],
];

const dataset = datasetFromRows(rows, { updatedAt: "2024-01-01T00:00:00.000Z" });
check(dataset.groups.length === 4, "grupos sintéticos");
check(dataset.groups[0].items.length === 2, "líneas del primer grupo");
check(dataset.groups[0].declaredSubtotal === 99, "subtotal que no cuadra");
check(dataset.groups[1].items[0].basis === "monthly", "base mensual");
check(dataset.groups[2].items[0].basis === "yearly", "base anual");
check(Math.abs(dataset.groups[2].items[0].monthly * 12 - 70) < 0.001, "anual reparte a 12 meses");
check(dataset.groups[0].items[1].basis === "both", "mensual y anual distintos");
check(dataset.groups[3].items.length === 0, "grupo vacío");

const today = "2026-11-18";
const warnings = collectWarnings(dataset, today);
const codes = warnings.map((warning) => warning.code).sort();
for (const code of ["duplicate", "empty-group", "ended", "mismatch", "stale", "subtotal", "zero", "grand-total"]) {
  check(codes.includes(code), `aviso ${code}`);
}
const summary = summarize(dataset, today);
check(dataset.groups[0].items.every((item) => item.owner === "daniel"), "sin titular, el dueño es Daniel");
check(cents(summary.people.lourdes) === 0, "sin titular, Lourdes no suma");
check(cents(summary.people.daniel) === cents(summary.monthly), "la parte de Daniel es el total");
check(cents(summary.monthly) === cents(10 + 8 + 70 / 12), "la baja no entra en el total");
check(formatEuro(summary.yearlySheet) === formatEuro(summary.monthly * 12), "total año = total mes × 12");

const aoa = aoaFromDataset(dataset, today);
check(aoa[0][0] === "Servicio" && aoa[0][3] === "Total / mes", "cabecera de exportación");
check(aoa.some((row) => row[0] === "Total") && aoa.some((row) => row[0] === "Total Año"), "filas de total");
const endedRow = aoa.find((row) => row[0] === "Cuota" && row[5] === "2020-01-01");
check(endedRow, "la baja viaja en la columna Baja");

const workbook = buildWorkbook(dataset, today);
const again = datasetFromWorkbook(readWorkbook(globalThis.XLSX.write(workbook, { type: "array", bookType: "xlsx" })), {
  updatedAt: "2024-01-01T00:00:00.000Z",
});
const againSummary = summarize(again, today);
check(cents(againSummary.monthly) === cents(summary.monthly), "el Excel de ida y vuelta conserva el total");
check(again.groups[0].items.some((item) => item.basis === "both"), "el descuadre mensual/anual sobrevive al Excel");
check(again.groups.flatMap((group) => group.items).every((item) => item.owner === "daniel"), "la ida y vuelta sin titular sigue en Daniel");

const ownedRows = [
  [{ v: "Servicio" }, { v: "Coste / mes" }, { v: "Coste / año" }, { v: "Titular" }, { v: "Reparto" }],
  [{ v: "Casa" }],
  [{ v: "Alquiler" }, { v: 100 }, { v: 1200 }, { v: "Compartido" }, { v: "60%" }],
  [{ v: "Luz" }, { v: 40 }, { v: 480 }, { v: "Lourdes" }, null],
  [{ v: "Seguro" }, { v: 10 }, { v: 120 }, { v: "Daniel" }, null],
];
const owned = datasetFromRows(ownedRows, { updatedAt: "2024-06-01T00:00:00.000Z" });
const ownedSummary = summarize(owned, today);
check(owned.groups[0].items[0].owner === "shared" && owned.groups[0].items[0].split === 60, "reparto compartido");
check(owned.groups[0].items[1].owner === "lourdes", "titular Lourdes");
check(owned.groups[0].items[2].owner === "daniel", "titular Daniel");
check(cents(ownedSummary.people.daniel) === cents(60 + 10), "parte mensual de Daniel");
check(cents(ownedSummary.people.lourdes) === cents(40 + 40), "parte mensual de Lourdes");
owned.budgets = { daniel: 50, lourdes: 200 };
const ownedWarnings = collectWarnings(owned, today).map((warning) => warning.code);
check(ownedWarnings.includes("budget"), "aviso de presupuesto");
const ownedAgain = datasetFromWorkbook(readWorkbook(globalThis.XLSX.write(buildWorkbook(owned, today), { type: "array", bookType: "xlsx" })));
const back = ownedAgain.groups[0].items;
check(back.find((item) => item.name === "Alquiler")?.owner === "shared" && back.find((item) => item.name === "Alquiler")?.split === 60, "el Excel conserva el reparto");
check(back.find((item) => item.name === "Luz")?.owner === "lourdes", "el Excel conserva a Lourdes");

const secret = "self-check-only";
const sealed = await sealDataset(secret, { version: 1, updatedAt: "2024-01-01T00:00:00.000Z", reviewedAt: null, groups: [{ id: "g", name: "Prueba", items: [] }] });
check(sealed.envelope.iterations >= ITERATIONS, "iteraciones");
check(sealed.envelope.kdf === "PBKDF2-SHA256" && sealed.envelope.cipher === "AES-GCM", "algoritmos");
const opened = await openEnvelope(secret, sealed.envelope);
check(opened.data.groups[0].name === "Prueba", "descifrado");
let rejected = false;
try {
  await openEnvelope("otra", sealed.envelope);
} catch {
  rejected = true;
}
check(rejected, "contraseña incorrecta");
const raw = JSON.stringify(sealed.envelope);
check(!raw.includes("Prueba"), "el sobre no contiene el nombre en claro");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gastos-check-"));
const jsonPath = path.join(dir, "claro.json");
const outPath = path.join(dir, "gastos.enc");
fs.writeFileSync(jsonPath, JSON.stringify({
  version: 1,
  updatedAt: "2024-05-01T00:00:00.000Z",
  reviewedAt: "2024-05-01",
  groups: [{ id: "1", name: "Taller", items: [{ id: "2", name: "Pieza", basis: "monthly", monthly: 3, yearly: 36, startDate: null, endDate: null, updatedAt: null }] }],
}));
const run = spawnSync(process.execPath, [path.join(root, "scripts/encrypt.mjs"), jsonPath, outPath], {
  env: { ...process.env, GASTOS_PASSWORD: secret },
  encoding: "utf8",
});
check(run.status === 0, `encrypt.mjs status ${run.status} ${run.stderr}`);
const written = JSON.parse(fs.readFileSync(outPath, "utf8"));
check(!fs.readFileSync(outPath, "utf8").includes("Pieza"), "el archivo escrito no lleva el nombre");
const fromFile = await openEnvelope(secret, written);
check(fromFile.data.groups[0].items[0].monthly === 3, "encrypt.mjs conserva el importe");
const missing = spawnSync(process.execPath, [path.join(root, "scripts/encrypt.mjs"), jsonPath, outPath], {
  env: { ...process.env, GASTOS_PASSWORD: "" },
  encoding: "utf8",
});
check(missing.status === 1, "sin contraseña no escribe");
fs.rmSync(dir, { recursive: true, force: true });

if (failures.length) {
  process.stderr.write(failures.join("\n") + "\n");
  process.exit(1);
}
process.stdout.write("self-check ok\n");
