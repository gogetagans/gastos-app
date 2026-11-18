import { openEnvelope, sealDataset, validateEnvelope } from "./crypto.mjs";
import {
  addExpense,
  collectWarnings,
  deleteExpense,
  deleteGroup,
  findItem,
  isActive,
  markReviewed,
  setEndDate,
  summarize,
  updateExpense,
} from "./dataset.mjs";
import {
  esc,
  formatDate,
  formatEuro,
  IDLE_MS,
  nowISO,
  parseAmount,
  prefersReducedMotion,
  todayISO,
} from "./format.mjs";
import { datasetFromBuffer, downloadWorkbook } from "./sheet.mjs";

const VAULT_KEY = "gastos.vault";
const THEME_KEY = "gastos.theme";

const state = {
  remote: null,
  vault: null,
  manualEnvelope: null,
  forceSetup: false,
  session: null,
  summary: null,
  warnings: [],
  lastActivity: Date.now(),
  prevMonthly: 0,
  prevYearly: 0,
  enterId: null,
  flashId: null,
};

const ICONS = {
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 4v10"/><path d="M8 10l4 4 4-4"/><path d="M5 19h14"/>',
  upload: '<path d="M12 16V6"/><path d="M8 10l4-4 4 4"/><path d="M5 19h14"/>',
  pencil: '<path d="M4 20h4L18 10l-4-4L4 16v4z"/><path d="M12 6l4 4"/>',
  trash: '<path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M8 7l1 12h6l1-12"/>',
  eye: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.5 6.2A10 10 0 0 1 12 6c6 0 10 6 10 6a18 18 0 0 1-3.2 3.8"/><path d="M6.1 6.1C3.7 7.9 2 12 2 12s4 6 10 6c1.5 0 2.8-.3 4-.8"/>',
  sun: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/>',
  monitor: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
  alert: '<path d="M12 4 3 19h18L12 4z"/><path d="M12 10v4M12 16.5h.01"/>',
  check: '<path d="M5 12.5 9.5 17 19 7"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
  back: '<path d="M15 6 9 12l6 6"/>',
};

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;
}

function mark() {
  return `<svg class="mark" viewBox="0 0 48 48" aria-hidden="true"><rect x="3" y="3" width="42" height="42" rx="13"></rect><rect x="13" y="26" width="5" height="8" rx="1.4"></rect><rect x="21.5" y="18" width="5" height="16" rx="1.4"></rect><rect x="30" y="14" width="5" height="20" rx="1.4"></rect></svg>`;
}

function notice() {
  return `<p class="notice" role="note">${icon("alert")}<span>Datos personales y sensibles. Se guardan cifrados en este dispositivo y no se envían a ningún servidor. Si el sitio es público, la contraseña es la protección.</span></p>`;
}

function themeMode() {
  return document.documentElement.dataset.themeMode || "system";
}

function themeSwitch() {
  const mode = themeMode();
  const options = [
    ["system", "monitor", "Sistema"],
    ["light", "sun", "Claro"],
    ["dark", "moon", "Oscuro"],
  ];
  return `<div class="seg" role="group" aria-label="Tema">${options
    .map(
      ([value, glyph, label]) =>
        `<button type="button" class="seg-btn" data-action="theme" data-mode="${value}" aria-pressed="${mode === value}">${icon(glyph)}<span>${label}</span></button>`,
    )
    .join("")}</div>`;
}

function fileEnvelope() {
  return state.manualEnvelope || state.remote?.envelope || null;
}

function vaultEnvelope() {
  return state.vault && !state.vault.invalid ? state.vault : null;
}

function showSetup() {
  return state.forceSetup || (!fileEnvelope() && !vaultEnvelope());
}

function bootShell() {
  document.getElementById("boot")?.remove();
  const app = document.getElementById("app");
  app.hidden = false;
  app.innerHTML = '<div id="view"></div><dialog id="modal"></dialog><dialog id="confirm"></dialog>';
}

