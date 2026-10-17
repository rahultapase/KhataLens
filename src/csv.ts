// Ledger -> CSV that opens cleanly in Excel / Google Sheets. No dependencies.
import { balances, totalOwed, type Entry } from "./ledger.ts";

/**
 * Quote a cell. Text that starts with = + - @ (or tab/CR) is prefixed with an
 * apostrophe so a spreadsheet treats it as text, not a formula (CSV injection).
 * Names and items come from Gemma's reading, so they are untrusted.
 */
function cell(value: string | number): string {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let s = value;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function line(values: (string | number)[]): string {
  return values.map(cell).join(",");
}

export function ledgerCsv(entries: Entry[], shop: string): string {
  const rows: string[] = [];
  rows.push(line([`${shop} - udhaar khata`]));
  rows.push("");
  rows.push(line(["Date", "Customer", "Item", "Type", "Amount (INR)"]));
  for (const e of entries) {
    rows.push(line([e.date, e.customer.trim(), e.item, e.kind === "jama" ? "Jama" : "Udhaar", e.amount]));
  }

  const list = balances(entries);
  rows.push("");
  rows.push(line(["Customer", "Udhaar (INR)", "Jama (INR)", "Balance (INR)"]));
  for (const c of list) rows.push(line([c.name, c.udhaar, c.jama, c.balance]));
  rows.push(line(["Total to collect", "", "", totalOwed(list)]));

  // Excel needs CRLF and a BOM to read UTF-8 (names, the ₹ sign) correctly.
  return "\uFEFF" + rows.join("\r\n") + "\r\n";
}

export function downloadCsv(content: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csvFilename(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `khata-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
}
