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
    owner: "daniel",
    split: 100,
    startDate: null,
    endDate: null,
    updatedAt: null,
  };
}

export function isActive(item, today) {
  return !(item.endDate && item.endDate <= today);
}

export function normalizeOwner(value) {
  const name = fold(value || "");
  if (name === "lourdes") return "lourdes";
  if (name === "compartido" || name === "compartida" || name === "shared") return "shared";
  return "daniel";
}

export function normalizeSplit(value, owner) {
  if (owner !== "shared") return owner === "lourdes" ? 0 : 100;
  if (typeof value === "number" && Number.isFinite(value)) return Math.min(100, Math.max(0, value));
  const match = String(value ?? "").match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return 50;
  return Math.min(100, Math.max(0, Number(match[1].replace(",", "."))));
}

export function ownerLabel(owner) {
  if (owner === "lourdes") return "Lourdes";
  if (owner === "shared") return "Compartido";
  return "Daniel";
}

export function personShare(item) {
  const owner = item?.owner === "lourdes" || item?.owner === "shared" ? item.owner : "daniel";
  const split = normalizeSplit(item?.split, owner);
  const ratio = split / 100;
  const monthly = Number(item?.monthly) || 0;
  const yearly = Number(item?.yearly) || 0;
  return {
    owner,
    split,
    daniel: monthly * ratio,
    lourdes: monthly * (1 - ratio),
    danielYear: yearly * ratio,
    lourdesYear: yearly * (1 - ratio),
  };
}

export function itemVisible(item, filter) {
  if (!filter || filter === "ambos") return true;
  const owner = item?.owner === "lourdes" || item?.owner === "shared" ? item.owner : "daniel";
  if (filter === "lourdes") return owner === "lourdes" || owner === "shared";
  return owner === "daniel" || owner === "shared";
}

export function warningVisible(warning, filter) {
  if (!filter || filter === "ambos") return true;
  if (!warning.owners || warning.owners.length === 0) return true;
  return warning.owners.includes(filter);
}

export function datasetFromRows(rows, options = {}) {
  const col = { name: 0, month: 1, year: 2, sub: 3, start: -1, end: -1, updated: -1, owner: -1, split: -1 };
  let headerIndex = -1;
  const scan = Math.min(rows.length, 40);
  for (let r = 0; r < scan; r += 1) {
    const row = rows[r] || [];
    const found = { name: -1, month: -1, year: -1, sub: -1, start: -1, end: -1, updated: -1, owner: -1, split: -1 };
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
      else if (text === "titular" || text === "propietario") found.owner = c;
      else if (text === "reparto" || text.startsWith("reparto") || text === "parte daniel" || text.startsWith("parte daniel")) found.split = c;
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
    if (col.owner >= 0) item.owner = normalizeOwner(cellText(row[col.owner]));
    item.split = normalizeSplit(col.split >= 0 ? row[col.split]?.v : null, item.owner);
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
    "Titular",
    "Reparto",
  ]];
  const activeRefs = [];

  dataset.groups.forEach((group) => {
    lines.push([group.name, null, null, null, null, null, null, null, null]);
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
        ownerLabel(item.owner),
        item.owner === "shared" ? normalizeSplit(item.split, "shared") : null,
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

  lines.push([null, null, null, null, null, null, null, null, null]);
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
    null,
    null,
  ]);
  return lines;
}

