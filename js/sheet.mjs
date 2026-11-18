import { aoaFromDataset, datasetFromRows } from "./dataset.mjs";

function xlsx() {
  const lib = globalThis.XLSX;
  if (!lib) throw new Error("Falta la librería de Excel.");
  return lib;
}

export function rowsFromSheet(sheet) {
  const XLSX = xlsx();
  if (!sheet?.["!ref"]) return [];
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const lastCol = Math.max(range.e.c, 6);
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const row = new Array(lastCol + 1).fill(null);
    let any = false;
    for (let c = range.s.c; c <= lastCol; c += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (!cell || cell.v == null || cell.v === "") continue;
      any = true;
      row[c] = { v: cell.v, f: cell.f || null, t: cell.t || null };
    }
    rows.push(any ? row : []);
  }
  return rows;
}

export function datasetFromWorkbook(workbook, options) {
  const preferred = workbook.SheetNames.find((name) => name.trim().toLowerCase() === "gastos fijos mensuales");
  const name = preferred || workbook.SheetNames[0];
  if (!name) throw new Error("El Excel no tiene hojas.");
  return datasetFromRows(rowsFromSheet(workbook.Sheets[name]), options);
}

export function readWorkbook(buffer) {
  const XLSX = xlsx();
  const data = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  return XLSX.read(data, { type: "array", cellFormula: true });
}

export function datasetFromBuffer(buffer, options) {
  return datasetFromWorkbook(readWorkbook(buffer), options);
}

export function buildWorkbook(dataset, today) {
  const XLSX = xlsx();
  const sheet = XLSX.utils.aoa_to_sheet(aoaFromDataset(dataset, today));
  sheet["!cols"] = [
    { wch: 28 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Gastos Fijos mensuales");
  return workbook;
}

export function downloadWorkbook(dataset, today) {
  xlsx().writeFile(buildWorkbook(dataset, today), "Gastos.xlsx");
}
