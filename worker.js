/* Фоновый разбор Excel-файла, чтобы интерфейс не зависал. */
importScripts("xlsx.full.min.js", "core.js");
self.onmessage = function (e) {
  const { name, buf } = e.data;
  try {
    const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellNF: true, cellDates: false, cellStyles: false, cellHTML: false, cellFormula: false, dense: true });
    const r = self.KCore.parseWorkbook(XLSX, wb, name);
    if (r.error) self.postMessage({ ok: false, error: r.error });
    else self.postMessage({ ok: true, r });
  } catch (err) {
    self.postMessage({ ok: false, error: (err && err.message) || String(err) });
  }
};