export function summarize(dataset, today, filter = "ambos") {
  const groups = [];
  const compareGroups = [];
  let daniel = 0;
  let lourdes = 0;
  let householdMonthly = 0;
  let householdYearly = 0;
  let activeCount = 0;
  let itemCount = 0;
  dataset.groups.forEach((group) => {
    const active = group.items.filter((item) => isActive(item, today));
    let groupDaniel = 0;
    let groupLourdes = 0;
    let groupMonthly = 0;
    let groupYearly = 0;
    let visibleActive = 0;
    active.forEach((item) => {
      const share = personShare(item);
      groupDaniel += share.daniel;
      groupLourdes += share.lourdes;
      daniel += share.daniel;
      lourdes += share.lourdes;
      householdMonthly += Number(item.monthly) || 0;
      householdYearly += Number(item.yearly) || 0;
      if (!itemVisible(item, filter)) return;
      visibleActive += 1;
      if (filter === "daniel") {
        groupMonthly += share.daniel;
        groupYearly += share.danielYear;
      } else if (filter === "lourdes") {
        groupMonthly += share.lourdes;
        groupYearly += share.lourdesYear;
      } else {
        groupMonthly += Number(item.monthly) || 0;
        groupYearly += Number(item.yearly) || 0;
      }
    });
    const visibleItems = group.items.filter((item) => itemVisible(item, filter));
    itemCount += filter === "ambos" ? group.items.length : visibleItems.length;
    activeCount += visibleActive;
    compareGroups.push({
      id: group.id,
      name: group.name,
      daniel: groupDaniel,
      lourdes: groupLourdes,
    });
    if (filter !== "ambos" && visibleItems.length === 0) return;
    groups.push({
      id: group.id,
      name: group.name,
      monthly: groupMonthly,
      yearly: groupYearly,
      daniel: groupDaniel,
      lourdes: groupLourdes,
      activeCount: visibleActive,
      itemCount: filter === "ambos" ? group.items.length : visibleItems.length,
    });
  });
  const monthly = filter === "daniel" ? daniel : filter === "lourdes" ? lourdes : householdMonthly;
  const yearlyItems = groups.reduce((sum, group) => sum + group.yearly, 0);
  const totalPeople = daniel + lourdes;
  return {
    monthly,
    yearlySheet: monthly * 12,
    yearlyItems,
    householdMonthly,
    householdYearlySheet: householdMonthly * 12,
    groups,
    activeCount,
    itemCount,
    people: {
      daniel,
      lourdes,
      danielYear: daniel * 12,
      lourdesYear: lourdes * 12,
      total: totalPeople,
      difference: daniel - lourdes,
      danielPct: totalPeople > 0 ? (daniel / totalPeople) * 100 : 0,
      lourdesPct: totalPeople > 0 ? (lourdes / totalPeople) * 100 : 0,
    },
    compareGroups,
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
      const who = ownerLabel(item.owner);
      const owners = item.owner === "shared" ? ["daniel", "lourdes"] : [item.owner === "lourdes" ? "lourdes" : "daniel"];
      if (cents(item.monthly) === 0) {
        warnings.push({
          id: `zero:${item.id}`,
          code: "zero",
          itemId: item.id,
          owners,
          message: `${item.name} (${who}) está a ${formatEuro(0)} al mes.`,
        });
      }
      if (Math.abs(cents(item.monthly * 12) - cents(item.yearly)) > 1) {
        warnings.push({
          id: `mismatch:${item.id}`,
          code: "mismatch",
          itemId: item.id,
          owners,
          message: `${item.name} (${who}): ${formatEuro(item.monthly)} al mes × 12 = ${formatEuro(item.monthly * 12)}, y el coste anual es ${formatEuro(item.yearly)}.`,
        });
      }
      if (item.endDate && item.endDate <= today) {
        warnings.push({
          id: `ended:${item.id}`,
          code: "ended",
          itemId: item.id,
          owners,
          message: `${item.name} (${who}) tiene la baja el ${formatDate(item.endDate)} y ya no entra en los totales.`,
        });
      }
    });
  });

  byName.forEach((items) => {
    if (items.length < 2) return;
    const owners = [...new Set(items.flatMap((item) => (item.owner === "shared" ? ["daniel", "lourdes"] : [item.owner === "lourdes" ? "lourdes" : "daniel"])))];
    warnings.push({
      id: `duplicate:${fold(items[0].name)}`,
      code: "duplicate",
      itemId: items[0].id,
      owners,
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

  const spent = summarize(dataset, today, "ambos").people;
  ["daniel", "lourdes"].forEach((person) => {
    const cap = dataset.budgets?.[person];
    if (cap == null || !Number.isFinite(Number(cap))) return;
    const amount = spent[person];
    if (cents(amount) > cents(cap)) {
      warnings.push({
        id: `budget:${person}`,
        code: "budget",
        owners: [person],
        message: `${ownerLabel(person)} supera el presupuesto mensual: ${formatEuro(amount)} de ${formatEuro(cap)}.`,
      });
    }
  });

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
    owner: normalizeOwner(partial.owner),
    split: normalizeSplit(partial.split, normalizeOwner(partial.owner)),
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
  dataset.budgets = {
    daniel: budgetOrNull(input.budgets?.daniel),
    lourdes: budgetOrNull(input.budgets?.lourdes),
  };
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

function budgetOrNull(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return number;
}

function applyOwner(item, input) {
  item.owner = normalizeOwner(input.owner);
  item.split = normalizeSplit(input.split, item.owner);
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
    owner: "daniel",
    split: 100,
  };
  applyOwner(item, input);
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
  applyOwner(found.item, input);
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

export function setBudgets(dataset, budgets, nowIso) {
  dataset.budgets = {
    daniel: budgetOrNull(budgets.daniel),
    lourdes: budgetOrNull(budgets.lourdes),
  };
  dataset.updatedAt = nowIso;
}