function paintGate(message = "") {
  const setup = showSetup();
  const sources = [];
  if (state.manualEnvelope) sources.push("archivo elegido en este equipo");
  else if (state.remote?.envelope) sources.push("data/gastos.enc");
  if (vaultEnvelope()) sources.push("copia cifrada de este navegador");
  const sourceLine = sources.length ? `Origen: ${sources.join(" y ")}.` : "";
  const invalid = state.remote?.invalid && !state.manualEnvelope
    ? `<p class="error" role="alert">${esc(state.remote.message)}</p>`
    : "";
  const vaultInvalid = state.vault?.invalid
    ? `<p class="error" role="alert">La copia local no se puede leer. Puedes olvidarla y empezar de nuevo.</p>
       <button type="button" class="btn btn-ghost" data-action="forget-vault">Olvidar copia local</button>`
    : "";

  const form = setup
    ? `<form id="setup-form" class="stack-form">
        <label class="drop">
          <input id="setup-file" name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required>
          <span class="drop-title">${icon("upload")} Elegir Excel</span>
          <span class="drop-name" id="setup-file-name">Hoja con columnas Servicio, Coste / mes y Coste / año.</span>
        </label>
        <label class="field">Contraseña nueva
          <input id="setup-password" name="password" type="password" autocomplete="new-password" minlength="8" required>
        </label>
        <label class="field">Repite la contraseña
          <input id="setup-password-2" name="confirm" type="password" autocomplete="new-password" minlength="8" required>
        </label>
        <p class="hint">Mínimo 8 caracteres. Con el script <code>scripts/encrypt.mjs</code> publicas <code>data/gastos.enc</code>; aquí la copia queda cifrada en el navegador.</p>
        <p class="error" id="gate-error" role="alert">${esc(message)}</p>
        <button class="btn btn-primary" type="submit">${icon("lock")} Crear caja y entrar</button>
      </form>
      <button type="button" class="btn btn-ghost" data-action="pick-enc">${icon("upload")} Ya tengo un gastos.enc</button>`
    : `<form id="gate-form" class="stack-form">
        <p class="lede">Introduce tu contraseña</p>
        <label class="field">Contraseña
          <span class="secret">
            <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
            <button type="button" class="icon-btn" data-action="toggle-secret" aria-label="Mostrar contraseña">${icon("eye")}</button>
          </span>
        </label>
        <p class="hint">${esc(sourceLine)} A los 15 minutos sin actividad se vuelve a bloquear.</p>
        <p class="error" id="gate-error" role="alert">${esc(message)}</p>
        <button class="btn btn-primary" type="submit">${icon("lock")} Desbloquear</button>
      </form>
      <div class="gate-links">
        <button type="button" class="text-btn" data-action="pick-enc">Abrir un gastos.enc</button>
        <button type="button" class="text-btn" data-action="force-setup">Importar un Excel</button>
      </div>`;

  document.getElementById("view").innerHTML = `
    <a class="skip" href="#acceso">Saltar al acceso</a>
    <section class="gate">
      <div class="gate-tools">${themeSwitch()}</div>
      <div class="gate-card" id="acceso">
        ${mark()}
        <p class="eyebrow">Cuenta de la casa</p>
        <h1>Gastos fijos</h1>
        ${notice()}
        ${invalid}
        ${vaultInvalid}
        ${form}
      </div>
    </section>
    <input id="enc-file" type="file" accept=".enc,.json,application/json" hidden>`;
  const dialog = document.getElementById("modal");
  if (dialog?.open) dialog.close();
}

function groupOptions(selected = "") {
  const names = state.session.dataset.groups.map((group) => group.name);
  return `<datalist id="group-list">${names
    .map((name) => `<option value="${esc(name)}"></option>`)
    .join("")}</datalist>`;
}

