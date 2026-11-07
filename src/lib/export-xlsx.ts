// Excel workbook for one company: Summary, Activity, Payments, Ledger, Wallets.
import ExcelJS from "exceljs";
import { db } from "./db";
import { getRates } from "./dashboard";
import { loadPolicy } from "./repo";
import { bn, type Currency, toNgn } from "./money";
import { outcome, reasonLabel, title } from "./view";
import { CATEGORY_LABEL, type Category, type ProposedAction } from "../engine/types";

const TEAL = "FF0E5E56";
const MONEY = '#,##0.00;[Red]-#,##0.00';

function header(ws: ExcelJS.Worksheet, columns: { header: string; key: string; width: number; money?: boolean; date?: boolean }[]) {
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.money ? { numFmt: MONEY } : c.date ? { numFmt: "dd mmm yyyy hh:mm" } : {} }));
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
  row.alignment = { vertical: "middle" };
  row.height = 22;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
}

export async function buildWorkbook(companyId: string): Promise<{ buffer: Buffer; filename: string }> {
  const [company, actions, payments, ledger, wallets, policy, { rates }] = await Promise.all([
    db.company.findUniqueOrThrow({ where: { id: companyId } }),
    db.action.findMany({ where: { companyId }, orderBy: { number: "asc" }, include: { executions: true } }),
    db.scheduledPayment.findMany({ where: { companyId }, include: { payee: true }, orderBy: [{ dueDate: "asc" }, { priority: "asc" }] }),
    db.ledgerEntry.findMany({ where: { companyId }, orderBy: { at: "asc" } }),
    db.wallet.findMany({ where: { companyId }, orderBy: { currency: "asc" } }),
    loadPolicy(db, companyId),
    getRates(),
  ]);
  const payeeOf = new Map(payments.map((p) => [p.id, p.payee.name]));

  const wb = new ExcelJS.Workbook();
  wb.creator = "Bursar";
  wb.created = new Date();

  // Summary
  const sum = wb.addWorksheet("Summary", { properties: { tabColor: { argb: TEAL } } });
  sum.columns = [{ width: 34 }, { width: 26 }, { width: 22 }];
  sum.addRow([`Bursar treasury report: ${company.name}`]).font = { bold: true, size: 16, color: { argb: TEAL } };
  sum.addRow([`Generated ${new Date().toUTCString()}`]).font = { color: { argb: "FF53636A" } };
  sum.addRow([]);
  const h1 = sum.addRow(["Wallet", "Balance", "NGN equivalent"]);
  h1.font = { bold: true, color: { argb: "FFFFFFFF" } };
  h1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
  let total = 0;
  for (const w of wallets) {
    const c = w.currency as Currency;
    const ngn = toNgn(bn(w.balance), c, rates) / 100;
    total += ngn;
    const r = sum.addRow([`${c} wallet`, bn(w.balance) / 100, ngn]);
    r.getCell(2).numFmt = MONEY;
    r.getCell(3).numFmt = MONEY;
  }
  const tr = sum.addRow(["Total treasury", "", total]);
  tr.font = { bold: true };
  tr.getCell(3).numFmt = MONEY;
  sum.addRow([]);
  const paidCount = actions.filter((a) => a.status === "EXECUTED" && a.type !== "SWAP" && a.type !== "RULE_CHANGE").length;
  const stats: [string, number][] = [
    ["Actions recorded", actions.length],
    ["Paid or swapped by Bursar alone", actions.filter((a) => a.status === "EXECUTED" && a.decidedBy === "BURSAR").length],
    ["Approved by you", actions.filter((a) => a.decidedBy === "OWNER" && a.status === "EXECUTED").length],
    ["Waiting for you", actions.filter((a) => a.status === "PENDING").length],
    ["Payments sent", paidCount],
  ];
  for (const [k, v] of stats) sum.addRow([k, v]);
  sum.addRow([]);
  sum.addRow(["Rules"]).font = { bold: true };
  sum.addRow(["Daily cap (NGN)", bn(policy.dailyCapNgn) / 100]).getCell(2).numFmt = MONEY;
  sum.addRow(["Swap cap (NGN)", bn(policy.perSwapCapNgn) / 100]).getCell(2).numFmt = MONEY;
  for (const w of wallets) {
    const c = w.currency as Currency;
    sum.addRow([`${c}: per payment cap / buffer`, (policy.perPaymentCap[c] ?? 0) / 100, (policy.buffer[c] ?? 0) / 100]).eachCell((cell, i) => {
      if (i > 1) cell.numFmt = MONEY;
    });
  }

  // Activity
  const act = wb.addWorksheet("Activity");
  header(act, [
    { header: "#", key: "n", width: 6 },
    { header: "When", key: "at", width: 18, date: true },
    { header: "What happened", key: "what", width: 34 },
    { header: "Type", key: "type", width: 14 },
    { header: "Currency", key: "cur", width: 9 },
    { header: "Amount", key: "amount", width: 16, money: true },
    { header: "Fee", key: "fee", width: 10, money: true },
    { header: "Outcome", key: "outcome", width: 12 },
    { header: "Decided by", key: "by", width: 11 },
    { header: "Rule checked", key: "rule", width: 26 },
    { header: "Explanation", key: "why", width: 70 },
    { header: "Blaaiz reference", key: "ref", width: 28 },
  ]);
  for (const a of actions) {
    const p = JSON.parse(a.payload) as ProposedAction;
    act.addRow({
      n: a.number,
      at: a.createdAt,
      what: title(a, payeeOf.get(a.paymentId ?? "")),
      type: a.type,
      cur: p.currency,
      amount: p.amount / 100,
      fee: p.fee / 100,
      outcome: outcome(a).label,
      by: a.decidedBy === "OWNER" ? "You" : a.decidedBy === "BURSAR" ? "Bursar" : "",
      rule: a.reasonCode === "ROUTINE_OK" ? "Within all rules" : reasonLabel(a.reasonCode),
      why: a.explanation,
      ref: a.executions.map((e) => e.blaaizTransactionId).filter(Boolean).join(" "),
    });
  }
  act.getColumn("why").alignment = { wrapText: true, vertical: "top" };

  // Payments
  const pay = wb.addWorksheet("Payments");
  header(pay, [
    { header: "Due", key: "due", width: 12 },
    { header: "Payee", key: "payee", width: 26 },
    { header: "Category", key: "cat", width: 18 },
    { header: "Currency", key: "cur", width: 9 },
    { header: "Amount", key: "amount", width: 16, money: true },
    { header: "Repeats", key: "rep", width: 10 },
    { header: "Status", key: "status", width: 12 },
    { header: "Critical", key: "crit", width: 9 },
    { header: "Memo", key: "memo", width: 30 },
    { header: "Merchant reference", key: "ref", width: 44 },
  ]);
  for (const p of payments) {
    pay.addRow({
      due: p.dueDate,
      payee: p.payee.name,
      cat: CATEGORY_LABEL[p.payee.category as Category] ?? p.payee.category,
      cur: p.currency,
      amount: bn(p.amount) / 100,
      rep: p.recurrence === "NONE" ? "Once" : p.recurrence === "WEEKLY" ? "Weekly" : "Monthly",
      status: p.status.charAt(0) + p.status.slice(1).toLowerCase(),
      crit: p.critical ? "Yes" : "No",
      memo: p.memo ?? "",
      ref: p.merchantReference,
    });
  }

  // Ledger
  const led = wb.addWorksheet("Ledger");
  header(led, [
    { header: "When", key: "at", width: 18, date: true },
    { header: "Wallet", key: "cur", width: 9 },
    { header: "Movement", key: "kind", width: 12 },
    { header: "Amount", key: "amount", width: 16, money: true },
    { header: "Memo", key: "memo", width: 44 },
    { header: "Blaaiz reference", key: "ref", width: 28 },
  ]);
  const LABEL: Record<string, string> = { PAYOUT: "Payout", FEE: "Fee", SWAP_OUT: "Swap out", SWAP_IN: "Swap in", DEPOSIT: "Deposit", REFUND: "Refund" };
  for (const l of ledger) {
    led.addRow({ at: l.at, cur: l.currency, kind: LABEL[l.kind] ?? l.kind, amount: bn(l.amount) / 100, memo: l.memo, ref: l.blaaizTransactionId ?? "" });
  }

  // Wallets
  const wal = wb.addWorksheet("Wallets");
  header(wal, [
    { header: "Currency", key: "cur", width: 10 },
    { header: "Balance", key: "bal", width: 18, money: true },
    { header: "Buffer", key: "buf", width: 16, money: true },
    { header: "Above buffer", key: "free", width: 18, money: true },
    { header: "Rate (NGN per unit)", key: "rate", width: 20, money: true },
    { header: "Blaaiz wallet ID", key: "id", width: 30 },
    { header: "Funding account", key: "va", width: 34 },
  ]);
  for (const w of wallets) {
    const c = w.currency as Currency;
    const buf = policy.buffer[c] ?? 0;
    wal.addRow({ cur: c, bal: bn(w.balance) / 100, buf: buf / 100, free: (bn(w.balance) - buf) / 100, rate: rates[c], id: w.blaaizWalletId, va: w.vaAccountNumber ? `${w.vaBankName} ${w.vaAccountNumber}` : "" });
  }

  const slug = company.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const date = new Date().toISOString().slice(0, 10);
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), filename: `bursar-${slug}-${date}.xlsx` };
}
