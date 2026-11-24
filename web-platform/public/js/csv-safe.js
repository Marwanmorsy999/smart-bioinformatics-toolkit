// CSV injection guard: neutralise cells that spreadsheet software may execute.
// Shared by statistics.js, blast.js and taxonomy-app.js CSV writers.
export function safeCsvCell(value) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // RFC4180 quoting (double quotes escaped).
  if (/[",\n\r]/.test(text)) text = '"' + text.replaceAll('"', '""') + '"';
  // Neutralise formula characters even when preceded by whitespace, after
  // the opening quote introduced by RFC4180 quoting, if any.
  const m = text.match(/^("?)([\s]*)([=+\-@\t\r])/);
  if (m) text = m[1] + m[2] + "'" + text.slice(m[1].length + m[2].length);
  return text;
}
