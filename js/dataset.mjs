import {
  cents,
  coerceDate,
  fold,
  formatDate,
  formatEuro,
  isOlderThanMonths,
  uid,
} from "./format.mjs";

function cellText(cell) {
  if (!cell || cell.v == null) return "";
  return String(cell.v).replace(/\s+/g, " ").trim();
}

function cellNumber(cell) {
  if (!cell || cell.v == null || cell.v === "") return null;
  if (typeof cell.v === "number" && Number.isFinite(cell.v)) return cell.v;
  const parsed = Number(String(cell.v).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function rowKind(label) {
  const name = fold(label);
  if (name === "total/mes" || name === "total mes") return "group-total";
  if (name === "total ano" || name === "total anual" || name === "total/ano") return "grand-year";
  if (name === "total") return "grand";
  return "label";
}

function itemFromCells({ name, monthly, yearly, monthCell, yearCell }) {
  const monthFormula = Boolean(monthCell?.f);
  const yearFormula = Boolean(yearCell?.f);
  let basis;
  let month;
  let year;
  if (monthly != null && yearly != null && monthFormula && !yearFormula) {
    basis = "yearly";
    month = monthly;
    year = yearly;
  } else if (monthly != null && yearly != null && yearFormula && !monthFormula) {
    basis = "monthly";
    month = monthly;
    year = yearly;
  } else if (monthly != null && yearly != null) {
    basis = Math.abs(cents(monthly * 12) - cents(yearly)) > 1 ? "both" : "monthly";
    month = monthly;
    year = yearly;
  } else if (monthly != null) {
    basis = "monthly";
    month = monthly;
    year = monthly * 12;
  } else {
    basis = "yearly";
    year = yearly;
    month = yearly / 12;
  }
  return {
    id: uid(),
    name,
    basis,
    monthly: month,
    yearly: year,
    startDate: null,
    endDate: null,
    updatedAt: null,
  };
}

export function isActive(item, today) {
  return !(item.endDate && item.endDate <= today);
}

export function datasetFromRows(rows, options = {}) {
  const col = { name: 0, month: 1, year: 2, sub: 3, start: -1, end: -1, updated: -1 };
  let headerIndex = -1;
  const scan = Math.min(rows.length, 40);
  for (let r = 0; r < scan; r += 1) {
    const row = rows[r] || [];
    const found = { name: -1, month: -1, year: -1, sub: -1, start: -1, end: -1, updated: -1 };
    for (let c = 0; c < row.length; c += 1) {
      const text = fold(cellText(row[c]));
      if (!text) continue;
      if (text === "servicio" || text === "nombre" || text === "concepto") found.name = c;
      else if (text === "coste/mes" || text === "coste mes" || text === "mensual" || text === "mes") found.month = c;
      else if (text === "coste/ano" || text === "coste ano" || text === "anual" || text === "ano") found.year = c;
      else if (text === "total/mes" || text === "total mes") found.sub = c;
      else if (text === "alta" || text === "fecha alta" || text === "inicio") found.start = c;
      else if (text === "baja" || text === "fecha baja" || text === "fin") found.end = c;
      else if (text === "ultimo cambio" || text === "cambio" || text === "actualizado") found.updated = c;
    }
    if (found.name !== -1 && (found.month !== -1 || found.year !== -1)) {
      headerIndex = r;
      Object.assign(col, found);
      break;
    }
  }

  const groups = [];
  let current = null;
  let declaredMonthly = null;
  let declaredYearly = null;
  const startRow = headerIndex >= 0 ? headerIndex + 1 : 0;

  for (let r = startRow; r < rows.length; r += 1) {
    const row = rows[r] || [];
    const name = cellText(row[col.name]);
    const monthCell = row[col.month] || null;
    const yearCell = row[col.year] || null;
    const subCell = col.sub >= 0 ? row[col.sub] || null : null;
    const monthly = cellNumber(monthCell);
    const yearly = cellNumber(yearCell);
    const sub = cellNumber(subCell);
    if (!name && monthly == null && yearly == null && sub == null) continue;

    const kind = name ? rowKind(name) : "label";
    if (kind === "group-total") {
      if (current) current.seenSubtotal = monthly ?? sub;
      continue;
    }
    if (kind === "grand") {
      if (monthly != null) declaredMonthly = monthly;
      continue;
    }
    if (kind === "grand-year") {
      declaredYearly = monthly ?? yearly;
      continue;
    }
    if (name && fold(name) === "servicio") continue;

    const isItem = monthly != null || yearly != null;
    if (!isItem) {
      current = { id: uid(), name: name || "Sin grupo", items: [], seenSubtotal: sub };
      groups.push(current);
      continue;
    }

    if (!current) {
      current = { id: uid(), name: "Sin grupo", items: [], seenSubtotal: null };
      groups.push(current);
    }
    if (sub != null && current.seenSubtotal == null) current.seenSubtotal = sub;
    const item = itemFromCells({ name, monthly, yearly, monthCell, yearCell });
    if (col.start >= 0) item.startDate = coerceDate(row[col.start]?.v);
    if (col.end >= 0) item.endDate = coerceDate(row[col.end]?.v);
    if (col.updated >= 0) {
      const raw = row[col.updated]?.v;
      item.updatedAt = typeof raw === "string" && raw.includes("T") ? raw : coerceDate(raw);
    }
    current.items.push(item);
  }

  const dataset = {
    version: 1,
    updatedAt: options.updatedAt || new Date().toISOString(),
    reviewedAt: null,
    groups: groups.map((group) => {
      const lineSum = group.items.reduce((sum, item) => sum + item.monthly, 0);
      const next = { id: group.id, name: group.name, items: group.items };
      if (group.seenSubtotal != null && Math.abs(cents(group.seenSubtotal) - cents(lineSum)) >= 1) {
        next.declaredSubtotal = group.seenSubtotal;
      }
      return next;
    }),
  };

  const allMonthly = dataset.groups.reduce(
    (sum, group) => sum + group.items.reduce((inner, item) => inner + item.monthly, 0),
    0,
  );
  if (declaredMonthly != null && Math.abs(cents(declaredMonthly) - cents(allMonthly)) >= 1) {
    dataset.declaredMonthlyTotal = declaredMonthly;
  }
  if (declaredYearly != null && Math.abs(cents(declaredYearly) - cents(allMonthly * 12)) >= 1) {
    dataset.declaredYearlyTotal = declaredYearly;
  }
  return dataset;
}

function moneyCell(value, formula) {
  const cell = { t: "n", v: value, z: "#,##0.00" };
  if (formula) cell.f = formula;
  return cell;
}

function sumFormula(refs) {
  if (!refs.length) return null;
  const groups = [];
  let start = null;
  let prev = null;
  const flush = () => {
    if (start == null) return;
    groups.push(start === prev ? start : `${start}:${prev}`);
  };
  refs.forEach((ref) => {
    const row = Number(ref.slice(1));
    if (prev != null && row === prev + 1) {
      prev = row;
      return;
    }
    flush();
    start = ref;
    prev = row;
  });
  flush();
  return `SUM(${groups.join(",")})`;
}

export function aoaFromDataset(dataset, today) {
  const lines = [[
    "Servicio",
    "Coste / mes",
    "Coste / año",
    "Total / mes",
    "Alta",
    "Baja",
    "Último cambio",
  ]];
  const activeRefs = [];

  dataset.groups.forEach((group) => {
    lines.push([group.name, null, null, null, null, null, null]);
    const ownRefs = [];
    let firstExcel = null;
    let lastExcel = null;
    group.items.forEach((item) => {
      const excelRow = lines.length + 1;
      if (firstExcel == null) firstExcel = excelRow;
      lastExcel = excelRow;
      let monthCell;
      let yearCell;
      if (item.basis === "yearly") {
        monthCell = moneyCell(item.monthly, `C${excelRow}/12`);
        yearCell = moneyCell(item.yearly);
      } else if (item.basis === "both") {
        monthCell = moneyCell(item.monthly);
        yearCell = moneyCell(item.yearly);
      } else {
        monthCell = moneyCell(item.monthly);
        yearCell = moneyCell(item.yearly, `B${excelRow}*12`);
      }
      const updated = item.updatedAt ? String(item.updatedAt).slice(0, 10) : null;
      lines.push([
        item.name,
        monthCell,
        yearCell,
        null,
        item.startDate || null,
        item.endDate || null,
        updated,
      ]);
      if (isActive(item, today)) {
        ownRefs.push(`B${excelRow}`);
        activeRefs.push(`B${excelRow}`);
      }
    });
    if (firstExcel != null && ownRefs.length) {
      const subtotal = group.items
        .filter((item) => isActive(item, today))
        .reduce((sum, item) => sum + Number(item.monthly || 0), 0);
      lines[firstExcel - 1][3] = moneyCell(subtotal, sumFormula(ownRefs));
    }
  });

  lines.push([null, null, null, null, null, null, null]);
  const monthly = dataset.groups.reduce(
    (sum, group) => sum + group.items.filter((item) => isActive(item, today)).reduce((inner, item) => inner + Number(item.monthly || 0), 0),
    0,
  );
  const totalExcel = lines.length + 1;
  lines.push([
    "Total",
    activeRefs.length ? moneyCell(monthly, sumFormula(activeRefs)) : moneyCell(0),
    null,
    null,
    null,
    null,
    null,
  ]);
  lines.push([
    "Total Año",
    moneyCell(monthly * 12, `B${totalExcel}*12`),
    null,
    null,
    null,
    null,
    null,
  ]);
  return lines;
}

export function summarize(dataset, today) {
  const groups = dataset.groups.map((group) => {
    const active = group.items.filter((item) => isActive(item, today));
    return {
      id: group.id,
      name: group.name,
      monthly: active.reduce((sum, item) => sum + Number(item.monthly || 0), 0),
      yearly: active.reduce((sum, item) => sum + Number(item.yearly || 0), 0),
      activeCount: active.length,
      itemCount: group.items.length,
    };
  });
  const monthly = groups.reduce((sum, group) => sum + group.monthly, 0);
  return {
    monthly,
    yearlySheet: monthly * 12,
    yearlyItems: groups.reduce((sum, group) => sum + group.yearly, 0),
    groups,
    activeCount: groups.reduce((sum, group) => sum + group.activeCount, 0),
    itemCount: groups.reduce((sum, group) => sum + group.itemCount, 0),
  };
}

export function collectWarnings(dataset, today) {
  const warnings = [];
  const byName = new Map();

  dataset.groups.forEach((group) => {
    if (group.items.length === 0) {
      warnings.push({
        id: `empty:${group.id}`,
        code: "empty-group",
        groupId: group.id,
        message: `El grupo «${group.name}» no tiene gastos.`,
      });
    }
    const lineSum = group.items.reduce((sum, item) => sum + Number(item.monthly || 0), 0);
    if (group.declaredSubtotal != null && Math.abs(cents(group.declaredSubtotal) - cents(lineSum)) >= 1) {
      warnings.push({
        id: `subtotal:${group.id}`,
        code: "subtotal",
        groupId: group.id,
        message: `En ${group.name} la hoja indica ${formatEuro(group.declaredSubtotal)} al mes y la suma de las líneas es ${formatEuro(lineSum)}.`,
      });
    }
    group.items.forEach((item) => {
      const key = fold(item.name);
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(item);
      if (cents(item.monthly) === 0) {
        warnings.push({
          id: `zero:${item.id}`,
          code: "zero",
          itemId: item.id,
          message: `${item.name} está a ${formatEuro(0)} al mes.`,
        });
      }
      if (Math.abs(cents(item.monthly * 12) - cents(item.yearly)) > 1) {
        warnings.push({
          id: `mismatch:${item.id}`,
          code: "mismatch",
          itemId: item.id,
          message: `${item.name}: ${formatEuro(item.monthly)} al mes × 12 = ${formatEuro(item.monthly * 12)}, y el coste anual es ${formatEuro(item.yearly)}.`,
        });
      }
      if (item.endDate && item.endDate <= today) {
        warnings.push({
          id: `ended:${item.id}`,
          code: "ended",
          itemId: item.id,
          message: `${item.name} tiene la baja el ${formatDate(item.endDate)} y ya no entra en los totales.`,
        });
      }
    });
  });

  byName.forEach((items) => {
    if (items.length < 2) return;
    warnings.push({
      id: `duplicate:${fold(items[0].name)}`,
      code: "duplicate",
      itemId: items[0].id,
      message: `El nombre «${items[0].name}» está repetido ${items.length} veces.`,
    });
  });

  const groupNames = new Map();
  dataset.groups.forEach((group) => {
    const key = fold(group.name);
    groupNames.set(key, (groupNames.get(key) || 0) + 1);
  });
  groupNames.forEach((count, key) => {
    if (count < 2) return;
    const group = dataset.groups.find((entry) => fold(entry.name) === key);
    warnings.push({
      id: `duplicate-group:${key}`,
      code: "duplicate-group",
      groupId: group?.id,
      message: `Hay ${count} grupos llamados «${group?.name || key}».`,
    });
  });

  if (dataset.declaredMonthlyTotal != null) {
    warnings.push({
      id: "grand-month",
      code: "grand-total",
      message: `La fila Total de la hoja indica ${formatEuro(dataset.declaredMonthlyTotal)} al mes y no coincide con la suma de las líneas.`,
    });
  }
  if (dataset.declaredYearlyTotal != null) {
    warnings.push({
      id: "grand-year",
      code: "grand-total",
      message: `La fila Total Año de la hoja indica ${formatEuro(dataset.declaredYearlyTotal)} y no coincide con el total mensual × 12.`,
    });
  }

  if (!dataset.reviewedAt) {
    warnings.push({
      id: "stale",
      code: "stale",
      message: "No hay fecha de revisión. Si estos importes tienen más de 6 meses, pueden no estar vigentes.",
    });
  } else if (isOlderThanMonths(dataset.reviewedAt, 6, today)) {
    warnings.push({
      id: "stale",
      code: "stale",
      message: `La última revisión es del ${formatDate(dataset.reviewedAt)}, hace más de 6 meses.`,
    });
  }

  return warnings;
}

function blankItem(partial) {
  return {
    id: partial.id || uid(),
    name: String(partial.name || "").trim(),
    basis: partial.basis === "yearly" || partial.basis === "both" ? partial.basis : "monthly",
    monthly: Number(partial.monthly) || 0,
    yearly: partial.yearly == null ? (Number(partial.monthly) || 0) * 12 : Number(partial.yearly) || 0,
    startDate: coerceDate(partial.startDate),
    endDate: coerceDate(partial.endDate),
    updatedAt: partial.updatedAt || null,
  };
}

export function normalizeDataset(input) {
  if (!input || typeof input !== "object" || !Array.isArray(input.groups)) {
    throw new Error("El JSON de gastos necesita un array groups.");
  }
  const dataset = {
    version: 1,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : new Date().toISOString(),
    reviewedAt: coerceDate(input.reviewedAt),
    groups: input.groups.map((group) => {
      const next = {
        id: group.id || uid(),
        name: String(group.name || "Sin grupo").trim() || "Sin grupo",
        items: Array.isArray(group.items) ? group.items.map((item) => blankItem(item)) : [],
      };
      if (group.declaredSubtotal != null && Number.isFinite(Number(group.declaredSubtotal))) {
        next.declaredSubtotal = Number(group.declaredSubtotal);
      }
      return next;
    }),
  };
  if (input.declaredMonthlyTotal != null && Number.isFinite(Number(input.declaredMonthlyTotal))) {
    dataset.declaredMonthlyTotal = Number(input.declaredMonthlyTotal);
  }
  if (input.declaredYearlyTotal != null && Number.isFinite(Number(input.declaredYearlyTotal))) {
    dataset.declaredYearlyTotal = Number(input.declaredYearlyTotal);
  }
  return dataset;
}

export function findItem(dataset, itemId) {
  for (const group of dataset.groups) {
    const item = group.items.find((entry) => entry.id === itemId);
    if (item) return { group, item };
  }
  return null;
}

function clearGrand(dataset) {
  delete dataset.declaredMonthlyTotal;
  delete dataset.declaredYearlyTotal;
}

function clearDeclared(group) {
  delete group.declaredSubtotal;
}

function applyAmount(item, basis, amount) {
  if (basis === "yearly") {
    item.basis = "yearly";
    item.yearly = amount;
    item.monthly = amount / 12;
    return;
  }
  item.basis = "monthly";
  item.monthly = amount;
  item.yearly = amount * 12;
}

function groupByName(dataset, name) {
  const clean = name.trim();
  let group = dataset.groups.find((entry) => fold(entry.name) === fold(clean));
  if (!group) {
    group = { id: uid(), name: clean, items: [] };
    dataset.groups.push(group);
  }
  return group;
}

export function addExpense(dataset, input, nowIso) {
  const group = groupByName(dataset, input.group);
  const item = {
    id: uid(),
    name: input.name.trim(),
    basis: "monthly",
    monthly: 0,
    yearly: 0,
    startDate: input.startDate || null,
    endDate: input.endDate || null,
    updatedAt: nowIso,
  };
  applyAmount(item, input.basis, input.amount);
  group.items.push(item);
  clearDeclared(group);
  clearGrand(dataset);
  dataset.updatedAt = nowIso;
  return item.id;
}

export function updateExpense(dataset, itemId, input, nowIso) {
  const found = findItem(dataset, itemId);
  if (!found) throw new Error("No encuentro ese gasto.");
  const target = groupByName(dataset, input.group);
  const before = cents(found.item.monthly);
  found.item.name = input.name.trim();
  found.item.startDate = input.startDate || null;
  found.item.endDate = input.endDate || null;
  found.item.updatedAt = nowIso;
  applyAmount(found.item, input.basis, input.amount);
  if (target !== found.group) {
    found.group.items = found.group.items.filter((item) => item.id !== itemId);
    target.items.push(found.item);
    clearDeclared(found.group);
  }
  if (cents(found.item.monthly) !== before || target !== found.group) clearDeclared(target);
  clearGrand(dataset);
  dataset.updatedAt = nowIso;
}

export function deleteExpense(dataset, itemId, nowIso) {
  const found = findItem(dataset, itemId);
  if (!found) return;
  found.group.items = found.group.items.filter((item) => item.id !== itemId);
  clearDeclared(found.group);
  clearGrand(dataset);
  dataset.updatedAt = nowIso;
}

export function setEndDate(dataset, itemId, endDate, nowIso) {
  const found = findItem(dataset, itemId);
  if (!found) return;
  found.item.endDate = endDate;
  found.item.updatedAt = nowIso;
  dataset.updatedAt = nowIso;
}

export function deleteGroup(dataset, groupId, nowIso) {
  const group = dataset.groups.find((entry) => entry.id === groupId);
  if (!group || group.items.length) return;
  dataset.groups = dataset.groups.filter((entry) => entry.id !== groupId);
  dataset.updatedAt = nowIso;
}

export function markReviewed(dataset, today, nowIso) {
  dataset.reviewedAt = today;
  dataset.updatedAt = nowIso;
}
