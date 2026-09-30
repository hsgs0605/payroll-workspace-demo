export const earningFields = [
  ['basePay', '기본급'], ['mealAllowance', '식대'], ['extraAllowance', '추가 수당'], ['bonus', '상여'],
];
export const deductionFields = [
  ['pension', '국민연금'], ['healthInsurance', '건강보험'], ['longTermCare', '장기요양'],
  ['employmentInsurance', '고용보험'], ['incomeTax', '소득세'], ['localIncomeTax', '지방소득세'], ['otherDeduction', '기타 공제'],
];
export const amountKeys = [...earningFields, ...deductionFields].map(([key]) => key);
export const MAX_AMOUNT = 1_000_000_000;
export const csvColumns = [
  ['id', '사번'], ['name', '이름'], ['department', '부서'], ['position', '직급'],
  ...earningFields, ...deductionFields, ['previousNet', '전월실지급액'],
  ['deductionsConfirmed', '공제확인'], ['note', '검토메모'],
];

export function calculatePayroll(employee) {
  const gross = earningFields.reduce((sum, [key]) => sum + employee[key], 0);
  const deductions = deductionFields.reduce((sum, [key]) => sum + employee[key], 0);
  return { gross, deductions, net: gross - deductions };
}

export function validateEmployee(employee) {
  const issues = [];
  for (const key of [...amountKeys, 'previousNet']) {
    if (!Number.isSafeInteger(employee[key]) || employee[key] < 0 || employee[key] > MAX_AMOUNT) {
      issues.push({ severity: 'error', code: 'amount', message: '금액은 0~10억 원 범위의 정수로 입력하세요.' });
      break;
    }
  }
  const { gross, deductions, net } = calculatePayroll(employee);
  if (gross <= 0) issues.push({ severity: 'error', code: 'zero-gross', message: '총 지급액이 0원입니다. 지급 대상을 확인하세요.' });
  if (net < 0) issues.push({ severity: 'error', code: 'negative-net', message: '공제액이 지급액보다 큽니다.' });
  if (!employee.deductionsConfirmed) issues.push({ severity: 'warning', code: 'deductions', message: '세금·보험 공제 금액이 아직 확인되지 않았습니다.' });
  if (employee.previousNet > 0 && Math.abs(net - employee.previousNet) / employee.previousNet >= 0.1) {
    issues.push({ severity: 'warning', code: 'difference', message: '전월보다 실지급액이 10% 이상 변동했습니다.' });
  }
  if (deductions === 0) issues.push({ severity: 'warning', code: 'zero-deduction', message: '공제액이 0원입니다. 적용 여부를 확인하세요.' });
  return issues;
}

export function needsAttention(employee) {
  return validateEmployee(employee).some(issue => issue.severity === 'error') || !employee.deductionsConfirmed || !employee.reviewed;
}

export function canClosePayroll(employees) {
  return employees.length > 0 && employees.every(employee => !needsAttention(employee));
}

export function summarize(employees) {
  return employees.reduce((result, employee) => {
    const values = calculatePayroll(employee);
    result.gross += values.gross;
    result.deductions += values.deductions;
    result.net += values.net;
    result.previousNet += employee.previousNet;
    result.attention += Number(needsAttention(employee));
    result.reviewed += Number(employee.reviewed && !needsAttention(employee));
    return result;
  }, { gross: 0, deductions: 0, net: 0, previousNet: 0, attention: 0, reviewed: 0 });
}

export function makeDemoEmployees() {
  const names = ['김서윤', '이도현', '박지민', '최하준', '정수빈', '강민준', '윤서연', '임지호', '한예린', '오준서', '신유진', '서지우', '권지안'];
  const departments = ['경영지원', '영업', '개발', '마케팅', '운영'];
  const positions = ['사원', '주임', '대리', '과장'];
  return Array.from({ length: 104 }, (_, index) => {
    const basePay = 2_600_000 + (index % 9) * 250_000;
    const employee = {
      id: `HB${String(index + 1).padStart(4, '0')}`,
      name: names[index % names.length] + (index >= names.length ? ` ${Math.floor(index / names.length) + 1}` : ''),
      department: departments[index % departments.length], position: positions[index % positions.length],
      basePay, mealAllowance: 200_000, extraAllowance: (index % 4) * 80_000, bonus: 0,
      // Synthetic demo amounts, deliberately not calculated from statutory rates.
      pension: 140_000 + (index % 9) * 12_000, healthInsurance: 100_000 + (index % 9) * 8_000,
      longTermCare: 13_000 + (index % 9) * 1_000, employmentInsurance: 28_000 + (index % 9) * 2_000,
      incomeTax: 45_000 + (index % 9) * 18_000, localIncomeTax: 4_500 + (index % 9) * 1_800,
      otherDeduction: 0, deductionsConfirmed: true, reviewed: true, note: '', previousNet: 0,
    };
    employee.previousNet = calculatePayroll(employee).net;
    if (index === 0) { employee.bonus = 600_000; employee.reviewed = false; employee.note = '분기 성과급 지급 대상'; }
    if (index === 1) { employee.deductionsConfirmed = false; employee.reviewed = false; employee.note = '공제자료 확인 대기'; }
    if (index === 2) { employee.extraAllowance += 450_000; employee.reviewed = false; employee.note = '프로젝트 추가 수당 확인'; }
    if (index === 3) { employee.otherDeduction = 80_000; employee.reviewed = false; employee.note = '기타 공제 확인'; }
    return employee;
  });
}

