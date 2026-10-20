/* Интерфейс приложения «Брони и гости». Все данные хранятся только в этом телефоне (IndexedDB). */
(function () {
  "use strict";
  const K = window.KCore;
  const VERSION = "1.0.0";

  // ------------------------------------------------------------------ утилиты
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = (n) => (n === null || n === undefined || Number.isNaN(n) ? "–" : Math.round(n).toLocaleString("ru-RU"));
  const dec = (n) => (n === null || n === undefined ? "–" : String(Math.round(n * 10) / 10).replace(".", ","));
  const pct = (x) => (x === null || x === undefined ? "–" : Math.round(x * 100) + "%");
  const fd = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : "–");
  const fds = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}` : "–");
  const digits = (p) => (p || "").replace(/\D/g, "");
  const fphone = (p) => { const d = digits(p); return d.length === 11 ? `+${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9)}` : p || ""; };
  const MONTH_NOM = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  const MONTH_SHORT = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
  function plural(n, one, few, many) { const a = Math.abs(n) % 100, b = a % 10; if (a > 10 && a < 20) return many; if (b > 1 && b < 5) return few; if (b === 1) return one; return many; }
  const visitsW = (n) => `${n} ${plural(n, "визит", "визита", "визитов")}`;
  const daysW = (n) => `${n} ${plural(n, "день", "дня", "дней")}`;
  function toast(msg, ms = 2600) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms); }
  const ICON = {
    wa: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.8-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>',
    tel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
    mark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  };

  // ------------------------------------------------------------------ хранилище
  const DB = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => {
        const r = indexedDB.open("karaoke-guests", 1);
        r.onupgradeneeded = () => {
          const d = r.result;
          d.createObjectStore("files", { keyPath: "key" });
          d.createObjectStore("contacts", { keyPath: "id", autoIncrement: true });
          d.createObjectStore("meta", { keyPath: "k" });
        };
        r.onsuccess = () => { this.db = r.result; res(this.db); };
        r.onerror = () => rej(r.error);
      });
    },
    async tx(store, mode, fn) {
      const d = await this.open();
      return new Promise((res, rej) => {
        const t = d.transaction(store, mode), s = t.objectStore(store);
        const out = fn(s);
        t.oncomplete = () => res(out && "result" in out ? out.result : undefined);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    },
    all(store) { return this.tx(store, "readonly", (s) => s.getAll()); },
    put(store, v) { return this.tx(store, "readwrite", (s) => s.put(v)); },
    del(store, k) { return this.tx(store, "readwrite", (s) => s.delete(k)); },
    clear(store) { return this.tx(store, "readwrite", (s) => s.clear()); },
    async meta(k, v) {
      if (v === undefined) { const all = await this.all("meta"); const x = all.find((m) => m.k === k); return x ? x.v : undefined; }
      return this.put("meta", { k, v });
    },
  };

  // ------------------------------------------------------------------ состояние
  const st = {
    tab: "lists", list: "risk", shown: 50, gshown: 50,
    files: [], contacts: [], B: null, A: null, L: null, P: null, lastC: new Map(), byPhone: new Map(),
    q: "", f: { bMin: "", bMax: "", gMin: "", gMax: "", branch: "", status: "", nb: "", from: "", to: "", noBlack: false, sort: "bookings" },
    showFilters: false, dashMode: "bookings", who: "",
  };

  async function loadAll() {
    try { st.files = await DB.all("files"); st.contacts = await DB.all("contacts"); st.who = (await DB.meta("who")) || ""; }
    catch (e) { st.files = []; st.contacts = []; toast("Не удалось открыть хранилище телефона: " + e.message, 5000); }
    recompute();
  }
  function recompute() {
    if (!st.files.length) { st.B = st.A = st.L = st.P = null; st.byPhone = new Map(); }
    else {
      st.B = K.buildBookings(st.files.map((f) => ({ name: f.name, info: f.info, sheets: f.sheets })));
      st.A = K.analyze(st.B.bookings);
      st.L = K.lists(st.A);
      st.P = null;
      st.byPhone = new Map(st.A.profiles.map((p) => [p.phone, p]));
    }
    st.lastC = new Map();
    for (const c of st.contacts.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id))) st.lastC.set(c.phone, c);
  }

  // ------------------------------------------------------------------ навигация
  const TITLES = { lists: "Списки", guests: "Гости", dash: "Цифры", files: "Файлы" };
  function setTab(t) {
    st.tab = t;
    document.querySelectorAll(".tabbar button").forEach((b) => b.setAttribute("aria-current", b.dataset.tab === t ? "page" : "false"));
    render();
    window.scrollTo(0, 0);
  }
  $("#tabbar").addEventListener("click", (e) => { const b = e.target.closest("button[data-tab]"); if (b) setTab(b.dataset.tab); });

  function render() {
    $("#title").textContent = TITLES[st.tab];
    $("#asof").textContent = st.A ? `Данные по ${fd(st.A.asOf)} · ${nf(st.A.profiles.length)} гостей` : "Данных пока нет";
    const v = $("#view");
    if (!st.A && st.tab !== "files") { v.innerHTML = emptyState(); return; }
    if (st.tab === "lists") v.innerHTML = viewLists();
    else if (st.tab === "guests") v.innerHTML = viewGuests();
    else if (st.tab === "dash") { v.innerHTML = viewDash(); drawCharts(); }
    else v.innerHTML = viewFiles();
  }
  function emptyState() {
    return `<div class="empty"><b>Загрузите таблицы броней</b>Файлы вида «Бронь_Октябрь_Абая_2026.xlsx». Всё считается прямо в телефоне, данные никуда не отправляются.</div>
      <button class="btn primary" data-act="gofiles">Перейти к файлам</button>`;
  }

  // ------------------------------------------------------------------ карточка гостя
  const STATUS_CLASS = { "Новый постоянный": "st-new", "Активный постоянный": "st-act", "Под риском": "st-risk", "Ушёл": "st-lost", "На пороге": "st-thr" };
  const pill = (s) => `<span class="pill ${STATUS_CLASS[s] || "st-other"}">${esc(s)}</span>`;
  function contactLine(phone) {
    const c = st.lastC.get(phone);
    if (!c) return "";
    const back = st.A ? K.backAfter(c, st.A) : null;
    const res = back ? (back.kind === "visit" ? ` · <span class="back">пришёл ${fds(back.date)}</span>` : ` · <span class="back">бронь на ${fds(back.date)}</span>`) : "";
    return `<div class="contact">Связались ${fds(c.date)}${c.who ? " (" + esc(c.who) + ")" : ""}${c.note ? ": " + esc(c.note) : ""}${res}</div>`;
  }
  function guestCard(p, ctx) {
    const facts = [];
    if (ctx === "top") facts.push(`<span>оценка <b>${nf(p.score)}</b></span>`);
    if (ctx === "soon") facts.push(`<span><b>ДР ${fds(p.nextBirthday)}</b> · ${p.inDays === 0 ? "сегодня" : "через " + daysW(p.inDays)}</span>`);
    facts.push(`<span>${visitsW(p.visits)}</span>`);
    if (p.medG) facts.push(`<span>обычно ${dec(p.medG)} чел.</span>`);
    facts.push(`<span class="m">был ${p.since === 0 ? "сегодня" : daysW(p.since) + " назад"}</span>`);
    if ((ctx === "risk" || ctx === "lost") && p.rhythm) facts.push(`<span class="m">обычно раз в ${daysW(p.rhythm)}</span>`);
    facts.push(`<span class="m">${esc(p.mainBranch)}</span>`);
    const fut = p.futureDate ? `<div class="contact">Уже есть бронь на ${fds(p.futureDate)}</div>` : "";
    const warn = p.notes ? `<div class="warnline">${esc(p.notes)}</div>` : "";
    const d = digits(p.phone);
    return `<article class="card g-card" data-act="open" data-phone="${esc(p.phone)}">
      <div class="g-head"><div><div class="g-name">${esc(p.name || "Без имени")}</div><div class="g-phone">${esc(fphone(p.phone))}</div></div>${pill(p.status)}</div>
      <div class="facts">${facts.join("")}</div>${fut}${contactLine(p.phone)}${warn}
      <div class="actions">
        <a class="btn wa" href="https://wa.me/${d}" target="_blank" rel="noopener" data-stop>${ICON.wa}WhatsApp</a>
        <a class="btn" href="tel:+${d}" data-stop>${ICON.tel}Звонок</a>
        <button class="btn" data-act="mark" data-phone="${esc(p.phone)}" data-list="${esc(ctx || "")}">${ICON.mark}Отметить</button>
      </div></article>`;
  }

  // ------------------------------------------------------------------ вкладка «Списки»
  const LISTS = [
    ["risk", "Под риском", "Давно не были по меркам своего ритма, но ещё не ушли. Сначала те, у кого пауза больше всего превышает обычную."],
    ["lost", "Ушли", "Были постоянными и давно не приходят. Сначала те, у кого больше визитов."],
    ["newReg", "Новые", `Стали постоянными за последние ${K.S.NEW_REGULAR_DAYS} дней. Хороший момент поблагодарить.`],
    ["threshold", "На пороге", `2 и более визита, ещё не постоянные, были за последние ${K.S.THRESHOLD_DAYS} дней. Можно подтолкнуть к следующему визиту.`],
    ["top", "Топ-100", `Ходят часто и большими компаниями: от ${K.S.TOP_MIN_VISITS} визитов, оценка = визиты × обычный размер компании.`],
    ["soon", "ДР скоро", `День рождения в ближайшие ${K.S.BIRTHDAY_AHEAD_DAYS} дней — по дате прошлогодней брони на ДР. Напомните и предложите забронировать.`],
    ["results", "Результаты", "Сколько гостей вернулись после контакта."],
  ];
  const LIST_LABEL = { risk: "Под риском", lost: "Ушли", newReg: "Новые постоянные", threshold: "На пороге", top: "Топ-100", soon: "ДР скоро" };
  function listData(k) { return k === "top" ? st.L.top : k === "soon" ? st.L.soon : st.L[k] || []; }
  function viewLists() {
    const chips = LISTS.map(([k, t]) => `<button class="chip" data-act="list" data-k="${k}" aria-pressed="${st.list === k}">${t}${k !== "results" ? `<b>${nf(listData(k).length)}</b>` : ""}</button>`).join("");
    const desc = LISTS.find((x) => x[0] === st.list)[2];
    let body;
    if (st.list === "results") body = viewResults();
    else {
      const items = listData(st.list);
      if (!items.length) body = st.list === "soon" ? soonEmpty() : `<div class="empty">В этом списке сейчас никого нет.</div>`;
      else {
        body = `<div class="list">${items.slice(0, st.shown).map((p) => guestCard(p, st.list)).join("")}</div>` +
          (items.length > st.shown ? `<button class="btn more" data-act="more">Показать ещё (${nf(items.length - st.shown)})</button>` : "") +
          `<button class="btn" data-act="exportList">Поделиться списком (Excel)</button>`;
      }
    }
    return `<div class="seg">${chips}</div><p class="lead">${desc}</p>${body}`;
  }
  function soonEmpty() {
    const firsts = st.A.past.filter((b) => K.isBirthday(b.tags)).map((b) => b.date).sort();
    let when = "";
    if (firsts.length) when = ` Первые напоминания появятся около ${fd(K.addDays(K.addDays(firsts[0], 365), -K.S.BIRTHDAY_AHEAD_DAYS))}.`;
    return `<div class="empty"><b>Пока пусто</b>Список строится по броням на ДР год назад, а в загруженных файлах их ещё нет на эти даты.${when} Если загрузить файлы за прошлые годы, список заполнится сразу.</div>`;
  }
  function viewResults() {
    const R = K.contactResults(st.contacts, st.A).filter((r) => r.n > 0);
    if (!R.length) return `<div class="empty"><b>Отметок пока нет</b>Нажимайте «Отметить» на карточке гостя после звонка или сообщения. Здесь появится, сколько из них вернулись.</div>`;
    const tot = R.reduce((a, r) => ({ n: a.n + r.n, back: a.back + r.back, booked: a.booked + r.booked, fresh: a.fresh + r.fresh }), { n: 0, back: 0, booked: 0, fresh: 0 });
    const rows = R.map((r) => `<tr><td>${esc(r.list)}</td><td>${nf(r.n)}</td><td>${nf(r.back)}</td><td>${pct(r.rate)}</td><td>${nf(r.booked)}</td><td>${nf(r.fresh)}</td></tr>`).join("");
    return `<div class="card"><div class="tw"><table><thead><tr><th>Список</th><th>Связались</th><th>Вернулись</th><th>Доля</th><th>Есть бронь</th><th>Меньше 30 дн. назад</th></tr></thead>
      <tbody>${rows}<tr><td><b>Всего</b></td><td><b>${nf(tot.n)}</b></td><td><b>${nf(tot.back)}</b></td><td><b>${pct(tot.n ? tot.back / tot.n : null)}</b></td><td><b>${nf(tot.booked)}</b></td><td><b>${nf(tot.fresh)}</b></td></tr></tbody></table></div>
      <p class="lead">Вернулся — после даты контакта у гостя была бронь. Если связывались несколько раз из одного списка, считается последний контакт. Тем, с кем связались недавно, ещё рано возвращаться.</p></div>
      <button class="btn" data-act="journal">Все отметки (${nf(st.contacts.length)})</button>`;
  }

  // ------------------------------------------------------------------ вкладка «Гости»
  function filtered() {
    const f = st.f, q = st.q.trim().toLowerCase(), qd = q.replace(/\D/g, "");
    const n = (x) => (x === "" ? null : Number(x));
    const bMin = n(f.bMin), bMax = n(f.bMax), gMin = n(f.gMin), gMax = n(f.gMax);
    let r = st.A.profiles.filter((p) =>
      (!q || (p.name || "").toLowerCase().includes(q) || (qd.length >= 3 && digits(p.phone).includes(qd))) &&
      (bMin === null || p.nBookings >= bMin) && (bMax === null || p.nBookings <= bMax) &&
      ((gMin === null && gMax === null) || (p.medG !== null && (gMin === null || p.medG >= gMin) && (gMax === null || p.medG <= gMax))) &&
      (!f.branch || p.branchList.includes(f.branch)) && (!f.status || p.status === f.status) &&
      (!f.nb || (f.nb === "1" ? p.branchList.length === 1 : p.branchList.length >= 2)) &&
      (!f.from || p.last >= f.from) && (!f.to || p.last <= f.to) && (!f.noBlack || !p.black));
    const S = {
      bookings: (a, b) => b.nBookings - a.nBookings || (a.last < b.last ? 1 : -1),
      last: (a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0),
      group: (a, b) => (b.medG || 0) - (a.medG || 0) || b.nBookings - a.nBookings,
      name: (a, b) => (a.name || "").localeCompare(b.name || "", "ru"),
    };
    return r.sort(S[f.sort] || S.bookings);
  }
  function viewGuests() {
    const r = filtered();
    const branches = [...new Set(st.A.past.map((b) => b.branch))].sort();
    const statuses = ["Новый постоянный", "Активный постоянный", "Под риском", "Ушёл", "На пороге", "Бывали, давно не было", "Разовый"];
    const f = st.f;
    const active = Object.entries(f).filter(([k, v]) => k !== "sort" && v !== "" && v !== false).length;
    const sel = (id, opts, val) => `<select id="${id}">${opts.map(([v, t]) => `<option value="${esc(v)}"${v === val ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
    const filters = st.showFilters ? `<div class="card"><div class="filters">
      <label>Броней от<input id="f-bMin" type="number" inputmode="numeric" min="1" value="${esc(f.bMin)}" placeholder="любое"></label>
      <label>до<input id="f-bMax" type="number" inputmode="numeric" min="1" value="${esc(f.bMax)}" placeholder="любое"></label>
      <label>Гостей в брони от<input id="f-gMin" type="number" inputmode="numeric" min="1" value="${esc(f.gMin)}" placeholder="любое"></label>
      <label>до<input id="f-gMax" type="number" inputmode="numeric" min="1" value="${esc(f.gMax)}" placeholder="любое"></label>
      <label>Филиал${sel("f-branch", [["", "Любой"], ...branches.map((b) => [b, b])], f.branch)}</label>
      <label>Был в филиалах${sel("f-nb", [["", "Любое число"], ["1", "Только в одном"], ["2", "В двух и больше"]], f.nb)}</label>
      <label class="wide">Статус${sel("f-status", [["", "Любой"], ...statuses.map((s) => [s, s])], f.status)}</label>
      <label>Последний визит с<input id="f-from" type="date" value="${esc(f.from)}"></label>
      <label>по<input id="f-to" type="date" value="${esc(f.to)}"></label>
      <label class="wide">Сортировка${sel("f-sort", [["bookings", "Больше броней"], ["last", "Недавно были"], ["group", "Большие компании"], ["name", "По имени"]], f.sort)}</label>
      <label class="check wide"><input id="f-noBlack" type="checkbox"${f.noBlack ? " checked" : ""}>Без «чс»</label>
      </div><button class="btn" data-act="resetF" style="margin-top:10px">Сбросить фильтры</button></div>` : "";
    return `<div class="search"><input id="q" type="search" placeholder="Телефон или имя" value="${esc(st.q)}" autocomplete="off"><button class="btn" data-act="toggleF">Фильтры${active ? " · " + active : ""}</button></div>
      ${filters}<div class="sum">Найдено ${nf(r.length)} из ${nf(st.A.profiles.length)} · броней у них ${nf(r.reduce((s, p) => s + p.nBookings, 0))}</div>
      <div class="list">${r.slice(0, st.gshown).map((p) => guestCard(p, "")).join("")}</div>
      ${r.length > st.gshown ? `<button class="btn more" data-act="gmore">Показать ещё (${nf(r.length - st.gshown)})</button>` : ""}
      ${r.length ? `<button class="btn" data-act="exportGuests">Поделиться найденными (Excel)</button>` : ""}`;
  }

  // ------------------------------------------------------------------ карточка гостя (подробно)
  function openGuest(phone) {
    const p = st.byPhone.get(phone);
    if (!p) return;
    const d = digits(phone);
    const cs = st.contacts.filter((c) => c.phone === phone).sort((a, b) => (a.date < b.date ? 1 : -1));
    const hist = p.bookings.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((b) => `<div class="row">
      <div class="d">${fd(b.date)} ${esc(b.wd)} · ${esc(b.branch)}${b.place ? " · " + esc(b.place) : ""}</div>
      <div>${b.cnt ? b.cnt + " чел." : b.rng ? esc(b.rng) + " чел." : "число гостей не указано"} · ${esc(b.tags.join(", "))}${b.srcMain ? " · " + esc(b.srcMain) : ""}</div>
      ${b.note ? `<div class="n">${esc(b.note)}</div>` : ""}${b.gift ? `<div class="n">Подарок: ${esc(b.gift)}</div>` : ""}</div>`).join("");
    const fut = st.A.active.filter((b) => b.phone === phone && b.date > st.A.asOf).map((b) => `${fd(b.date)} · ${esc(b.branch)}`).join("<br>");
    const kv = (l, v) => `<div><div class="l">${l}</div><div class="v">${v}</div></div>`;
    sheet(`<div class="sheet-h"><div><h2>${esc(p.name || "Без имени")}</h2><div class="g-phone">${esc(fphone(phone))}</div></div><button class="x" data-act="close" aria-label="Закрыть">×</button></div>
      <div>${pill(p.status)}</div>
      ${p.notes ? `<div class="warnline">${esc(p.notes)}</div>` : ""}
      <div class="actions"><a class="btn wa" href="https://wa.me/${d}" target="_blank" rel="noopener">${ICON.wa}WhatsApp</a><a class="btn" href="tel:+${d}">${ICON.tel}Звонок</a><button class="btn primary" data-act="mark" data-phone="${esc(phone)}" data-list="">${ICON.mark}Отметить</button></div>
      <div class="card"><div class="grid2">
        ${kv("Броней", nf(p.nBookings))}${kv("Визитов (дней)", nf(p.visits))}
        ${kv("Первый визит", fd(p.first))}${kv("Последний визит", fd(p.last))}
        ${kv("Обычно приходит раз в", p.rhythm ? daysW(p.rhythm) : "–")}${kv("Стал постоянным", p.became ? fd(p.became) : "–")}
        ${kv("Гостей в брони обычно", p.medG ? dec(p.medG) : "–")}${kv("Максимум гостей", p.maxG ? nf(p.maxG) : "–")}
        ${kv("Филиалы", esc(p.branches))}${kv("Откуда узнал", esc(p.firstSource || "–"))}
      </div></div>
      ${fut ? `<div class="card"><h3>Будущие брони</h3><div>${fut}</div></div>` : ""}
      <div class="card"><h3>Контакты</h3>${cs.length ? cs.map((c) => `<div class="contact">${fd(c.date)}${c.who ? " · " + esc(c.who) : ""}${c.list ? " · " + esc(c.list) : ""}${c.note ? "<br>" + esc(c.note) : ""}
        <br><button class="btn danger" style="min-height:30px;padding:4px 10px;margin-top:6px;font-size:13px" data-act="delC" data-id="${c.id}">Удалить отметку</button></div>`).join("") : '<div class="lead">Отметок пока нет.</div>'}</div>
      <div class="card"><h3>История броней</h3><div class="hist">${hist}</div></div>`);
  }

  // ------------------------------------------------------------------ отметка о контакте
  function openMark(phone, listKey) {
    const p = st.byPhone.get(phone);
    const list = LIST_LABEL[listKey] || listFromStatus(p && p.status);
    sheet(`<div class="sheet-h"><div><h2>Отметить контакт</h2><div class="g-phone">${esc(p ? p.name : "")} · ${esc(fphone(phone))}</div></div><button class="x" data-act="close" aria-label="Закрыть">×</button></div>
      <form class="form" id="markForm" data-phone="${esc(phone)}">
        <label>Дата<input name="date" type="date" value="${K.todayStr()}" required></label>
        <label>Кто связался<input name="who" value="${esc(st.who)}" placeholder="Имя администратора"></label>
        <label>Ответ / комментарий<textarea name="note" placeholder="Например: обещал прийти в пятницу"></textarea></label>
        <label>Список<select name="list">${["Под риском", "Ушли", "Новые постоянные", "На пороге", "Топ-100", "ДР скоро", "Другое"].map((l) => `<option${l === list ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        <button class="btn primary" type="submit">Сохранить</button>
      </form>`);
  }
  function listFromStatus(s) { return { "Под риском": "Под риском", "Ушёл": "Ушли", "Новый постоянный": "Новые постоянные", "На пороге": "На пороге" }[s] || "Другое"; }
  async function saveMark(form) {
    const fd2 = new FormData(form);
    const c = { phone: form.dataset.phone, date: fd2.get("date") || K.todayStr(), who: (fd2.get("who") || "").trim(), note: (fd2.get("note") || "").trim(), list: fd2.get("list"), created: Date.now() };
    const p = st.byPhone.get(c.phone); c.name = p ? p.name : "";
    try { await DB.put("contacts", c); if (c.who) { st.who = c.who; await DB.meta("who", c.who); } }
    catch (e) { toast("Не удалось сохранить: " + e.message, 5000); return; }
    st.contacts = await DB.all("contacts");
    recompute(); closeSheet(); render(); toast("Отметка сохранена");
  }
  function openJournal() {
    const rows = st.contacts.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((c) => {
      const back = K.backAfter(c, st.A);
      return `<div class="row" data-act="open" data-phone="${esc(c.phone)}"><div class="d">${fd(c.date)} · ${esc(c.name || fphone(c.phone))}</div>
        <div class="n">${esc(c.list || "")}${c.who ? " · " + esc(c.who) : ""}${c.note ? " · " + esc(c.note) : ""}</div>
        ${back ? `<div class="contact"><span class="back">${back.kind === "visit" ? "пришёл " + fds(back.date) : "бронь на " + fds(back.date)}</span></div>` : ""}</div>`;
    }).join("");
    sheet(`<div class="sheet-h"><h2>Все отметки</h2><button class="x" data-act="close" aria-label="Закрыть">×</button></div><div class="card"><div class="hist">${rows}</div></div>`);
  }

  // ------------------------------------------------------------------ шторка
  function sheet(html) {
    $("#layer").innerHTML = `<div class="sheet-bg" data-act="bg"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
    document.body.style.overflow = "hidden";
  }
  function closeSheet() { $("#layer").innerHTML = ""; document.body.style.overflow = ""; }

  // ------------------------------------------------------------------ вкладка «Цифры»
  function viewDash() {
    const A = st.A;
    if (!st.P) st.P = K.promos(A);
    const counted = A.past.filter((b) => b.cnt);
    const regs = A.profiles.filter((p) => ["Новый постоянный", "Активный постоянный", "Под риском"].includes(p.status)).length;
    const months = K.monthly(A);
    const branches = [...new Set(A.past.map((b) => b.branch))].sort();
    const brTot = branches.map((b) => { const x = A.past.filter((r) => r.branch === b); return { b, n: x.length, g: x.reduce((s, r) => s + (r.cnt || 0), 0) }; });
    const P = st.P, gen = P.find((r) => r.promo === "Общие условия");
    const dr = P.find((r) => r.promo === "День рождения");
    const promoRows = P.map((r) => `<tr><td>${esc(r.promo)}</td><td>${nf(r.n)}</td><td>${pct(r.share)}</td><td>${r.medG === null ? "–" : dec(r.medG)}</td><td>${r.disc === null ? "–" : nf(r.disc) + "%"}</td><td>${pct(r.wk)}</td><td>${nf(r.newG)}</td><td>${r.newG ? pct(r.ret) : "–"}</td></tr>`).join("");
    return `<div class="kpis">
      <div class="kpi"><div class="l">Броней</div><div class="v">${nf(A.past.length)}</div><div class="n">${fd(A.firstData)} – ${fd(A.asOf)}</div></div>
      <div class="kpi"><div class="l">Гостей в бронях</div><div class="v">${nf(counted.reduce((s, b) => s + b.cnt, 0))}</div><div class="n">где указано число (${pct(counted.length / A.past.length)})</div></div>
      <div class="kpi"><div class="l">Гостей в базе</div><div class="v">${nf(A.profiles.length)}</div><div class="n">разных телефонов</div></div>
      <div class="kpi"><div class="l">Постоянных сейчас</div><div class="v">${nf(regs)}</div><div class="n">новые, активные и под риском</div></div></div>
      <h2>По месяцам</h2>
      <div class="card"><div class="seg" style="margin:0;padding:0"><button class="chip" data-act="dmode" data-k="bookings" aria-pressed="${st.dashMode === "bookings"}">Брони</button><button class="chip" data-act="dmode" data-k="guests" aria-pressed="${st.dashMode === "guests"}">Гости</button></div>
        <div class="legend">${branches.map((b, i) => `<span><i style="background:var(--c${(i % 3) + 1})"></i>${esc(b)}</span>`).join("")}</div>
        <div class="chart" id="chMonths"></div><div class="cap sum">Нажмите на столбик, чтобы увидеть цифры.</div>
        <p class="lead">${st.dashMode === "guests" ? "Гости считаются там, где в брони указано число. " : ""}Последний месяц может быть неполным. Отмены и квизы не учитываются.</p></div>
      <div class="card"><div class="tw"><table><thead><tr><th>Филиал</th><th>Броней</th><th>Доля</th><th>Гостей</th></tr></thead><tbody>
        ${brTot.map((x) => `<tr><td>${esc(x.b)}</td><td>${nf(x.n)}</td><td>${pct(x.n / A.past.length)}</td><td>${nf(x.g)}</td></tr>`).join("")}</tbody></table></div></div>
      <h2>Акции</h2>
      ${dr && gen ? `<p class="lead">День рождения — ${pct(dr.share)} броней, компания обычно ${dec(dr.medG)} чел. против ${dec(gen.medG)} по общим условиям.</p>` : ""}
      <div class="card"><h3>Брони по акциям</h3><div class="chart" id="chPromo"></div></div>
      <div class="card"><h3>Дни недели: ДР против общих условий</h3><div class="legend"><span><i style="background:var(--c1)"></i>День рождения</span><span><i style="background:var(--cm)"></i>Общие условия</span></div><div class="chart" id="chWd"></div><div class="cap sum">Нажмите на столбик, чтобы увидеть цифры.</div><p class="lead">Доля броней группы, которая приходится на этот день.</p></div>
      <div class="card"><h3>Возвращаются ли новые гости</h3><div class="chart" id="chRet"></div><p class="lead">Новые гости (не «были ранее»), пришедшие не позже ${fd(K.addDays(A.asOf, -K.S.RETURN_WINDOW))}: доля пришедших снова в течение ${K.S.RETURN_WINDOW} дней, по акции первого визита. Акции, где таких гостей от 20.</p></div>
      <div class="card"><h3>Все акции</h3><div class="tw"><table><thead><tr><th>Акция</th><th>Броней</th><th>Доля</th><th>Обычно гостей</th><th>Скидка</th><th>ПТ–СБ</th><th>Новых гостей</th><th>Вернулись за ${K.S.RETURN_WINDOW} дн.</th></tr></thead><tbody>${promoRows}</tbody></table></div>
      <p class="lead">Акция определяется по примечанию администратора («др», «тдр», «кл», «кк», «вип», «афт», «общ усл»…). Выручки в бронях нет, поэтому сравнение по броням, компаниям и возврату.</p></div>`;
  }
  function svgEl(w, h) { return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img">`; }
  function drawCharts() {
    const A = st.A, P = st.P;
    // по месяцам
    const box = $("#chMonths");
    if (box) {
      const months = K.monthly(A), branches = [...new Set(A.past.map((b) => b.branch))].sort();
      const key = st.dashMode === "guests" ? "guests" : "bookings";
      const W = Math.max(300, box.clientWidth), H = 220, mt = 8, mb = 22;
      const tot = months.map((m) => branches.reduce((s, b) => s + ((m.br[b] || {})[key] || 0), 0));
      const max = Math.max(1, ...tot), nice = niceMax(max), ml = 8 + String(nf(nice)).length * 7;
      const n = months.length, step = (W - ml - 4) / Math.max(1, n), bw = Math.max(4, Math.min(34, step * 0.7));
      const y = (v) => H - mb - (v / nice) * (H - mt - mb);
      let s = svgEl(W, H);
      for (let i = 0; i <= 4; i++) { const v = (nice / 4) * i; s += `<line x1="${ml}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${ml - 5}" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="var(--muted)">${nf(v)}</text>`; }
      months.forEach((m, i) => {
        let acc = 0; const x = ml + step * i + (step - bw) / 2;
        const label = `${MONTH_NOM[+m.month.slice(5, 7) - 1]} ${m.month.slice(0, 4)}: ` + branches.map((b) => `${b} ${nf((m.br[b] || {})[key] || 0)}`).join(", ") + ` · всего ${nf(tot[i])}`;
        branches.forEach((b, j) => { const v = (m.br[b] || {})[key] || 0; if (!v) return; s += `<rect x="${x}" y="${y(acc + v)}" width="${bw}" height="${y(acc) - y(acc + v)}" fill="var(--c${(j % 3) + 1})" data-act="bar" data-t="${esc(label)}"></rect>`; acc += v; });
        const every = n > 14 ? Math.ceil(n / 12) : 1;
        if (i % every === 0) s += `<text x="${x + bw / 2}" y="${H - 6}" font-size="11" text-anchor="middle" fill="var(--muted)">${MONTH_SHORT[+m.month.slice(5, 7) - 1]}${n > 12 && m.month.slice(5, 7) === "01" ? " " + m.month.slice(2, 4) : ""}</text>`;
      });
      box.innerHTML = s + "</svg>";
    }
    const hbar = (id, rows, ref) => {
      const el = $("#" + id); if (!el) return;
      const W = Math.max(300, el.clientWidth), rh = 26, H = rows.length * rh + 6;
      const lw = Math.min(W * 0.46, 168), vw = 62, max = Math.max(1, ...rows.map((r) => r.v), ref || 0);
      const x = (v) => lw + (v / max) * (W - lw - vw);
      let s = svgEl(W, H);
      rows.forEach((r, i) => {
        const yy = i * rh + 4;
        const lab = r.l.length > 22 ? r.l.slice(0, 21) + "…" : r.l;
        s += `<text x="0" y="${yy + 15}" font-size="12" fill="var(--ink)">${esc(lab)}</text><rect x="${lw}" y="${yy + 3}" width="${Math.max(2, x(r.v) - lw)}" height="16" rx="4" fill="${r.c}"/><text x="${x(r.v) + 5}" y="${yy + 15}" font-size="12" fill="var(--muted)">${esc(r.t)}</text>`;
      });
      if (ref) s += `<line x1="${x(ref)}" x2="${x(ref)}" y1="0" y2="${H}" stroke="var(--muted)" stroke-dasharray="4 3"/>`;
      el.innerHTML = s + "</svg>";
    };
    const col = (r) => (r.kind === "base" ? "var(--cm)" : r.kind === "card" ? "var(--c2)" : "var(--c1)");
    hbar("chPromo", P.map((r) => ({ l: r.promo, v: r.n, t: nf(r.n), c: col(r) })));
    hbar("chRet", P.filter((r) => r.newG >= 20).sort((a, b) => b.ret - a.ret).map((r) => ({ l: r.promo, v: r.ret, t: `${pct(r.ret)} из ${nf(r.newG)}`, c: col(r) })));
    // дни недели
    const wd = $("#chWd");
    if (wd) {
      const dr = P.find((r) => r.promo === "День рождения"), gen = P.find((r) => r.promo === "Общие условия");
      if (!dr || !gen) { wd.innerHTML = '<div class="lead">Недостаточно данных.</div>'; return; }
      const sh = (r, d) => (r.wday[d] || 0) / r.n;
      const W = Math.max(300, wd.clientWidth), H = 180, mt = 8, mb = 22, ml = 34;
      const max = Math.max(...K.WEEKDAYS.map((d) => Math.max(sh(dr, d), sh(gen, d)))), nice = Math.ceil(max * 10) / 10;
      const y = (v) => H - mb - (v / nice) * (H - mt - mb), step = (W - ml - 4) / 7, bw = Math.min(16, step * 0.34);
      let s = svgEl(W, H);
      for (let i = 0; i <= 2; i++) { const v = (nice / 2) * i; s += `<line x1="${ml}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${ml - 5}" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="var(--muted)">${Math.round(v * 100)}%</text>`; }
      K.WEEKDAYS.forEach((d, i) => {
        const cx = ml + step * i + step / 2;
        s += `<rect x="${cx - bw - 1}" y="${y(sh(dr, d))}" width="${bw}" height="${y(0) - y(sh(dr, d))}" rx="3" fill="var(--c1)" data-act="bar" data-t="${d}: ДР ${pct(sh(dr, d))}, общие условия ${pct(sh(gen, d))}"></rect>`;
        s += `<rect x="${cx + 1}" y="${y(sh(gen, d))}" width="${bw}" height="${y(0) - y(sh(gen, d))}" rx="3" fill="var(--cm)" data-act="bar" data-t="${d}: ДР ${pct(sh(dr, d))}, общие условия ${pct(sh(gen, d))}"></rect>`;
        s += `<text x="${cx}" y="${H - 6}" font-size="11" text-anchor="middle" fill="var(--muted)">${d}</text>`;
      });
      wd.innerHTML = s + "</svg>";
    }
  }
  function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p; return 10 * p; }

  // ------------------------------------------------------------------ вкладка «Файлы»
  let progress = [];
  let confirmKey = null;
  function viewFiles() {
    const files = st.files.slice().sort((a, b) => (a.key < b.key ? 1 : -1));
    const branches = [...new Set(files.map((f) => f.info.branch))].sort();
    const months = [...new Set(files.map((f) => `${f.info.year}-${String(f.info.month).padStart(2, "0")}`))].sort().reverse();
    const cover = files.length ? `<div class="card"><h3>Что загружено</h3><div class="cover" style="grid-template-columns:auto repeat(${branches.length},1fr)">
      <div></div>${branches.map((b) => `<div class="h">${esc(b)}</div>`).join("")}
      ${months.map((m) => `<div class="rl">${MONTH_SHORT[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}</div>` + branches.map((b) => { const f = files.find((x) => x.key === `${m}-${b}`); return f ? `<div class="c y">${nf(f.sheets.reduce((s, x) => s + x.recs.length, 0))}</div>` : `<div class="c">—</div>`; }).join("")).join("")}
      </div><p class="lead">В клетках — число броней в файле. Загрузите файл того же месяца и филиала ещё раз, и он заменит старый.</p></div>` : "";
    const list = files.map((f) => `<div class="row" style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--line)">
      <div style="min-width:0"><div style="font-weight:600">${MONTH_NOM[f.info.month - 1]} ${f.info.year} · ${esc(f.info.branch)}</div><div class="lead" style="font-size:13px">${daysW(f.sheets.length)} · ${nf(f.sheets.reduce((s, x) => s + x.recs.length, 0))} броней · загружен ${new Date(f.loadedAt).toLocaleDateString("ru-RU")}</div></div>
      ${confirmKey === f.key ? `<div class="confirm"><button class="btn danger" data-act="delFileYes" data-k="${esc(f.key)}">Удалить</button><button class="btn" data-act="delFileNo">Нет</button></div>` : `<button class="btn" data-act="delFile" data-k="${esc(f.key)}">Удалить</button>`}</div>`).join("");
    const B = st.B;
    const notes = B ? [
      ...st.files.flatMap((f) => (f.skipped || []).map((t) => `${esc(f.name)}: лист «${esc(t)}» не похож на день, пропущен`)),
      ...B.dups.map((d) => `${esc(d.key.replace("|", " "))}: два листа на одну дату, взят «${esc(d.taken)}»`),
      ...B.wdNotes.map(esc),
    ] : [];
    return `<div class="drop"><div style="font-weight:600">Загрузить таблицы броней</div>
        <div class="lead">Excel-файлы вида «Бронь_Октябрь_Абая_2026.xlsx», можно сразу несколько. Из Google Таблиц: Файл → Скачать → Microsoft Excel.</div>
        <label class="btn primary" style="width:100%">Выбрать файлы<input id="fileInput" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple hidden></label></div>
      ${progress.length ? `<div class="card prog">${progress.map((p) => `<div class="${p.cls || ""}">${esc(p.t)}</div>`).join("")}</div>` : ""}
      ${cover}
      ${files.length ? `<details${confirmKey && confirmKey !== "__all" ? " open" : ""}><summary>Список файлов (${files.length})</summary><div>${list}</div></details>` : ""}
      ${notes.length ? `<details><summary>Замечания по файлам (${notes.length})</summary><p class="lead">${notes.join("<br>")}</p></details>` : ""}
      <div class="card"><h3>Отметки обзвона</h3><p class="lead">Отметки хранятся только в этом телефоне. Сохраняйте копию время от времени, чтобы не потерять их при смене телефона.</p>
        <div class="actions"><button class="btn" data-act="backup">Сохранить копию</button><label class="btn">Восстановить<input id="restoreInput" type="file" accept=".json,application/json" hidden></label></div></div>
      <details><summary>Как пользоваться</summary><p class="lead">
        1. Скачайте месячные таблицы броней в Excel и загрузите их здесь. Повторная загрузка того же месяца и филиала заменяет старый файл.<br>
        2. «Списки» — кому написать: под риском, ушедшие, новые постоянные, на пороге, топ-100, ДР скоро. Нажмите «Отметить» после звонка или сообщения.<br>
        3. «Гости» — поиск по телефону и имени, фильтры по числу броней и размеру компании, история каждого гостя.<br>
        4. «Цифры» — брони и гости по месяцам и филиалам, анализ акций.<br>
        Гость определяется по телефону; брони квизов (Тезтап, Город перемен, Шоу Тудей, Квиз Плиз) не считаются; гости с пометкой «чс» не попадают в списки для обзвона.</p></details>
      ${files.length ? (confirmKey === "__all" ? `<div class="card confirm">Удалить все загруженные таблицы? Отметки обзвона останутся.<button class="btn danger" data-act="delAllYes">Удалить всё</button><button class="btn" data-act="delFileNo">Отмена</button></div>` : `<button class="btn danger" data-act="delAll">Удалить все таблицы из телефона</button>`) : ""}
      <p class="lead" style="text-align:center">Версия ${VERSION}</p>`;
  }

  function loadScript(src) { return new Promise((res, rej) => { if (window.XLSX) return res(); const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("не загрузилась библиотека " + src)); document.head.appendChild(s); }); }
  function parseInWorker(name, buf) {
    return new Promise((res) => {
      let w;
      try { w = new Worker("worker.js"); } catch (e) { return res(null); }
      const done = (x) => { try { w.terminate(); } catch (e) { } res(x); };
      w.onmessage = (e) => done(e.data);
      w.onerror = (e) => { e.preventDefault(); done({ ok: false, error: e.message || "ошибка чтения" }); };
      w.postMessage({ name, buf }, [buf]);
    });
  }
  async function parseOnMain(name, buf) {
    await loadScript("xlsx.full.min.js");
    const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellNF: true, cellDates: false, cellStyles: false, cellHTML: false, cellFormula: false, dense: true });
    const r = K.parseWorkbook(XLSX, wb, name);
    return r.error ? { ok: false, error: r.error } : { ok: true, r };
  }
  async function importFiles(list) {
    const files = [...list];
    progress = files.map((f) => ({ t: `${f.name} — ждёт`, cls: "" }));
    render();
    let okN = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const info = K.parseFileName(f.name);
      if (!info) { progress[i] = { t: `${f.name} — имя не похоже на «Бронь_Месяц_Филиал_Год.xlsx», пропущен`, cls: "er" }; render(); continue; }
      progress[i] = { t: `${f.name} — читаю…`, cls: "" }; render();
      try {
        const buf = await f.arrayBuffer();
        let out = await parseInWorker(f.name, buf.slice(0));
        if (!out) out = await parseOnMain(f.name, buf);
        if (!out.ok) { progress[i] = { t: `${f.name} — ошибка: ${out.error}`, cls: "er" }; render(); continue; }
        const r = out.r;
        const key = `${r.info.year}-${String(r.info.month).padStart(2, "0")}-${r.info.branch}`;
        await DB.put("files", { key, name: r.info.name, info: r.info, sheets: r.sheets, skipped: r.skipped, size: f.size, loadedAt: Date.now() });
        const n = r.sheets.reduce((s, x) => s + x.recs.length, 0);
        progress[i] = { t: `${f.name} — ${daysW(r.sheets.length)}, ${nf(n)} броней`, cls: "ok" }; okN++;
      } catch (e) {
        progress[i] = { t: `${f.name} — ошибка: ${e.message}`, cls: "er" };
      }
      render();
    }
    st.files = await DB.all("files");
    recompute(); render();
    if (okN) toast(`Загружено файлов: ${okN}`);
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { }
  }

  // ------------------------------------------------------------------ копия отметок, выгрузка в Excel
  async function shareFile(blob, name) {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === "AbortError") return; } }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  async function backup() {
    const data = { app: "karaoke-guests", version: 1, exported: new Date().toISOString(), contacts: st.contacts.map(({ id, ...c }) => c) };
    await shareFile(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }), `Отметки_обзвона_${K.todayStr()}.json`);
  }
  async function restore(file) {
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.contacts)) throw new Error("это не файл отметок");
      const seen = new Set(st.contacts.map((c) => [c.phone, c.date, c.who, c.note].join("|")));
      let n = 0;
      for (const c of data.contacts) {
        if (!c || typeof c.phone !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(c.date || "")) continue;
        const k = [c.phone, c.date, c.who || "", c.note || ""].join("|");
        if (seen.has(k)) continue;
        seen.add(k);
        await DB.put("contacts", { phone: c.phone, date: c.date, who: String(c.who || ""), note: String(c.note || ""), list: String(c.list || ""), name: String(c.name || ""), created: c.created || Date.now() });
        n++;
      }
      st.contacts = await DB.all("contacts"); recompute(); render(); toast(`Добавлено отметок: ${n}`);
    } catch (e) { toast("Не удалось восстановить: " + e.message, 5000); }
  }
  async function exportProfiles(rows, name) {
    try { await loadScript("xlsx.full.min.js"); } catch (e) { toast(e.message); return; }
    const aoa = [["Имя", "Телефон", "Статус", "Броней", "Визитов", "Последний визит", "Дней с последнего", "Обычно гостей", "Максимум гостей", "Основной филиал", "Последний контакт", "Комментарий", "WhatsApp"]];
    for (const p of rows) {
      const c = st.lastC.get(p.phone);
      aoa.push([p.name, fphone(p.phone), p.status, p.nBookings, p.visits, fd(p.last), p.since, p.medG, p.maxG, p.mainBranch, c ? fd(c.date) : "", c ? c.note : "", "https://wa.me/" + digits(p.phone)]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa); ws["!cols"] = [{ wch: 20 }, { wch: 17 }, { wch: 18 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 12 }, { wch: 30 }, { wch: 26 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Гости");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    await shareFile(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${name}_${K.todayStr()}.xlsx`);
  }

  // ------------------------------------------------------------------ события
  document.addEventListener("click", async (e) => {
    const stop = e.target.closest("[data-stop]");
    if (stop) return; // ссылки WhatsApp/звонок внутри карточки
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const a = el.getAttribute("data-act");
    if (a === "bar") { const cap = el.closest(".card") && el.closest(".card").querySelector(".cap"); if (cap) cap.textContent = el.getAttribute("data-t"); return; }
    if (a === "bg") { if (e.target === el) closeSheet(); return; }
    if (a === "close") return closeSheet();
    if (a === "gofiles") return setTab("files");
    if (a === "list") { st.list = el.dataset.k; st.shown = 50; return render(); }
    if (a === "more") { st.shown += 100; return render(); }
    if (a === "gmore") { st.gshown += 100; return render(); }
    if (a === "open") return openGuest(el.dataset.phone);
    if (a === "mark") { e.stopPropagation(); return openMark(el.dataset.phone, el.dataset.list); }
    if (a === "journal") return openJournal();
    if (a === "toggleF") { st.showFilters = !st.showFilters; return render(); }
    if (a === "resetF") { st.f = { bMin: "", bMax: "", gMin: "", gMax: "", branch: "", status: "", nb: "", from: "", to: "", noBlack: false, sort: "bookings" }; st.gshown = 50; return render(); }
    if (a === "dmode") { st.dashMode = el.dataset.k; return render(); }
    if (a === "delFile") { confirmKey = el.dataset.k; return render(); }
    if (a === "delAll") { confirmKey = "__all"; return render(); }
    if (a === "delFileNo") { confirmKey = null; return render(); }
    if (a === "delFileYes") { await DB.del("files", el.dataset.k); confirmKey = null; st.files = await DB.all("files"); recompute(); render(); return toast("Файл удалён"); }
    if (a === "delAllYes") { await DB.clear("files"); confirmKey = null; st.files = []; recompute(); render(); return toast("Таблицы удалены"); }
    if (a === "delC") { await DB.del("contacts", Number(el.dataset.id)); st.contacts = await DB.all("contacts"); recompute(); closeSheet(); render(); return toast("Отметка удалена"); }
    if (a === "backup") return backup();
    if (a === "exportList") return exportProfiles(listData(st.list), LIST_LABEL[st.list] || "Список");
    if (a === "exportGuests") return exportProfiles(filtered(), "Гости");
  });
  document.addEventListener("submit", (e) => { if (e.target.id === "markForm") { e.preventDefault(); saveMark(e.target); } });
  let qTimer = null;
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "q") { st.q = t.value; clearTimeout(qTimer); qTimer = setTimeout(() => { st.gshown = 50; rerenderGuestsKeepFocus(); }, 200); }
  });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "fileInput" && t.files.length) return importFiles(t.files);
    if (t.id === "restoreInput" && t.files.length) return restore(t.files[0]);
    if (t.id && t.id.startsWith("f-")) { const k = t.id.slice(2); st.f[k] = t.type === "checkbox" ? t.checked : t.value; st.gshown = 50; render(); }
  });
  function rerenderGuestsKeepFocus() {
    const pos = $("#q") ? $("#q").selectionStart : null;
    render();
    const q = $("#q"); if (q) { q.focus(); if (pos !== null) try { q.setSelectionRange(pos, pos); } catch (e) { } }
  }
  let rT = null;
  window.addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(() => { if (st.tab === "dash" && st.A) drawCharts(); }, 200); });

  // ------------------------------------------------------------------ запуск
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(() => { });
  }
  loadAll().then(() => { if (!st.A) st.tab = "files"; setTab(st.tab); });
})();