function appHtml() {
  const { summary, warnings, session } = state;
  const dataset = session.dataset;
  const yearDiff = Math.abs(Math.round(summary.yearlySheet * 100) - Math.round(summary.yearlyItems * 100)) > 1;
  const maxGroup = Math.max(0, ...summary.groups.map((group) => group.monthly));
  const localNewer = session.hasRemote && (!session.remoteUpdatedAt || (dataset.updatedAt || "") > session.remoteUpdatedAt);
  const banner = !session.hasRemote
    ? "Esta copia está cifrada solo en este navegador. Descarga gastos.enc para llevarla a otro equipo."
    : localNewer
      ? "Hay cambios más recientes en este navegador que en el archivo publicado."
      : session.vaultLockedOut
        ? "Hay otra copia local que esta contraseña no abre. Seguirá ahí hasta que la sustituyas."
        : "";

  const stack = summary.monthly > 0
    ? `<div class="stack" role="img" aria-label="Reparto del total mensual por grupo">${summary.groups
      .filter((group) => group.monthly > 0)
      .map((group, index) => {
        const tone = state.session.dataset.groups.findIndex((entry) => entry.id === group.id);
        const width = (group.monthly / summary.monthly) * 100;
        return `<span class="stack-seg" style="--w:${width}%;--d:${index * 40}ms" data-tone="${tone}" title="${esc(group.name)}: ${esc(formatEuro(group.monthly))}"></span>`;
      })
      .join("")}</div>`
    : `<p class="hint">Todavía no hay gastos activos que sumar.</p>`;

  const bars = summary.groups.some((group) => group.monthly > 0)
    ? summary.groups
      .map((group) => {
        const tone = dataset.groups.findIndex((entry) => entry.id === group.id);
        const width = maxGroup > 0 ? (group.monthly / maxGroup) * 100 : 0;
        const share = summary.monthly > 0 ? Math.round((group.monthly / summary.monthly) * 100) : 0;
        return `<div class="bar-row">
          <div class="bar-label"><span class="dot" data-tone="${tone}"></span><span>${esc(group.name)}</span></div>
          <div class="bar" aria-hidden="true"><span class="bar-fill" style="--w:${width}%;--d:${tone * 45}ms" data-tone="${tone}"></span></div>
          <div class="bar-value"><strong>${esc(formatEuro(group.monthly))}</strong><span>${share}%</span></div>
        </div>`;
      })
      .join("")
    : `<p class="empty">Cuando añadas gastos activos, el reparto se dibuja aquí.</p>`;

  const warningHtml = warnings.length
    ? `<div class="panel">
        <div class="panel-head"><h2>${icon("alert")} Avisos <span class="count">${warnings.length}</span></h2></div>
        <ul class="warnings">${warnings
          .map((warning) => {
            const jump = warning.itemId || warning.groupId || "";
            return `<li><button type="button" class="warning" data-action="jump" data-target="${esc(jump)}"><span>${esc(warning.message)}</span></button></li>`;
          })
          .join("")}
          ${warnings.some((warning) => warning.code === "stale")
            ? `<li><button type="button" class="btn btn-ghost" data-action="review">${icon("check")} Marcar como revisados</button></li>`
            : ""}
        </ul>
      </div>`
    : `<div class="panel panel-calm"><h2>${icon("check")} Sin incoherencias</h2><p>Importes, nombres, fechas y subtotales cuadran con las reglas de revisión.</p></div>`;

  const cards = dataset.groups.length
    ? dataset.groups
      .map((group, index) => {
        const stats = summary.groups[index];
        const items = group.items
          .map((item) => {
            const ended = !isActive(item, todayISO());
            const classes = [
              "item",
              ended ? "is-ended" : "",
              state.enterId === item.id ? "is-entering" : "",
              state.flashId === item.id ? "is-flash" : "",
            ].filter(Boolean).join(" ");
            return `<article class="${classes}" data-item-id="${esc(item.id)}">
              <div class="item-inner">
                <div class="item-main">
                  <div>
                    <h3>${esc(item.name)} ${ended ? '<span class="badge">De baja</span>' : ""}</h3>
                    <p class="meta">${icon("calendar")} Alta ${esc(formatDate(item.startDate))} · Baja ${esc(formatDate(item.endDate))} · Cambio ${esc(formatDate(item.updatedAt))}</p>
                  </div>
                  <div class="item-money">
                    <strong>${esc(formatEuro(item.monthly))}<span> / mes</span></strong>
                    <span>${esc(formatEuro(item.yearly))} / año</span>
                  </div>
                </div>
                <div class="item-actions">
                  <button type="button" class="btn btn-ghost" data-action="edit" data-id="${esc(item.id)}">${icon("pencil")} Editar</button>
                  ${ended
                    ? `<button type="button" class="btn btn-ghost" data-action="reactivate" data-id="${esc(item.id)}">Reactivar</button>`
                    : `<button type="button" class="btn btn-ghost" data-action="baja" data-id="${esc(item.id)}">Dar de baja</button>`}
                  <button type="button" class="btn btn-danger" data-action="delete" data-id="${esc(item.id)}">${icon("trash")} Eliminar</button>
                </div>
              </div>
            </article>`;
          })
          .join("");
        return `<section class="card" id="group-${esc(group.id)}" data-tone="${index % 8}">
          <header class="card-head">
            <div><p class="eyebrow">Grupo</p><h2>${esc(group.name)}</h2></div>
            <div class="card-total"><span>Total / mes</span><strong>${esc(formatEuro(stats.monthly))}</strong><small>${esc(formatEuro(stats.yearly))} / año</small></div>
          </header>
          ${items || `<p class="empty">Este grupo está vacío.</p>`}
          ${group.items.length === 0 ? `<button type="button" class="btn btn-ghost" data-action="delete-group" data-id="${esc(group.id)}">Eliminar grupo</button>` : ""}
        </section>`;
      })
      .join("")
    : `<section class="card"><p class="empty">No hay gastos todavía.</p><button type="button" class="btn btn-primary" data-action="add">${icon("plus")} Añadir gasto</button></section>`;

  return `
    <a class="skip" href="#contenido">Saltar al contenido</a>
    <header class="top">
      <div class="brand">${mark()}<div><p class="eyebrow">Personal y sensible</p><h1>Gastos fijos</h1></div></div>
      <div class="top-actions">
        ${themeSwitch()}
        <button type="button" class="btn btn-ghost" data-action="export">${icon("download")} Exportar Gastos.xlsx</button>
        <button type="button" class="btn btn-ghost" data-action="import">${icon("upload")} Importar xlsx</button>
        <button type="button" class="btn btn-ghost" data-action="download-enc">${icon("lock")} Descargar gastos.enc</button>
        <button type="button" class="btn btn-primary" data-action="add">${icon("plus")} Añadir gasto</button>
        <button type="button" class="btn btn-ghost" data-action="lock">${icon("lock")} Bloquear</button>
      </div>
    </header>
    <main id="contenido" class="wrap">
      ${notice()}
      ${banner ? `<p class="banner">${esc(banner)}</p>` : ""}
      <section class="hero">
        <div>
          <p class="eyebrow">Total del mes</p>
          <p class="total-figure" data-count="month" aria-live="polite">${esc(formatEuro(state.prevMonthly))}</p>
          <p class="total-side">Total año <strong data-count="year">${esc(formatEuro(state.prevYearly))}</strong> <span>total mes × 12</span></p>
          ${yearDiff ? `<p class="hint">La suma de los costes anuales de cada línea es ${esc(formatEuro(summary.yearlyItems))}.</p>` : ""}
        </div>
        <div class="hero-chart">
          ${stack}
          <p class="hint">${summary.activeCount} activos · ${summary.itemCount - summary.activeCount} de baja · ${dataset.groups.length} grupos. Los totales se recalculan al momento.</p>
        </div>
      </section>
      <div class="split">
        ${warningHtml}
        <section class="panel">
          <div class="panel-head"><h2>Reparto mensual</h2></div>
          <div class="bars">${bars}</div>
        </section>
      </div>
      <div class="groups">${cards}</div>
    </main>
    <footer class="wrap foot">Copia local cifrada con la misma clave. Se bloquea tras 15 minutos sin actividad.</footer>
    <input id="import-xlsx" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>`;
}