export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false, afterQuote = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; afterQuote = true; }
      } else field += char;
    } else if (char === '"') {
      if (field || afterQuote) throw new Error('CSV 따옴표 형식이 올바르지 않습니다.');
      quoted = true;
    } else if (char === ',') {
      row.push(field); field = ''; afterQuote = false;
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = ''; afterQuote = false;
    } else {
      if (afterQuote) throw new Error('닫는 따옴표 다음에는 쉼표 또는 줄바꿈이 필요합니다.');
      field += char;
    }
  }
  if (quoted) throw new Error('CSV 따옴표가 닫히지 않았습니다.');
  if (field || row.length || afterQuote) { row.push(field); rows.push(row); }
  return rows.filter(record => record.some(cell => cell.trim() !== ''));
}

export function importEmployees(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('헤더와 최소 1명의 직원 자료가 필요합니다.');
  if (rows.length > 501) throw new Error('한 번에 최대 500명까지 가져올 수 있습니다.');
  const headers = rows[0].map(header => header.trim());
  if (new Set(headers).size !== headers.length) throw new Error('중복된 열 이름이 있습니다.');
  const required = csvColumns.filter(([key]) => key !== 'note' && key !== 'position');
  const missing = required.filter(([, label]) => !headers.includes(label));
  if (missing.length) throw new Error(`필수 열이 없습니다: ${missing.map(([, label]) => label).join(', ')}`);
  const ids = new Set();
  return rows.slice(1).map((row, index) => {
    if (row.length !== headers.length) throw new Error(`${index + 2}행의 열 개수가 헤더와 다릅니다.`);
    const employee = { reviewed: false, note: '', position: '' };
    for (const [key, label] of csvColumns) {
      const column = headers.indexOf(label);
      const raw = column < 0 ? '' : row[column].trim();
      if ([...amountKeys, 'previousNet'].includes(key)) {
        const clean = raw.replace(/,/g, '');
        if (!/^\d+$/.test(clean)) throw new Error(`${index + 2}행 ${label}: 0 이상의 정수를 입력하세요.`);
        const amount = Number(clean);
        if (!Number.isSafeInteger(amount) || amount > MAX_AMOUNT) throw new Error(`${index + 2}행 ${label}: 금액 범위를 확인하세요.`);
        employee[key] = amount;
      } else if (key === 'deductionsConfirmed') {
        if (!['Y', 'N'].includes(raw.toUpperCase())) throw new Error(`${index + 2}행 공제확인: Y 또는 N을 입력하세요.`);
        employee[key] = raw.toUpperCase() === 'Y';
      } else {
        if (raw.length > (key === 'note' ? 500 : 80)) throw new Error(`${index + 2}행 ${label}: 값이 너무 깁니다.`);
        // Reverse the spreadsheet formula guard added by this app's own export.
        employee[key] = /^'[=+@-]/.test(raw) ? raw.slice(1) : raw;
      }
    }
    if (!employee.id || !employee.name || !employee.department) throw new Error(`${index + 2}행: 사번, 이름, 부서는 필수입니다.`);
    if (ids.has(employee.id)) throw new Error(`${index + 2}행: 사번 ${employee.id}가 중복되었습니다.`);
    ids.add(employee.id);
    return employee;
  });
}

export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function exportEmployees(employees, includeTotals = true) {
  const columns = [...csvColumns];
  if (includeTotals) columns.push(['gross', '총지급액'], ['deductions', '총공제액'], ['net', '실지급액'], ['reviewed', '검토완료']);
  const rows = [columns.map(([, label]) => label), ...employees.map(employee => {
    const record = { ...employee, ...calculatePayroll(employee) };
    return columns.map(([key]) => typeof record[key] === 'boolean' ? (record[key] ? 'Y' : 'N') : record[key]);
  })];
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
