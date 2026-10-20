/* Ядро приложения: разбор таблиц броней и все расчёты.
   Работает и в браузере (window.KCore / воркер), и в Node (module.exports) — для сверки с Python. */
(function (root) {
  "use strict";

  // ============================ НАСТРОЙКИ (как в Python-скриптах) ============================
  const S = {
    REGULAR_MIN_VISITS: 3, REGULAR_WINDOW_DAYS: 120, RHYTHM_LAST_VISITS: 6, NEW_REGULAR_DAYS: 45,
    RISK_MIN_DAYS: 30, RISK_RHYTHM_MULT: 1.5, LOST_MIN_DAYS: 60, LOST_RHYTHM_MULT: 3, THRESHOLD_DAYS: 60,
    HEAVY_VISITS: 25, TOP_N: 100, TOP_MIN_VISITS: 3, BIG_GROUP: 6, BIRTHDAY_AHEAD_DAYS: 35, RETURN_WINDOW: 90,
  };

  const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
  const WEEKDAYS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];
  const FILE_RE = /^_*Бронь[_\s]+([А-Яа-яЁё]+)[_\s]+([А-Яа-яЁё]+)[_\s]+(\d{4})(?:\s*\(\d+\)|\s*-\s*\d+|\s+\d+)?\.xlsx$/i;

  // ------------------------------- текст -------------------------------
  const INVIS = /[ㅤ ​]/g;
  function clean(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "string") {
      const s = v.replace(INVIS, " ").replace(/\s+/g, " ").trim();
      return s || null;
    }
    return v;
  }
  function asText(v) {
    v = clean(v);
    if (v === null) return null;
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
    if (v && (v.__date || v.__time)) return v.text;
    return String(v);
  }
  function toInt(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : null;
    if (typeof v === "string") {
      const t = v.trim();
      if (!t || !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null;
      return Math.trunc(Number(t));
    }
    return null;
  }

  // ------------------------------- даты -------------------------------
  function ymd(y, m, d) { return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
  function dateOf(s) { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); }
  function daysBetween(a, b) { return Math.round((dateOf(b) - dateOf(a)) / 86400000); }
  function addDays(s, n) { const t = new Date(dateOf(s) + n * 86400000); return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
  function weekdayOf(s) { return WEEKDAYS[(new Date(dateOf(s)).getUTCDay() + 6) % 7]; }
  function validDate(y, m, d) { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; }
  function todayStr() { const t = new Date(); return ymd(t.getFullYear(), t.getMonth() + 1, t.getDate()); }
  function serialToDate(n) { // Excel (1900) serial -> {y,m,d}
    const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }

  // ------------------------------- телефоны / числа -------------------------------
  function normPhone(v) {
    v = clean(v);
    if (v === null) return [null, null, 0];
    if (v && v.__date) return [v.text, null, 0];
    const raw = typeof v === "number" ? String(Math.trunc(v)) : String(v);
    const d = raw.replace(/\D/g, "");
    if (d.length === 11 && (d[0] === "7" || d[0] === "8")) return [raw, "+7" + d.slice(1), 1];
    if (d.length === 10 && d[0] === "7") return [raw, "+7" + d, 1];
    return [raw, null, 0];
  }
  function parseCount(v) {
    v = clean(v);
    if (v === null) return [null, null, null];
    if (v && v.__date) return [null, `${v.d}-${v.m}`, "кол-во было датой"];
    if (v && v.__time) return [null, null, "кол-во не число"];
    if (typeof v === "number") return [Math.trunc(v), null, null];
    const s = String(v);
    if (/^\d+$/.test(s)) return [parseInt(s, 10), null, null];
    const m = s.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (m) return [null, `${m[1]}-${m[2]}`, null];
    return [null, null, "кол-во не число"];
  }
  function noteAmount(t) { if (!t) return null; const m = t.match(/(\d+)\s*[кК](?![а-яА-Яa-zA-Z])/); return m ? parseInt(m[1], 10) * 1000 : null; }
  function noteDiscount(t) { const m = (t || "").match(/(\d{1,2})\s*%/); return m ? parseInt(m[1], 10) : null; }

  // ------------------------------- источник заявки -------------------------------
  const W = "[\\wа-яё]";
  const LETTER_BRANCH = { "с": "Сатпаева", "в": "Бейбитшилик", "а": "Абая", "б": "Бейбитшилик" };
  const SOURCE_RULES = [
    ["2ГИС", "(?<![а-я0-9])(?:2|т|б)?\\s*-?\\s*гис(?![а-я])|т?угис|(?<![а-я0-9])2\\s*(?:ггис|гия|gis|г\\s*ис|ги\\s*с|гмс|смгис|ис)(?![а-я])"],
    ["Instagram", `инст${W}*|instagram|(?<![а-я])ист(?![а-я])`],
    ["Сайт", "сайт"],
    ["Карты (Google/Яндекс)", "гугл|google|яндекс"],
    ["TikTok", "тик\\s*ток|tiktok"],
    ["ChatGPT", "чат\\s*(?:гпт|gpt)|chatgpt|(?<![a-z])gpt"],
    ["Реклама", `реклам${W}*|(?<![а-я])смм(?![а-я])|интернет|квиз|таргет`],
    ["Постоянный гость", `(?<![а-я])пост(?![а-я])|постоя${W}*|часто\\s+(?:бывают|бывает|приходят|приходит|у\\s+нас)`],
    ["Сарафан", `сарафан|(?<![а-я])рек(?![а-я])|от\\s+гостей|посоветовал${W}*`],
    ["Живут/работают рядом", "рядом|соседи|живет|живут|жив\\s+конс"],
    ["От сотрудника/знакомого", "(?<![а-я])от\\s+(?!гостей)[а-яa-z]{2,}|(?<![а-я])персонал(?![а-я])"],
    ["Алматы", `в\\s+а-?те|в\\s+алмат${W}*|с\\s+алмат${W}*|гости\\s+с\\s+алматы`],
    ["Перевод внутри заведения", `(?:с|из)\\s+кабин${W}*|с\\s+общ${W}*\\s+зала|пересели`],
    ["Пришли", `пришли|пришел|пришла|поймала\\s+с\\s+улицы|шли\\s+мимо|мимо\\s+проход${W}*`],
  ].map(([c, p]) => [c, new RegExp(p)]);
  const EVER_BEEN = "(?<![а-я])был[аи]?(?![а-я])|(?<![а-я])быи(?![а-я])|юыли|ранее|ране(?![а-я])|давно\\s+(?:знают|знют|знает|были)|знают\\s+давно|года?\\s+назад|были\\s+вчера";
  const BEEN_AT = "(?:был[аи]?|быи|юыли)\\s*(?:на|нас|н)\\s*";
  const EVER_RE = new RegExp(EVER_BEEN), BEEN_ANY_RE = new RegExp(BEEN_AT + "|" + EVER_BEEN);

  function prevBranches(low) {
    const found = [], re = new RegExp(BEEN_AT, "g");
    let m;
    while ((m = re.exec(low))) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      const rest = low.slice(m.index + m[0].length).split("/")[0];
      for (const t of rest.match(/[а-я]+/g) || []) {
        let b;
        if (t in LETTER_BRANCH && t.length === 1) b = LETTER_BRANCH[t];
        else if (t.startsWith("сатп")) b = LETTER_BRANCH["с"];
        else if (t.startsWith("вилк")) b = LETTER_BRANCH["в"];
        else if (t === "и") continue;
        else break;
        if (!found.includes(b)) found.push(b);
      }
    }
    return found;
  }
  function classifySource(raw) {
    let low = (raw || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
    if (!low) return { main: null, prev: null };
    const hits = [];
    SOURCE_RULES.forEach(([cat, rx], idx) => { const m = rx.exec(low); if (m) hits.push([m.index, idx, cat]); });
    const prev = prevBranches(low);
    if (prev.length || EVER_RE.test(low)) { const m = BEEN_ANY_RE.exec(low); hits.push([m ? m.index : 0, 99, "Были ранее"]); }
    hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return { main: hits.length ? hits[0][2] : "Прочее/неясно", prev: prev.length ? prev.join("; ") : null };
  }

  // ------------------------------- квизы и «чс» -------------------------------
  const QUIZ_RE = /тез\s*-?\s*тап|tez\s*-?\s*tap|город\s+перемен|шоу\s*-?\s*(?:тудей|today)|show\s*today|квиз\s*-?\s*пли[зс]|quiz\s*please/i;
  const isQuiz = (name) => !!(name && QUIZ_RE.test(name));
  const BLACK_RE = /(?<![а-яa-z])чс(?![а-яa-z])/i;

  // ------------------------------- акции -------------------------------
  const PROMO_TAGS = [
    ["День рождения", /(?<![а-ят])др(?![а-я])|день рожд|юбилей/],
    ["Тинейджерский ДР", /(?<![а-я])тдр(?![а-я])/],
    ["Карта лояльности", /(?<![а-я])кл(?![а-я])|карт[аы] лояльн/],
    ["Корпоративная карта", /(?<![а-я])кк(?![а-я])/],
    ["VIP-карта", /(?<![а-я])вип(?![а-я])/],
    ["Промокод", /промо/],
    ["Афтепати", /афт|авт\.?\s*пати|(?<![а-я])авт(?![а-я])/],
    ["Девичник", /(?<![а-я])дев(?:ич|ичник)?(?![а-я])|девичник/],
    ["Тимбилдинг", /тим\s*-?\s*б|(?<![а-я])тим(?![а-я])/],
    ["Встреча одноклассников / выпускников", /однокл|однкл|встр\.?\s*одн|вст\.?\s*вып|(?<![а-я])одн(?![а-я])/],
    ["Выпускной", /выпуск/],
    ["Корпоратив", /(?<![а-я])корп/],
    ["Ауызашар / ифтар", /ауыз|ифтар/],
    ["Гендер-пати", /гендер/],
    ["Предложение", /предл/],
    ["День учителя", /день учител/],
  ];
  const GENERAL_RE = /(?:общ|обш|ощ|оющ|бщ)\.?\s*(?:усл|ус|ул|улс)|общусл|общие условия/;
  const PER_PERSON_RE = /с\s*[\\/.]\s*п|(?<![а-я])сп(?![а-я])|с\s*чел|с\s*перс?|к\s*[\\/]\s*п/;
  const CARD_TAGS = ["Карта лояльности", "Корпоративная карта", "VIP-карта", "Промокод"];
  const BASE_TAGS = ["Общие условия", "Без отметки", "Скидка без названия"];
  function promoTags(note) {
    const n = (note || "").toLowerCase();
    const tags = PROMO_TAGS.filter(([, rx]) => rx.test(n)).map(([t]) => t);
    if (tags.length) return tags;
    if (GENERAL_RE.test(n)) return ["Общие условия"];
    if (/\d\s*%/.test(n)) return ["Скидка без названия"];
    return ["Без отметки"];
  }
  const isBirthday = (tags) => tags.includes("День рождения") || tags.includes("Тинейджерский ДР");

  // ------------------------------- разбор листа -------------------------------
  const LAYOUT = {
    "кабинка": { name: 2, src: 3, phone: 4, cnt: 5, note: 20, gift: 23 },
    "общий зал": { name: 2, src: 3, phone: 4, cnt: 5, note: 20, gift: 23 },
    "бар": { name: 2, src: 3, phone: 4, cnt: 5, note: 20, gift: 23 },
    "не распределено": { name: 2, src: 3, phone: 4, cnt: 5, note: 8, gift: null },
    "отмена": { name: 2, src: 3, phone: 4, cnt: 5, note: 8, gift: null },
    "резерв": { name: 2, src: null, phone: 3, cnt: 5, note: 6, gift: null },
  };
  const SOURCE_WORDS = ["источник заявки", "источник-заявки", "источники", "источник"];
  function sectionOf(low0) {
    if (low0.includes("отмен")) return "отмена";
    if (low0.includes("резерв")) return "резерв";
    if (low0.startsWith("бар")) return "бар";
    if (low0.includes("кабина/стол")) return "не распределено";
    if (low0.includes("общий зал") || low0.startsWith("стол")) return "общий зал";
    return "кабинка";
  }
  const pyStr = (v) => (typeof v === "number" ? String(v) : v && (v.__date || v.__time) ? v.text : String(v));

  /** rows: массив строк (массивов ячеек); ячейка — строка, число, null или {__date,d,m,y,text} / {__time,text} */
  function readSheet(rows) {
    const out = [];
    let mode = "кабинка", place = null;
    for (let raw of rows) {
      const row = new Array(27).fill(null);
      for (let i = 0; i < Math.min(raw.length, 27); i++) row[i] = raw[i] === undefined ? null : raw[i];
      const col0 = clean(row[0]);
      const low0 = col0 !== null && col0 !== "" ? pyStr(col0).toLowerCase() : "";
      const head = row.slice(0, 6).map(clean).filter((c) => c !== null).map((c) => pyStr(c).toLowerCase()).join(" ");
      if (head.includes("случа") && head.includes("имен")) break;
      const nameCell = clean(row[2]);
      const c3 = pyStr(clean(row[3]) || "").toLowerCase(), c4 = pyStr(clean(row[4]) || "").toLowerCase();
      const isHeader = (typeof nameCell === "string" && nameCell.toLowerCase() === "имя") || c4 === "контакт" || SOURCE_WORDS.includes(c3);
      if (isHeader) { mode = sectionOf(low0); place = null; continue; }
      const L = LAYOUT[mode];
      const name = clean(row[L.name]);
      const phoneCell = clean(row[L.phone]);
      const slot = toInt(row[1]);
      if (mode === "кабинка") {
        if (slot === 0 && col0) place = col0;
      } else if (mode === "общий зал") {
        const m = low0.match(/^(\d+)\s*стол/);
        if (m) place = `стол ${m[1]}`;
      } else place = mode;
      if (name === null && phoneCell === null) continue;
      if (place === null) continue;
      const [, phone, ok] = normPhone(phoneCell);
      const [count, range] = parseCount(row[L.cnt]);
      const note = L.note !== null ? asText(row[L.note]) : null;
      const src = L.src !== null ? asText(row[L.src]) : null;
      const sc = classifySource(src);
      out.push({
        area: mode, place: typeof place === "string" ? place : pyStr(place).replace(/\.0$/, ""),
        name: typeof name === "string" ? name : asText(name),
        phone: phone, pv: ok, cnt: count, rng: range, src: src, srcMain: sc.main, prev: sc.prev,
        note: note, amount: noteAmount(note), disc: noteDiscount(note),
        gift: L.gift !== null ? asText(row[L.gift]) : null, cancelled: mode === "отмена" ? 1 : 0,
      });
    }
    return out;
  }

  function parseSheetName(name) {
    const m = name.match(/^\s*(\d{1,2})\.(\d{2})\s*([А-Яа-я]{2})?/);
    return m ? [parseInt(m[1], 10), parseInt(m[2], 10), m[3] ? m[3].toUpperCase() : null] : null;
  }
  function resolveDate(day, month, fy, fm) {
    let best = null;
    for (const y of [fy - 1, fy, fy + 1]) {
      if (!validDate(y, month, day)) continue;
      const dist = Math.abs(daysBetween(ymd(fy, fm, 15), ymd(y, month, day)));
      if (!best || dist < best[0]) best = [dist, ymd(y, month, day)];
    }
    return best ? best[1] : null;
  }
  function parseFileName(fname) {
    const n = fname.normalize("NFC").replace(/^.*[\\/]/, "");
    const m = n.match(FILE_RE);
    if (!m) return null;
    const mi = MONTHS.indexOf(m[1].toLowerCase());
    if (mi < 0) return null;
    const b = m[2].toLowerCase();
    return { branch: b[0].toUpperCase() + b.slice(1), month: mi + 1, year: parseInt(m[3], 10), name: n };
  }

  /** Разбор книги SheetJS -> {info, sheets:[{date,title,copy,same,wd,label,recs}], skipped:[]} */
  function parseWorkbook(XLSX, wb, fname) {
    const info = parseFileName(fname);
    if (!info) return { error: "Имя файла не похоже на «Бронь_Месяц_Филиал_Год.xlsx»", name: fname };
    const sheets = [], skipped = [];
    for (const title of wb.SheetNames) {
      const ws = wb.Sheets[title];
      const p = parseSheetName(title);
      if (!p) { skipped.push(title); continue; }
      const date = resolveDate(p[0], p[1], info.year, info.month);
      if (!date) { skipped.push(title); continue; }
      const rows = sheetRows(XLSX, ws);
      const wd = weekdayOf(date);
      sheets.push({ date, title, copy: title.toLowerCase().includes("копия"), same: Number(date.slice(5, 7)) === info.month,
        wd, label: p[2], recs: readSheet(rows) });
    }
    return { info, sheets, skipped };
  }

  function sheetRows(XLSX, ws) {
    if (!ws || !ws["!ref"]) return [];
    const rg = XLSX.utils.decode_range(ws["!ref"]);
    const dense = Array.isArray(ws) || !!ws["!data"];
    const rows = [];
    const lastC = Math.min(rg.e.c, 26);
    for (let r = 0; r <= rg.e.r; r++) {
      const row = new Array(lastC + 1).fill(null);
      for (let c = 0; c <= lastC; c++) {
        let cell;
        if (ws["!data"]) cell = ws["!data"][r] && ws["!data"][r][c];
        else if (Array.isArray(ws)) cell = ws[r] && ws[r][c];
        else cell = ws[XLSX.utils.encode_cell({ r, c })];
        row[c] = cellValue(XLSX, cell);
      }
      rows.push(row);
    }
    return rows;
  }
  function cellValue(XLSX, cell) {
    if (!cell || cell.v === undefined || cell.v === null) return null;
    if (cell.t === "s" || cell.t === "str") return String(cell.v);
    if (cell.t === "b") return cell.v ? 1 : 0;
    if (cell.t === "e") return cell.w || null;
    if (cell.t === "n") {
      const v = cell.v, z = cell.z;
      // как openpyxl: число в формате даты -> дата (меньше 1 -> время); слишком большое (телефон) -> число
      if (z && typeof z === "string" && z !== "General" && XLSX.SSF.is_date(z) && v >= 0 && v < 2958466) {
        const secs = Math.round((v - Math.floor(v)) * 86400), hms = [Math.floor(secs / 3600) % 24, Math.floor(secs / 60) % 60, secs % 60].map((x) => String(x).padStart(2, "0")).join(":");
        if (v < 1) return { __time: true, text: hms };
        const d = serialToDate(v < 60 ? v + 1 : v);
        return { __date: true, y: d.y, m: d.m, d: d.d, text: ymd(d.y, d.m, d.d) + " " + hms };
      }
      return v;
    }
    if (cell.t === "d") { const t = new Date(cell.v); return { __date: true, y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), text: "" }; }
    return cell.v;
  }

  // ------------------------------- сборка базы из загруженных файлов -------------------------------
  /** files: [{name, info, sheets}] -> {bookings, report} (одна версия на филиал+дату, как в Python) */
  function buildBookings(files) {
    const sorted = files.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const cand = new Map();
    for (const f of sorted) {
      for (const s of f.sheets) {
        const key = f.info.branch + "|" + s.date;
        if (!cand.has(key)) cand.set(key, []);
        cand.get(key).push({ f, s });
      }
    }
    const bookings = [], dups = [], wdNotes = [];
    for (const [key, opts] of cand) {
      opts.sort((a, b) => (a.s.copy - b.s.copy) || ((!a.s.same) - (!b.s.same)) || (b.s.recs.length - a.s.recs.length));
      const o = opts[0];
      for (const x of opts.slice(1)) dups.push({ key, skipped: x.f.name + " / " + x.s.title, taken: o.f.name + " / " + o.s.title });
      const branch = key.split("|")[0];
      for (const r of o.s.recs) bookings.push(Object.assign({ date: o.s.date, wd: o.s.wd, branch, file: o.f.name, sheet: o.s.title }, r));
    }
    for (const f of sorted) for (const s of f.sheets) if (s.label && s.label !== s.wd) wdNotes.push(`${f.name} / ${s.title}: в названии ${s.label}, по календарю ${s.wd}`);
    bookings.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.branch < b.branch ? -1 : a.branch > b.branch ? 1 : 0));
    bookings.forEach((b, i) => { b.id = i; b.tags = promoTags(b.note); b.quiz = isQuiz(b.name); });
    return { bookings, dups, wdNotes, days: cand.size };
  }

  // ------------------------------- гости и статусы -------------------------------
  function median(a) { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
  function regularSince(dates) {
    const k0 = S.REGULAR_MIN_VISITS - 1;
    for (let k = k0; k < dates.length; k++) if (daysBetween(dates[k - k0], dates[k]) <= S.REGULAR_WINDOW_DAYS) return dates[k];
    return null;
  }
  function round1(x) { return Math.round(x * 10) / 10; }
  function pyRound(x) { // round half to even, как в Python
    const f = Math.floor(x), d = x - f;
    if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
    return Math.round(x);
  }
  function pyRound1(x) { return pyRound(x * 10) / 10; }

  /** Основной расчёт. bookings — все активные+отменённые; asOf — дата расчёта. */
  function analyze(bookings, asOf) {
    const lastData = bookings.reduce((m, b) => (!b.cancelled && b.date > m ? b.date : m), "");
    const active = bookings.filter((b) => !b.cancelled && !b.quiz);
    asOf = asOf || (todayStr() < lastData ? todayStr() : lastData);
    const past = active.filter((b) => b.date <= asOf);
    const guests = new Map();
    for (const b of past) {
      if (!b.pv || !b.phone) continue;
      let g = guests.get(b.phone);
      if (!g) { g = { phone: b.phone, dates: new Map(), names: new Map(), counts: [], branchDays: new Set(), bookings: [], nBookings: 0 }; guests.set(b.phone, g); }
      if (!g.dates.has(b.date)) g.dates.set(b.date, { branch: b.branch, place: b.place, source: b.srcMain });
      g.branchDays.add(b.date + "|" + b.branch);
      const nm = (b.name || "").trim();
      if (nm) g.names.set(nm, (g.names.get(nm) || 0) + 1);
      if (b.cnt) g.counts.push(b.cnt);
      g.bookings.push(b);
      g.nBookings++;
    }
    const future = new Map();
    for (const b of active) if (b.date > asOf && b.pv && b.phone) if (!future.has(b.phone) || b.date < future.get(b.phone)) future.set(b.phone, b.date);

    const profiles = [];
    for (const g of guests.values()) profiles.push(profile(g, asOf, future.get(g.phone) || null));
    return { asOf, lastData, firstData: active.reduce((m, b) => (!m || b.date < m ? b.date : m), ""), active, past, guests, profiles, future };
  }

  function mostCommon(map) { let best = null, n = -1; for (const [k, v] of map) if (v > n) { best = k; n = v; } return best; }

  function profile(g, asOf, futureDate) {
    const dates = [...g.dates.keys()].sort();
    const visits = dates.length, first = dates[0], last = dates[visits - 1];
    let gaps = []; for (let i = 0; i < visits - 1; i++) gaps.push(daysBetween(dates[i], dates[i + 1]));
    gaps = gaps.slice(-(S.RHYTHM_LAST_VISITS - 1));
    const rhythm = gaps.length ? median(gaps) : null;
    const since = daysBetween(last, asOf);
    const names = [...g.names.keys()];
    const black = names.some((n) => BLACK_RE.test(n));
    const name = g.names.size ? mostCommon(g.names) : "";
    const byBranch = new Map(); for (const k of g.branchDays) { const b = k.split("|")[1]; byBranch.set(b, (byBranch.get(b) || 0) + 1); }
    const branchesSorted = [...byBranch.entries()].sort((a, b) => b[1] - a[1]);
    const became = regularSince(dates);
    let status = "Разовый", overdue = null;
    if (became) {
      const riskAfter = Math.max(S.RISK_MIN_DAYS, S.RISK_RHYTHM_MULT * rhythm), lostAfter = Math.max(S.LOST_MIN_DAYS, S.LOST_RHYTHM_MULT * rhythm);
      overdue = rhythm ? pyRound1(since / rhythm) : null;
      if (since > lostAfter) status = "Ушёл";
      else if (since > riskAfter) status = "Под риском";
      else if (daysBetween(became, asOf) <= S.NEW_REGULAR_DAYS) status = "Новый постоянный";
      else status = "Активный постоянный";
    } else if (visits >= 2) status = since <= S.THRESHOLD_DAYS ? "На пороге" : "Бывали, давно не было";
    const notes = [];
    if (black) notes.push("пометка «чс»");
    if (visits >= S.HEAVY_VISITS) notes.push(`очень частые визиты (${visits}) — не сотрудник ли`);
    if (new Set(names.map((n) => n.toLowerCase())).size > 3) notes.push("на номер записаны разные имена");
    const c = g.counts;
    const bdays = g.bookings.filter((b) => isBirthday(b.tags)).map((b) => b.date);
    return {
      phone: g.phone, name, visits, nBookings: g.nBookings, first, last, since, became, status, overdue, black,
      rhythm: rhythm === null ? null : pyRound(rhythm),
      mainBranch: branchesSorted[0][0], branches: branchesSorted.map(([b, n]) => `${b} ${n}`).join("; "),
      branchList: branchesSorted.map(([b]) => b),
      lastBranch: g.dates.get(last).branch, firstSource: g.dates.get(first).source,
      avgG: c.length ? pyRound1(c.reduce((s, x) => s + x, 0) / c.length) : null, medG: median(c), maxG: c.length ? Math.max(...c) : null,
      notes: notes.join("; "), futureDate, lastBirthday: bdays.length ? bdays[bdays.length - 1] : null,
      bookings: g.bookings,
    };
  }

  function lists(A) {
    const P = A.profiles, by = {};
    for (const p of P) (by[p.status] = by[p.status] || []).push(p);
    const g = (s) => by[s] || [];
    const ok = (p) => !p.black;
    const newReg = g("Новый постоянный").filter(ok).sort((a, b) => (a.became < b.became ? 1 : a.became > b.became ? -1 : 0));
    const risk = g("Под риском").filter(ok).sort((a, b) => (b.overdue || 0) - (a.overdue || 0));
    const lost = g("Ушёл").filter(ok).sort((a, b) => b.visits - a.visits || a.since - b.since);
    const threshold = g("На пороге").filter(ok).sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
    const top = P.filter((p) => !p.black && p.medG && p.visits >= S.TOP_MIN_VISITS)
      .map((p) => Object.assign(p, { score: pyRound(p.visits * p.medG) }))
      .sort((a, b) => b.score - a.score || b.visits - a.visits || a.since - b.since).slice(0, S.TOP_N);
    // ДР в ближайшие дни: по дате прошлой брони на ДР (день и месяц)
    const soon = [];
    for (const p of P) {
      if (p.black || !p.lastBirthday) continue;
      const md = p.lastBirthday.slice(5);
      let y = Number(A.asOf.slice(0, 4));
      let next = `${y}-${md}`;
      if (md === "02-29" && !validDate(y, 2, 29)) next = `${y}-02-28`;
      if (next <= A.asOf) { y++; next = md === "02-29" && !validDate(y, 2, 29) ? `${y}-02-28` : `${y}-${md}`; }
      const inDays = daysBetween(A.asOf, next);
      if (inDays <= S.BIRTHDAY_AHEAD_DAYS && daysBetween(p.lastBirthday, next) >= 300) soon.push(Object.assign(p, { nextBirthday: next, inDays }));
    }
    soon.sort((a, b) => a.inDays - b.inDays);
    return { by, newReg, risk, lost, threshold, top, soon };
  }

  // ------------------------------- дашборды -------------------------------
  function monthly(A) {
    const m = new Map();
    for (const b of A.past) {
      const k = b.date.slice(0, 7);
      if (!m.has(k)) m.set(k, {});
      const o = m.get(k);
      o[b.branch] = o[b.branch] || { bookings: 0, guests: 0, counted: 0 };
      o[b.branch].bookings++; if (b.cnt) { o[b.branch].guests += b.cnt; o[b.branch].counted++; }
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([month, br]) => ({ month, br }));
  }

  function promos(A) {
    const st = new Map(), W2 = WEEKDAYS;
    const mk = () => ({ n: 0, guests: [], disc: [], pp: [], wk: 0, branch: {}, month: {}, wday: {}, src: {}, gift: 0, newG: 0, back: 0 });
    for (const b of A.past) {
      const note = (b.note || "").toLowerCase();
      let pp = null;
      if (b.amount) { if (PER_PERSON_RE.test(note)) pp = b.amount; else if (b.cnt) pp = b.amount / b.cnt; }
      for (const t of b.tags) {
        if (!st.has(t)) st.set(t, mk());
        const s = st.get(t);
        s.n++; if (b.cnt) s.guests.push(b.cnt); if (b.disc) s.disc.push(b.disc); if (pp && pp >= 1000 && pp <= 100000) s.pp.push(pp);
        if (b.wd === "ПТ" || b.wd === "СБ") s.wk++;
        s.branch[b.branch] = (s.branch[b.branch] || 0) + 1; s.month[b.date.slice(0, 7)] = (s.month[b.date.slice(0, 7)] || 0) + 1;
        s.wday[b.wd] = (s.wday[b.wd] || 0) + 1; const sm = b.srcMain || "не указан"; s.src[sm] = (s.src[sm] || 0) + 1;
        const gf = (b.gift || "").trim().toLowerCase(); if (gf && gf !== "нет" && gf !== "-") s.gift++;
      }
    }
    // возврат новых гостей
    for (const g of A.guests.values()) {
      const days = [...g.dates.keys()].sort();
      const first = days[0];
      if (daysBetween(first, A.asOf) < S.RETURN_WINDOW) continue;
      const firstB = g.bookings.filter((b) => b.date === first);
      if (firstB.some((b) => b.srcMain === "Были ранее" || b.srcMain === "Постоянный гость")) continue;
      const back = days.slice(1).some((d) => d > first && daysBetween(first, d) <= S.RETURN_WINDOW);
      const tags = new Set(firstB.flatMap((b) => b.tags));
      for (const t of tags) { if (!st.has(t)) st.set(t, mk()); st.get(t).newG++; if (back) st.get(t).back++; }
    }
    const total = A.past.length;
    return [...st.entries()].sort((a, b) => b[1].n - a[1].n).map(([t, s]) => {
      const top = Object.entries(s.src).sort((a, b) => b[1] - a[1])[0] || ["—", 0];
      return { promo: t, kind: BASE_TAGS.includes(t) ? "base" : CARD_TAGS.includes(t) ? "card" : "event", n: s.n, share: s.n / total,
        medG: median(s.guests), known: s.guests.length, disc: median(s.disc), pp: s.pp.length ? Math.round(median(s.pp)) : null,
        wk: s.n ? s.wk / s.n : 0, newG: s.newG, back: s.back, ret: s.newG ? s.back / s.newG : null, gift: s.gift,
        topSrc: top[0], topSrcShare: s.n ? top[1] / s.n : 0, branch: s.branch, month: s.month, wday: s.wday };
    });
  }

  function contactResults(contacts, A) {
    // contacts: [{phone,date,who,note,list}] ; вернулся = визит после даты
    const lists = ["Новые постоянные", "Под риском", "Ушли", "На пороге", "Топ-100", "ДР скоро"];
    const groups = new Map(lists.map((l) => [l, new Map()]));
    for (const c of contacts.slice().sort((a, b) => (a.date < b.date ? -1 : 1))) {
      const key = c.list || "Другое"; if (!groups.has(key)) groups.set(key, new Map());
      groups.get(key).set(c.phone, c);
    }
    return [...groups.entries()].map(([list, m]) => {
      let n = 0, back = 0, booked = 0, fresh = 0;
      for (const c of m.values()) {
        n++;
        const r = backAfter(c, A);
        if (r && r.kind === "visit") back++; else if (r && r.kind === "booking") booked++;
        if (daysBetween(c.date, A.asOf) < 30) fresh++;
      }
      return { list, n, back, booked, fresh, rate: n ? back / n : null };
    });
  }
  function backAfter(c, A) {
    const g = A.guests.get(c.phone);
    if (g) { const d = [...g.dates.keys()].sort().find((x) => x > c.date); if (d) return { kind: "visit", date: d }; }
    const f = A.future.get(c.phone); if (f && f > c.date) return { kind: "booking", date: f };
    return null;
  }

  const api = { S, MONTHS, WEEKDAYS, parseFileName, parseWorkbook, sheetRows, readSheet, cellValue, classifySource, promoTags, isQuiz,
    buildBookings, analyze, lists, monthly, promos, contactResults, backAfter, daysBetween, addDays, todayStr, weekdayOf, median, isBirthday, BLACK_RE };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.KCore = api;
})(typeof self !== "undefined" ? self : this);