function paint() {
  const today = todayISO();
  state.summary = summarize(state.session.dataset, today);
  state.warnings = collectWarnings(state.session.dataset, today);
  const html = appHtml();
  state.enterId = null;
  state.flashId = null;
  document.getElementById("view").innerHTML = html;
  const dialog = document.getElementById("modal");
  if (dialog?.open) dialog.close();
  animateTotals();
}

function animateTotals() {
  const monthEl = document.querySelector("[data-count='month']");
  const yearEl = document.querySelector("[data-count='year']");
  runCount(monthEl, state.prevMonthly, state.summary.monthly);
  runCount(yearEl, state.prevYearly, state.summary.yearlySheet);
  state.prevMonthly = state.summary.monthly;
  state.prevYearly = state.summary.yearlySheet;
}

function runCount(el, from, to) {
  if (!el) return;
  if (prefersReducedMotion() || Math.abs(from - to) < 0.005) {
    el.textContent = formatEuro(to);
    return;
  }
  const start = performance.now();
  const duration = 720;
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = formatEuro(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = formatEuro(to);
  };
  requestAnimationFrame(step);
}

function toast(message) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("is-on");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("is-on"), 3600);
}

function ask({ title, text, confirm, danger = false }) {
  const dialog = document.getElementById("confirm");
  dialog.innerHTML = `<div class="modal-panel">
    <h2 id="modal-title">${esc(title)}</h2>
    <p>${esc(text)}</p>
    <form method="dialog" class="modal-actions">
      <button class="btn btn-ghost" value="cancel" autofocus>Cancelar</button>
      <button class="btn ${danger ? "btn-danger" : "btn-primary"}" value="ok">${esc(confirm)}</button>
    </form>
  </div>`;
  dialog.setAttribute("aria-labelledby", "modal-title");
  const done = new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
  });
  dialog.showModal();
  return done;
}

function closeModal() {
  document.getElementById("modal")?.close();
}

function expenseForm(item) {
  const basis = item?.basis === "yearly" ? "yearly" : "monthly";
  const amount = item ? (basis === "yearly" ? item.yearly : item.monthly) : "";
  const amountText = amount === "" ? "" : String(amount).replace(".", ",");
  const dialog = document.getElementById("modal");
  dialog.innerHTML = `<form id="expense-form" class="modal-panel">
    <h2 id="modal-title">${item ? "Editar gasto" : "Añadir gasto"}</h2>
    <label class="field">Nombre
      <input name="name" required maxlength="80" value="${esc(item?.name || "")}" autofocus>
    </label>
    <label class="field">Grupo
      <input name="group" required maxlength="60" list="group-list" value="${esc(item ? findItem(state.session.dataset, item.id)?.group.name || "" : "")}" placeholder="Escribe uno nuevo o elige">
    </label>
    ${groupOptions()}
    <fieldset class="choice">
      <legend>El importe es</legend>
      <label><input type="radio" name="basis" value="monthly" ${basis === "monthly" ? "checked" : ""}> Mensual</label>
      <label><input type="radio" name="basis" value="yearly" ${basis === "yearly" ? "checked" : ""}> Anual</label>
    </fieldset>
    <label class="field">Importe
      <input name="amount" required inputmode="decimal" value="${esc(amountText)}" placeholder="0,00">
    </label>
    <div class="dates">
      <label class="field">Alta
        <input name="start" type="date" value="${esc(item?.startDate || "")}">
      </label>
      <label class="field">Baja
        <input name="end" type="date" value="${esc(item?.endDate || "")}">
      </label>
    </div>
    <p class="hint" id="amount-preview"></p>
    ${item?.basis === "both" ? `<p class="hint">La línea trae un anual que no cuadra con el mensual. Al guardar se recalcula el lado que no editas.</p>` : ""}
    <p class="error" id="form-error" role="alert"></p>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" data-action="close-modal">Cancelar</button>
      <button type="submit" class="btn btn-primary">Guardar</button>
    </div>
  </form>`;
  dialog.setAttribute("aria-labelledby", "modal-title");
  dialog.showModal();
  updatePreview();
}

