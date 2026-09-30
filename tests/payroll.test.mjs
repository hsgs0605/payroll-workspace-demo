import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDemoEmployees, calculatePayroll, summarize, canClosePayroll, validateEmployee, exportEmployees, importEmployees, parseCSV, csvCell } from '../dist/payroll-core.mjs';

test('integer payroll arithmetic and aggregate reconciliation', () => {
  const employee = { ...makeDemoEmployees()[0], basePay: 3_000_000, mealAllowance: 200_000, extraAllowance: 123_456, bonus: 600_000, pension: 150_000, healthInsurance: 110_000, longTermCare: 14_000, employmentInsurance: 30_000, incomeTax: 120_000, localIncomeTax: 12_000, otherDeduction: 25_000 };
  assert.deepEqual(calculatePayroll(employee), { gross: 3_923_456, deductions: 461_000, net: 3_462_456 });
  const total = summarize(makeDemoEmployees());
  assert.equal(total.gross - total.deductions, total.net);
  assert.equal(total.attention, 4);
  assert.equal(makeDemoEmployees().length, 104);
});

test('closing requires reviewed records, confirmed deductions, and nonnegative net', () => {
  const employees = makeDemoEmployees().map(employee => ({ ...employee, reviewed: true, deductionsConfirmed: true }));
  assert.equal(canClosePayroll(employees), true);
  employees[0].reviewed = false;
  assert.equal(canClosePayroll(employees), false);
  employees[0].reviewed = true; employees[0].deductionsConfirmed = false;
  assert.equal(canClosePayroll(employees), false);
  employees[0].deductionsConfirmed = true; employees[0].otherDeduction = 90_000_000;
  assert.equal(canClosePayroll(employees), false);
  assert.ok(validateEmployee(employees[0]).some(issue => issue.code === 'negative-net'));
  assert.equal(canClosePayroll([]), false);
});

test('CSV roundtrip preserves commas, quotes, linebreaks, and export totals', () => {
  const employees = makeDemoEmployees().slice(0, 2);
  employees[0].note = '상여, 수당 "확인"\n다음 줄';
  const imported = importEmployees(exportEmployees(employees));
  assert.equal(imported[0].note, employees[0].note);
  assert.equal(imported[0].basePay, employees[0].basePay);
  assert.equal(imported[1].deductionsConfirmed, false);
  assert.equal(imported[0].reviewed, false);
  assert.deepEqual(calculatePayroll(imported[0]), calculatePayroll(employees[0]));
  assert.deepEqual(parseCSV('"a","b"\r\n"c","d"\r\n'), [['a', 'b'], ['c', 'd']]);
});

test('CSV rejects duplicate IDs, malformed quotes, missing columns and invalid amounts', () => {
  const employees = makeDemoEmployees().slice(0, 2);
  employees[1].id = employees[0].id;
  assert.throws(() => importEmployees(exportEmployees(employees)), /중복/);
  assert.throws(() => parseCSV('"unterminated'), /닫히지/);
  assert.throws(() => parseCSV('"a"garbage,b'), /따옴표 다음/);
  assert.throws(() => importEmployees('사번,이름\na,b'), /필수 열/);
  const clean = makeDemoEmployees().slice(0, 1);
  const bad = exportEmployees(clean).replace('"3200000"', '"no"').replace('"2600000"', '"no"');
  assert.throws(() => importEmployees(bad), /정수/);
});

test('CSV prevents spreadsheet formula execution and validates money boundaries', () => {
  assert.equal(csvCell('=HYPERLINK("https://example.com")'), '"\'=HYPERLINK(""https://example.com"")"');
  assert.ok(csvCell(' +1').startsWith('"\''));
  const employee = makeDemoEmployees()[0];
  employee.basePay = 1.5;
  assert.ok(validateEmployee(employee).some(issue => issue.code === 'amount'));
  employee.basePay = -1;
  assert.ok(validateEmployee(employee).some(issue => issue.code === 'amount'));
});
