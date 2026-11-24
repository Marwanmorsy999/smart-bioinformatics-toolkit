// CSV injection guard: neutralise cells that spreadsheet software may execute.
// Shared by statistics.js, blast.js and taxonomy-app.js CSV writers.
export function safeCsvCell(value) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // RFC4180 quoting (double quotes escaped).
  if (/[",\n\r]/.test(text)) text = '"' + text.replaceAll('"', '""') + '"';
  // Neutralise leading formula characters after the opening quote, if any.
  const m = text.match(/^("?)([=+\-@\t\r])/);
  if (m) text = m[1] + "'" + text.slice(m[1].length);
  return text;
}