function formPayload(form) {
  const name = form.name.value.trim();
  const group = form.group.value.trim();
  const basis = form.basis.value === "yearly" ? "yearly" : "monthly";
  const amount = parseAmount(form.amount.value);
  const startDate = form.start.value || null;
  const endDate = form.end.value || null;
  const errors = [];
  if (!name) errors.push("Escribe un nombre.");
  if (name.length > 80) errors.push("El nombre es demasiado largo.");
  if (!group) errors.push("Escribe un grupo. Si no existe, se crea.");
  if (amount == null) errors.push("El importe no es un número. Puedes usar coma decimal.");
  else if (amount < 0) errors.push("El importe tiene que ser cero o mayor.");
  else if (amount > 10000000) errors.push("El importe es demasiado grande.");
  if (startDate && endDate && endDate < startDate) errors.push("La baja es anterior al alta.");
  return { name, group, basis, amount, startDate, endDate, errors };
}

function updatePreview() {
  const form = document.getElementById("expense-form");
  const preview = document.getElementById("amount-preview");
  if (!form || !preview) return;
  const { basis, amount } = formPayload(form);
  if (amount == null || amount < 0) {
    preview.textContent = "El total del mes se actualiza al guardar.";
    return;
  }
  const monthly = basis === "yearly" ? amount / 12 : amount;
  preview.textContent = `Sumará ${formatEuro(monthly)} al mes y ${formatEuro(basis === "yearly" ? amount : amount * 12)} al año.`;
}

async function commit(mutator) {
  const backup = structuredClone(state.session.dataset);
  mutator(state.session.dataset);
  if (!(await persist())) {
    state.session.dataset = backup;
    return false;
  }
  return true;
}

async function persist() {
  if (state.session.vaultLockedOut) {
    const ok = await ask({
      title: "Sustituir la copia local",
      text: "En este navegador hay otra copia cifrada que esta contraseña no abre. Si continúas, esa copia se sustituye.",
      confirm: "Sustituir",
      danger: true,
    });
    if (!ok) return false;
    state.session.vaultLockedOut = false;
  }
  try {
    const sealed = await sealDataset("", state.session.dataset, {
      key: state.session.key,
      salt: state.session.salt,
      iterations: state.session.iterations,
    });
    localStorage.setItem(VAULT_KEY, JSON.stringify(sealed.envelope));
    state.vault = sealed.envelope;
    state.session.key = sealed.key;
    state.session.salt = sealed.salt;
    state.session.iterations = sealed.iterations;
    return true;
  } catch (error) {
    toast(error?.name === "QuotaExceededError"
      ? "El navegador no ha podido guardar la copia cifrada."
      : "No se ha podido guardar la copia cifrada en este navegador.");
    return false;
  }
}

function lock() {
  closeModal();
  const confirm = document.getElementById("confirm");
  if (confirm?.open) confirm.close();
  state.session = null;
  state.summary = null;
  state.warnings = [];
  state.prevMonthly = 0;
  state.prevYearly = 0;
  state.forceSetup = false;
  paintGate();
}

