function toBool(v, fallback = true) {
  if (v === undefined || v === null) return fallback;
  const s = String(v).toLowerCase();
  if (["true", "1", "yes", "on"].includes(s)) return true;
  if (["false", "0", "no", "off"].includes(s)) return false;
  return fallback;
}

function toNumOrNull(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function trimStr(v) {
  return String(v ?? "").trim();
}

module.exports = { toBool, toNumOrNull, trimStr };
