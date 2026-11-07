// Renders an .xlsx file as a spreadsheet-style HTML page (grid, column letters,
// row numbers, cell fills and fonts, number formats, sheet tabs) for the demo video.
// Usage: node xlsx-viewer.mjs <in.xlsx> <out.html>
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");

const [, , input, output] = process.argv;
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(input);

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const col = (n) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const fmt = (cell) => {
  const v = cell.value;
  if (v == null) return "";
  if (v instanceof Date) return v.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  if (typeof v === "number" && cell.numFmt && cell.numFmt.includes("0.00")) return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (typeof v === "object" && v.richText) return v.richText.map((r) => r.text).join("");
  return String(v);
};
const argb = (c) => (c && c.argb ? `#${c.argb.slice(2)}` : null);

const sheets = [];
wb.eachSheet((ws) => {
  const cols = Math.min(ws.columnCount || 1, 14);
  const rows = Math.min(ws.rowCount, 60);
  const widths = Array.from({ length: cols }, (_, i) => Math.round(((ws.getColumn(i + 1).width ?? 10) * 7.2)));
  let html = `<table><colgroup><col style="width:42px">${widths.map((w) => `<col style="width:${w}px">`).join("")}</colgroup>`;
  html += `<tr class="hdr"><th></th>${widths.map((_, i) => `<th>${col(i + 1)}</th>`).join("")}</tr>`;
  for (let r = 1; r <= Math.max(rows, 28); r++) {
    const row = ws.getRow(r);
    html += `<tr><th class="rn">${r}</th>`;
    for (let c = 1; c <= cols; c++) {
      const cell = row.getCell(c);
      const st = [];
      const fill = cell.fill && cell.fill.fgColor ? argb(cell.fill.fgColor) : null;
      if (fill) st.push(`background:${fill}`);
      if (cell.font?.bold) st.push("font-weight:600");
      if (cell.font?.color) st.push(`color:${argb(cell.font.color)}`);
      if (cell.font?.size && cell.font.size > 12) st.push(`font-size:${cell.font.size}px`);
      const v = cell.value;
      const right = typeof v === "number" || v instanceof Date;
      if (right) st.push("text-align:right");
      if (typeof v === "number" && v < 0 && cell.numFmt?.includes("[Red]")) st.push("color:#C00000");
      html += `<td style="${st.join(";")}">${esc(fmt(cell))}</td>`;
    }
    html += "</tr>";
  }
  html += "</table>";
  sheets.push({ name: ws.name, html, frozen: ws.views?.[0]?.ySplit === 1 });
});

const page = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(input.split("/").pop())}</title>
<style>
*{box-sizing:border-box}body{margin:0;font:13px Calibri,"Segoe UI",Arial,sans-serif;background:#fff;color:#000;height:100vh;display:flex;flex-direction:column}
.bar{background:#0E5E56;color:#fff;padding:8px 16px;font-size:14px;display:flex;justify-content:space-between}
.ribbon{background:#f3f3f3;border-bottom:1px solid #d4d4d4;padding:6px 16px;color:#444;font-size:12px}
.fx{border-bottom:1px solid #d4d4d4;padding:4px 16px;font-size:12px;color:#555;background:#fff}
.grid{flex:1;overflow:auto}
table{border-collapse:collapse;table-layout:fixed}
td,th{border:1px solid #e1e1e1;height:21px;padding:0 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
th{background:#f3f3f3;color:#555;font-weight:400;text-align:center;position:sticky;top:0}
th.rn{position:sticky;left:0;background:#f3f3f3}
tr.hdr th{z-index:2}
.tabs{display:flex;gap:2px;background:#f3f3f3;border-top:1px solid #d4d4d4;padding:0 16px}
.tab{padding:6px 16px;color:#333;cursor:pointer;border:1px solid transparent;border-top:none}
.tab.on{background:#fff;color:#0E5E56;font-weight:600;border-color:#d4d4d4;border-bottom:3px solid #0E5E56}
.sheet{display:none}.sheet.on{display:block}
</style></head><body>
<div class="bar"><span>${esc(input.split("/").pop())}</span><span>Preview of the exported .xlsx file</span></div>
<div class="ribbon">File &nbsp;&nbsp; Home &nbsp;&nbsp; Insert &nbsp;&nbsp; Page Layout &nbsp;&nbsp; Formulas &nbsp;&nbsp; Data &nbsp;&nbsp; Review &nbsp;&nbsp; View</div>
<div class="fx">fx</div>
<div class="grid">${sheets.map((s, i) => `<div class="sheet${i ? "" : " on"}" id="s${i}">${s.html}</div>`).join("")}</div>
<div class="tabs">${sheets.map((s, i) => `<div class="tab${i ? "" : " on"}" data-i="${i}">${esc(s.name)}</div>`).join("")}</div>
<script>
document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>{document.querySelectorAll(".tab,.sheet").forEach(e=>e.classList.remove("on"));t.classList.add("on");document.getElementById("s"+t.dataset.i).classList.add("on")});
</script></body></html>`;
writeFileSync(output, page);
console.log(`Rendered ${sheets.length} sheets: ${sheets.map((s) => s.name).join(", ")}`);