async function unlock(password) {
  const remote = fileEnvelope();
  let remoteOpened = null;
  let vaultOpened = null;
  if (remote) {
    try {
      remoteOpened = await openEnvelope(password, remote);
    } catch (error) {
      if (!vaultEnvelope()) throw error;
    }
  }
  if (vaultEnvelope()) {
    try {
      vaultOpened = await openEnvelope(password, vaultEnvelope());
    } catch (error) {
      if (!remoteOpened) throw error;
    }
  }
  if (!remoteOpened && !vaultOpened) {
    throw new Error("Contraseña incorrecta o archivo dañado.");
  }
  let chosen = remoteOpened;
  let vaultLockedOut = false;
  if (remoteOpened && vaultOpened) {
    const vaultStamp = vaultOpened.data.updatedAt || "";
    const remoteStamp = remoteOpened.data.updatedAt || "";
    chosen = vaultStamp >= remoteStamp ? vaultOpened : remoteOpened;
  } else if (vaultOpened) {
    chosen = vaultOpened;
  } else if (remote && vaultEnvelope() == null && state.vault?.invalid) {
    vaultLockedOut = false;
  }
  if (remoteOpened && !vaultOpened && vaultEnvelope()) vaultLockedOut = true;
  state.session = {
    key: chosen.key,
    salt: chosen.salt,
    iterations: chosen.iterations,
    dataset: chosen.data,
    hasRemote: Boolean(remote),
    remoteUpdatedAt: remoteOpened?.data.updatedAt || null,
    vaultLockedOut,
  };
  state.forceSetup = false;
  state.lastActivity = Date.now();
  if (!vaultLockedOut && remoteOpened && (!vaultOpened || (remoteOpened.data.updatedAt || "") > (vaultOpened.data.updatedAt || ""))) {
    await persist();
  }
  paint();
}

async function readDatasetFile(file) {
  try {
    const dataset = datasetFromBuffer(await file.arrayBuffer());
    if (!dataset.groups.length) {
      throw new Error("No he encontrado gastos. Hace falta la columna Servicio y un coste al mes o al año.");
    }
    return dataset;
  } catch (error) {
    if (error.message?.startsWith("No he encontrado")) throw error;
    throw new Error("No he podido leer ese Excel.");
  }
}

async function setup(form) {
  const password = form.password.value;
  const file = form.file.files?.[0];
  if (!file) throw new Error("Elige el Excel de gastos.");
  if (password.length < 8) throw new Error("La contraseña nueva necesita al menos 8 caracteres.");
  if (password !== form.confirm.value) throw new Error("Las contraseñas no coinciden.");
  if (vaultEnvelope() || state.vault?.invalid) {
    const ok = await ask({
      title: "Sustituir la copia de este navegador",
      text: "El Excel importado reemplaza la copia cifrada guardada en este navegador.",
      confirm: "Sustituir",
      danger: true,
    });
    if (!ok) {
      const silent = new Error("cancelado");
      silent.silent = true;
      throw silent;
    }
  }
  const dataset = await readDatasetFile(file);
  const sealed = await sealDataset(password, dataset);
  localStorage.setItem(VAULT_KEY, JSON.stringify(sealed.envelope));
  state.vault = sealed.envelope;
  state.manualEnvelope = null;
  state.session = {
    key: sealed.key,
    salt: sealed.salt,
    iterations: sealed.iterations,
    dataset,
    hasRemote: Boolean(fileEnvelope()),
    remoteUpdatedAt: null,
    vaultLockedOut: false,
  };
  state.forceSetup = false;
  state.lastActivity = Date.now();
  state.prevMonthly = 0;
  state.prevYearly = 0;
  paint();
}

function downloadBlob(filename, blob) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function onSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.id === "gate-form") {
    event.preventDefault();
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    button.classList.add("is-busy");
    button.textContent = "Comprobando…";
    try {
      await unlock(form.password.value);
      form.password.value = "";
    } catch (error) {
      const slot = document.getElementById("gate-error");
      if (slot) slot.textContent = error.message || "No se ha podido abrir.";
      const card = form.closest(".gate-card");
      card?.classList.remove("is-shake");
      if (card) void card.offsetWidth;
      card?.classList.add("is-shake");
      button.disabled = false;
      button.classList.remove("is-busy");
      button.innerHTML = `${icon("lock")} Desbloquear`;
    }
    return;
  }
  if (form.id === "setup-form") {
    event.preventDefault();
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    button.classList.add("is-busy");
    button.textContent = "Cifrando…";
    try {
      await setup(form);
    } catch (error) {
      if (!error.silent) {
        const slot = document.getElementById("gate-error");
        if (slot) slot.textContent = error.message || "No se ha podido crear la caja.";
        const card = form.closest(".gate-card");
      card?.classList.remove("is-shake");
      if (card) void card.offsetWidth;
      card?.classList.add("is-shake");
      }
      button.disabled = false;
      button.classList.remove("is-busy");
      button.innerHTML = `${icon("lock")} Crear caja y entrar`;
    }
    return;
  }
  if (form.id === "expense-form") {
    event.preventDefault();
    const payload = formPayload(form);
    const slot = document.getElementById("form-error");
    if (payload.errors.length) {
      if (slot) slot.textContent = payload.errors[0];
      return;
    }
    const editing = form.dataset.itemId || "";
    try {
      let created = "";
      const saved = await commit((dataset) => {
        if (editing) updateExpense(dataset, editing, payload, nowISO());
        else created = addExpense(dataset, payload, nowISO());
      });
      if (!saved) return;
      state.flashId = editing || null;
      state.enterId = created || null;
      closeModal();
      paint();
    } catch (error) {
      if (slot) slot.textContent = error.message || "No se ha podido guardar.";
    }
  }
}

async function onClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "theme") {
    applyTheme(button.dataset.mode);
    document.querySelectorAll(".seg-btn").forEach((el) => {
      el.setAttribute("aria-pressed", el.dataset.mode === button.dataset.mode ? "true" : "false");
    });
    return;
  }
  if (action === "toggle-secret") {
    const input = document.getElementById("password");
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.innerHTML = icon(show ? "eyeOff" : "eye");
    button.setAttribute("aria-label", show ? "Ocultar contraseña" : "Mostrar contraseña");
    return;
  }
  if (action === "pick-enc") {
    document.getElementById("enc-file")?.click();
    return;
  }
  if (action === "force-setup") {
    state.forceSetup = true;
    paintGate();
    return;
  }
  if (action === "forget-vault") {
    const ok = await ask({
      title: "Olvidar la copia local",
      text: "Se borra la copia cifrada de este navegador. El archivo publicado, si existe, no se toca.",
      confirm: "Olvidar",
      danger: true,
    });
    if (!ok) return;
    localStorage.removeItem(VAULT_KEY);
    state.vault = null;
    paintGate();
    return;
  }
  if (action === "close-modal") {
    closeModal();
    return;
  }
  if (!state.session) return;
  state.lastActivity = Date.now();
  if (action === "lock") {
    lock();
    return;
  }
  if (action === "add") {
    expenseForm(null);
    return;
  }
  if (action === "edit") {
    const found = findItem(state.session.dataset, button.dataset.id);
    if (!found) return;
    expenseForm(found.item);
    document.getElementById("expense-form").dataset.itemId = found.item.id;
    return;
  }
  if (action === "baja") {
    const found = findItem(state.session.dataset, button.dataset.id);
    if (!found) return;
    const today = todayISO();
    const ok = await ask({
      title: "Dar de baja",
      text: `¿Dar de baja «${found.item.name}» con fecha ${formatDate(today)}? Dejará de sumar en los totales.`,
      confirm: "Dar de baja",
      danger: true,
    });
    if (!ok) return;
    const saved = await commit((dataset) => setEndDate(dataset, found.item.id, today, nowISO()));
    if (!saved) return;
    state.flashId = found.item.id;
    paint();
    return;
  }
  if (action === "reactivate") {
    const saved = await commit((dataset) => setEndDate(dataset, button.dataset.id, null, nowISO()));
    if (!saved) return;
    state.flashId = button.dataset.id;
    paint();
    return;
  }
  if (action === "delete") {
    const found = findItem(state.session.dataset, button.dataset.id);
    if (!found) return;
    const ok = await ask({
      title: "Eliminar gasto",
      text: `¿Eliminar «${found.item.name}»? Se borra de este dispositivo.`,
      confirm: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    const row = button.closest(".item");
    if (row && !prefersReducedMotion()) {
      row.classList.add("is-leaving");
      await new Promise((resolve) => setTimeout(resolve, 340));
    }
    const saved = await commit((dataset) => deleteExpense(dataset, found.item.id, nowISO()));
    if (saved) paint();
    else paint();
    return;
  }
  if (action === "delete-group") {
    const group = state.session.dataset.groups.find((entry) => entry.id === button.dataset.id);
    if (!group) return;
    const ok = await ask({
      title: "Eliminar grupo",
      text: `¿Eliminar el grupo vacío «${group.name}»?`,
      confirm: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    const savedGroup = await commit((dataset) => deleteGroup(dataset, group.id, nowISO()));
    if (savedGroup) paint();
    return;
  }
  if (action === "review") {
    const savedReview = await commit((dataset) => markReviewed(dataset, todayISO(), nowISO()));
    if (savedReview) paint();
    return;
  }
  if (action === "jump") {
    const target = button.dataset.target;
    const el = document.querySelector(`[data-item-id="${CSS.escape(target)}"]`)
      || document.getElementById(`group-${target}`);
    if (!el) return;
    el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    el.classList.add("is-flash");
    return;
  }
  if (action === "export") {
    try {
      downloadWorkbook(state.session.dataset, todayISO());
    } catch {
      toast("No se ha podido generar el Excel.");
    }
    return;
  }
  if (action === "import") {
    document.getElementById("import-xlsx")?.click();
    return;
  }
  if (action === "download-enc") {
    try {
      const sealed = await sealDataset("", state.session.dataset, {
        key: state.session.key,
        salt: state.session.salt,
        iterations: state.session.iterations,
      });
      downloadBlob("gastos.enc", new Blob([`${JSON.stringify(sealed.envelope, null, 2)}\n`], { type: "application/json" }));
      toast("gastos.enc descargado. Contiene los datos cifrados, no el Excel.");
    } catch {
      toast("No se ha podido cifrar la descarga.");
    }
  }
}

function applyTheme(mode) {
  const next = mode === "light" || mode === "dark" || mode === "system" ? mode : "system";
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* la preferencia de tema no es un dato de gastos */
  }
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = next === "system" ? (dark ? "dark" : "light") : next;
  document.documentElement.dataset.themeMode = next;
}

async function loadRemote() {
  if (location.protocol === "file:") return { missing: true };
  try {
    const response = await fetch("./data/gastos.enc", { cache: "no-store" });
    if (!response.ok) return { missing: true };
    const text = (await response.text()).trim();
    if (!text || text.startsWith("<")) return { missing: true };
    const envelope = JSON.parse(text);
    validateEnvelope(envelope);
    return { envelope };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { invalid: true, message: "data/gastos.enc no es un JSON cifrado válido." };
    }
    if (String(error.message || "").includes("iteraciones") || String(error.message || "").includes("formato") || String(error.message || "").includes("cifrado")) {
      return { invalid: true, message: error.message };
    }
    return { missing: true };
  }
}

function loadVault() {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return null;
    const envelope = JSON.parse(raw);
    validateEnvelope(envelope);
    return envelope;
  } catch {
    return { invalid: true };
  }
}

function poke() {
  if (!state.session) return;
  state.lastActivity = Date.now();
}

async function onEncPicked(file) {
  if (!file) return;
  try {
    const envelope = JSON.parse(await file.text());
    validateEnvelope(envelope);
    state.manualEnvelope = envelope;
    state.forceSetup = false;
    paintGate();
    toast("Archivo cifrado cargado. Introduce tu contraseña.");
  } catch {
    paintGate("Ese archivo no es un gastos.enc válido.");
  }
}

async function onImportPicked(file) {
  if (!file || !state.session) return;
  const ok = await ask({
    title: "Sustituir los gastos",
    text: "El Excel sustituye los gastos de esta sesión y la copia cifrada de este navegador. El archivo publicado no cambia hasta que descargues uno nuevo.",
    confirm: "Sustituir",
    danger: true,
  });
  if (!ok) return;
  try {
    const dataset = await readDatasetFile(file);
    const backup = structuredClone(state.session.dataset);
    const previousMonth = state.summary?.monthly || 0;
    const previousYear = state.summary?.yearlySheet || 0;
    state.session.dataset = dataset;
    if (!(await persist())) {
      state.session.dataset = backup;
      return;
    }
    state.prevMonthly = previousMonth;
    state.prevYearly = previousYear;
    paint();
    toast("Excel importado. Los totales ya están recalculados.");
  } catch (error) {
    toast(error.message || "No se ha podido importar.");
  }
}

function bind() {
  const app = document.getElementById("app");
  app.addEventListener("submit", onSubmit);
  app.addEventListener("click", onClick);
  app.addEventListener("input", (event) => {
    if (event.target.id === "setup-file") {
      const name = document.getElementById("setup-file-name");
      if (name) name.textContent = event.target.files?.[0]?.name || "Hoja con columnas Servicio, Coste / mes y Coste / año.";
    }
    if (event.target.closest("#expense-form")) updatePreview();
  });
  app.addEventListener("change", (event) => {
    if (event.target.id === "enc-file") {
      onEncPicked(event.target.files?.[0]);
      event.target.value = "";
    }
    if (event.target.id === "import-xlsx") {
      onImportPicked(event.target.files?.[0]);
      event.target.value = "";
    }
    if (event.target.id === "setup-file") {
      const name = document.getElementById("setup-file-name");
      if (name) name.textContent = event.target.files?.[0]?.name || "Hoja con columnas Servicio, Coste / mes y Coste / año.";
    }
    if (event.target.name === "basis") updatePreview();
  });
  ["pointerdown", "keydown", "touchstart", "scroll"].forEach((type) => {
    window.addEventListener(type, poke, { passive: true });
  });
  window.setInterval(() => {
    if (state.session && Date.now() - state.lastActivity >= IDLE_MS) lock();
  }, 10000);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener?.("change", () => {
    if (themeMode() === "system") applyTheme("system");
  });
  document.getElementById("modal").addEventListener("click", (event) => {
    if (event.target.id === "modal" && !event.target.querySelector("#expense-form, form[method='dialog']")?.contains(event.target)) {
      if (event.target === document.getElementById("modal")) closeModal();
    }
  });
  document.getElementById("modal").addEventListener("click", (event) => {
    if (event.target === document.getElementById("modal")) closeModal();
  });
}

async function main() {
  bootShell();
  bind();
  state.vault = loadVault();
  state.remote = await loadRemote();
  paintGate(state.remote?.invalid ? "" : "");
}

main();
