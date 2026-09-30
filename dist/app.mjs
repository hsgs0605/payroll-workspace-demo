import { earningFields, deductionFields, amountKeys, MAX_AMOUNT, calculatePayroll, validateEmployee, needsAttention, canClosePayroll, summarize, makeDemoEmployees, importEmployees, exportEmployees } from './payroll-core.mjs';

const $ = id => document.getElementById(id);
const won = value => new Intl.NumberFormat('ko-KR').format(value);
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const STORAGE_KEY = 'payroll-workspace-demo-v1';
const PAGE_SIZE = 12;
let currentView = 'payroll', filter = 'all', page = 1, activeEmployeeId = null, pendingImport = null, confirmationAction = null, tourStep = null, toastTimer;
let storageAvailable = true;

function createPeriod(month) {
  return { month, paymentDate: `${month}-25`, employees: makeDemoEmployees(), status: 'draft', validated: false, closedAt: null };
}

function validSavedState(value) {
  if (value?.version !== 1 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.currentMonth) || !value.periods || !value.periods[value.currentMonth]) return false;
  return Object.entries(value.periods).every(([month, period]) => {
    if (period.month !== month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !/^\d{4}-\d{2}-\d{2}$/.test(period.paymentDate) || !['draft', 'closed'].includes(period.status) || typeof period.validated !== 'boolean') return false;
    if (!Array.isArray(period.employees) || period.employees.length < 1 || period.employees.length > 500) return false;
    const ids = new Set();
    return period.employees.every(employee => {
      if (typeof employee.id !== 'string' || !employee.id || ids.has(employee.id)) return false;
      ids.add(employee.id);
      return ['name', 'department', 'position', 'note'].every(key => typeof employee[key] === 'string') &&
        [...amountKeys, 'previousNet'].every(key => Number.isSafeInteger(employee[key]) && employee[key] >= 0 && employee[key] <= MAX_AMOUNT) &&
        typeof employee.deductionsConfirmed === 'boolean' && typeof employee.reviewed === 'boolean';
    });
  });
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (validSavedState(saved)) return saved;
  } catch { storageAvailable = false; }
  return { version: 1, currentMonth: '2026-09', periods: { '2026-09': createPeriod('2026-09') } };
}
let state = loadState();
const period = () => state.periods[state.currentMonth];
const isClosed = () => period().status === 'closed';

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); storageAvailable = true; }
  catch { storageAvailable = false; }
  updateStorageNotice();
}

function updateStorageNotice() {
  $('saved-state').textContent = storageAvailable ? '변경 내용은 이 브라우저에 저장됩니다.' : '브라우저 저장이 불가능합니다. 새로고침 전에 CSV를 내려받으세요.';
}

function toast(message) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
  toastTimer = setTimeout(() => $('toast').hidden = true, 4200);
}

function badge(employee) {
  const issues = validateEmployee(employee);
  if (issues.some(issue => issue.severity === 'error')) return '<span class="badge badge-error">입력 오류</span>';
  if (!employee.deductionsConfirmed) return '<span class="badge badge-warning">공제 미확인</span>';
  if (!employee.reviewed) return '<span class="badge badge-warning">검토 필요</span>';
  return '<span class="badge badge-success">확인 완료</span>';
}

function render() {
  const data = period();
  const totals = summarize(data.employees);
  $('payroll-month').value = state.currentMonth;
  $('payment-date').value = data.paymentDate;
  $('payment-date').disabled = isClosed();
  $('period-status').textContent = isClosed() ? '마감 완료' : data.validated ? '검토 중' : '작성 중';
  $('period-status').className = `badge ${isClosed() ? 'badge-success' : 'badge-neutral'}`;
  $('close-payroll').textContent = isClosed() ? '마감 해제' : '급여 마감';
  $('import-csv').disabled = isClosed();
  $('metric-employees').innerHTML = `${data.employees.length}<span>명</span>`;
  $('metric-gross').textContent = won(totals.gross);
  $('metric-deductions').textContent = won(totals.deductions);
  $('metric-net').textContent = won(totals.net);
  const difference = totals.net - totals.previousNet;
  $('metric-difference').textContent = `전월 대비 ${difference > 0 ? '+' : ''}${won(difference)}원`;
  $('nav-review-count').textContent = totals.attention;
  $('filter-all-count').textContent = data.employees.length;
  $('filter-attention-count').textContent = totals.attention;
  $('filter-reviewed-count').textContent = totals.reviewed;
  $('progress-review').classList.toggle('complete', data.validated && totals.attention === 0);
  $('progress-review-copy').textContent = data.validated ? totals.attention ? `${totals.attention}명 확인 필요` : '전원 확인 완료' : '검토를 실행하세요';
  $('progress-close').classList.toggle('complete', isClosed());
  $('ledger-caption').textContent = isClosed() ? '마감된 급여입니다. 명세서를 조회하거나 마감을 해제해 수정하세요.' : '직원을 선택해 지급·공제 내역을 수정하세요.';
  const previousDepartment = $('department-filter').value;
  const departments = [...new Set(data.employees.map(employee => employee.department))];
  $('department-filter').innerHTML = '<option value="all">모든 부서</option>' + departments.map(department => `<option value="${escapeHTML(department)}">${escapeHTML(department)}</option>`).join('');
  $('department-filter').value = departments.includes(previousDepartment) ? previousDepartment : 'all';
  renderRows(); renderReview(); updateStorageNotice();
  document.querySelector('.workspace small').textContent = `가상 사업장 · 직원 ${data.employees.length}명`;
  document.querySelector('[data-view="payroll"] .nav-count').textContent = data.employees.length;
}

function filteredEmployees() {
  const search = $('employee-search').value.trim().toLowerCase();
  const department = $('department-filter').value;
  return period().employees.filter(employee => {
    if (filter === 'attention' && !needsAttention(employee)) return false;
    if (filter === 'reviewed' && needsAttention(employee)) return false;
    if (department !== 'all' && department !== employee.department) return false;
    return !search || `${employee.name} ${employee.id}`.toLowerCase().includes(search);
  });
}

function renderRows() {
  const employees = filteredEmployees();
  const pages = Math.max(1, Math.ceil(employees.length / PAGE_SIZE));
  page = Math.min(page, pages);
  const start = (page - 1) * PAGE_SIZE;
  $('payroll-rows').innerHTML = employees.slice(start, start + PAGE_SIZE).map(employee => {
    const totals = calculatePayroll(employee);
    return `<tr><td><div class="employee-cell"><span class="employee-avatar" aria-hidden="true">${escapeHTML(employee.name.slice(0, 1))}</span><div><button class="employee-name" data-employee="${escapeHTML(employee.id)}">${escapeHTML(employee.name)}</button><span class="employee-id">${escapeHTML(employee.id)} · ${escapeHTML(employee.position)}</span></div></div></td><td>${escapeHTML(employee.department)}</td><td class="numeric">${won(employee.basePay)}</td><td class="numeric">${won(totals.gross - employee.basePay)}</td><td class="numeric">${won(totals.deductions)}</td><td class="numeric net-cell">${won(totals.net)}</td><td>${badge(employee)}</td><td><button class="row-open" data-employee="${escapeHTML(employee.id)}" aria-label="${escapeHTML(employee.name)} 급여 상세보기">›</button></td></tr>`;
  }).join('') || '<tr><td colspan="8" class="empty-row">조건에 맞는 직원이 없습니다.</td></tr>';
  $('table-range').textContent = employees.length ? `${employees.length}명 중 ${start + 1}–${Math.min(start + PAGE_SIZE, employees.length)}명` : '0명';
  $('page-number').textContent = `${page} / ${pages}`;
  $('prev-page').disabled = page === 1;
  $('next-page').disabled = page === pages;
  document.querySelectorAll('[data-filter]').forEach(button => { button.classList.toggle('active', button.dataset.filter === filter); button.setAttribute('aria-pressed', String(button.dataset.filter === filter)); });
}

function renderReview() {
  const employees = period().employees.filter(needsAttention);
  const errors = employees.filter(employee => validateEmployee(employee).some(issue => issue.severity === 'error')).length;
  $('review-summary').innerHTML = `<div class="review-summary"><strong>${employees.length}명 확인 필요</strong><span>입력 오류 ${errors}명 · 공제 미확인 ${employees.filter(employee => !employee.deductionsConfirmed).length}명</span></div>`;
  $('review-list').innerHTML = employees.map(employee => {
    const issues = validateEmployee(employee);
    if (!employee.reviewed && !issues.length) issues.push({ message: '변경 내역의 확인이 필요합니다.' });
    return `<article class="review-card"><div><div class="review-card-title">${escapeHTML(employee.name)} <span>${escapeHTML(employee.id)} · ${escapeHTML(employee.department)}</span></div>${issues.map(issue => `<p>${escapeHTML(issue.message)}</p>`).join('')}<small>${employee.note ? escapeHTML(employee.note) : '메모 없음'}</small></div><button class="button button-outline" data-employee="${escapeHTML(employee.id)}">내역 확인</button></article>`;
  }).join('') || '<article class="review-card"><div><div class="review-card-title">모든 직원의 급여 확인이 완료되었습니다.</div><small>월 급여 화면에서 마감하고 결과를 내려받으세요.</small></div><button class="button button-primary" data-go-payroll>월 급여로 이동</button></article>';
}

function changeView(view) {
  currentView = view;
  const titles = { payroll: ['월 급여', '급여를 정리하고, 차이를 확인하고, 이번 달을 마감하세요.'], review: ['급여 검토함', '확인이 필요한 내역을 한곳에서 처리하세요.'], guide: ['사용 가이드', '가상 데이터로 급여 처리 흐름을 직접 살펴보세요.'] };
  ['payroll', 'review', 'guide'].forEach(name => $(name + '-view').hidden = name !== view);
  document.querySelectorAll('[data-view]').forEach(button => { button.classList.toggle('active', button.dataset.view === view); button.setAttribute('aria-current', button.dataset.view === view ? 'page' : 'false'); });
  $('page-title').textContent = titles[view][0]; $('breadcrumb').textContent = titles[view][0]; $('page-description').textContent = titles[view][1];
}

function fieldHTML([key, label], employee) {
  return `<label class="money-field" for="amount-${key}"><span>${label}</span><input id="amount-${key}" name="${key}" type="number" min="0" max="${MAX_AMOUNT}" step="1" required value="${employee[key]}" ${isClosed() ? 'disabled' : ''}></label>`;
}

function openEmployee(id) {
  const employee = period().employees.find(item => item.id === id);
  if (!employee) return;
  activeEmployeeId = id;
  $('employee-dialog-title').textContent = `${employee.name} · 급여 상세`;
  $('employee-meta').textContent = `${employee.id} · ${employee.department} · ${employee.position} · ${state.currentMonth}`;
  $('earning-fields').innerHTML = earningFields.map(field => fieldHTML(field, employee)).join('');
  $('deduction-fields').innerHTML = deductionFields.map(field => fieldHTML(field, employee)).join('');
  $('deductions-confirmed').checked = employee.deductionsConfirmed;
  $('employee-reviewed').checked = employee.reviewed;
  $('review-note').value = employee.note;
  ['deductions-confirmed', 'employee-reviewed', 'review-note'].forEach(id => $(id).disabled = isClosed());
  $('save-employee').hidden = isClosed();
  $('print-payslip').textContent = isClosed() ? '급여명세서 인쇄' : '명세서 미리보기';
  refreshEmployeePreview();
  $('employee-dialog').showModal();
}

function readEmployeeDraft() {
  const employee = period().employees.find(item => item.id === activeEmployeeId);
  const updated = { ...employee };
  amountKeys.forEach(key => updated[key] = Number($('amount-' + key).value));
  updated.deductionsConfirmed = $('deductions-confirmed').checked;
  updated.reviewed = $('employee-reviewed').checked;
  updated.note = $('review-note').value.trim();
  return updated;
}

function refreshEmployeePreview() {
  const employee = readEmployeeDraft();
  const totals = calculatePayroll(employee);
  $('employee-net-preview').textContent = `${won(totals.net)}원`;
  $('employee-gross-preview').textContent = `지급 ${won(totals.gross)}원 − 공제 ${won(totals.deductions)}원`;
  const issues = validateEmployee(employee);
  $('employee-warnings').innerHTML = issues.length ? `<div class="warning-box ${issues.some(issue => issue.severity === 'error') ? 'error' : ''}">${issues.map(issue => `<p>${escapeHTML(issue.message)}</p>`).join('')}</div>` : '';
}

function saveEmployee(event) {
  event.preventDefault(); if (isClosed()) return;
  const updated = readEmployeeDraft();
  if (validateEmployee(updated).some(issue => issue.severity === 'error')) { toast('입력 오류를 해결한 뒤 저장하세요.'); return; }
  if (updated.reviewed && !updated.deductionsConfirmed) { toast('공제 금액을 확인한 뒤 내역 확인을 완료하세요.'); return; }
  period().employees = period().employees.map(employee => employee.id === updated.id ? updated : employee);
  period().validated = false;
  saveState(); render(); $('employee-dialog').close(); toast(`${updated.name}님의 급여가 저장되었습니다.`);
}

function runReview(showReview = false) {
  period().validated = true; saveState(); render();
  const count = summarize(period().employees).attention;
  toast(count ? `${count}명의 급여 내역을 확인하세요.` : '모든 직원의 급여 확인이 완료되었습니다.');
  if (showReview || count) changeView('review');
}

function confirm(title, message, label, action) {
  $('confirm-title').textContent = title; $('confirm-message').textContent = message;
  $('confirm-action').textContent = label; confirmationAction = action; $('confirm-dialog').showModal();
}

function closePayroll() {
  if (isClosed()) {
    confirm('급여 마감을 해제할까요?', '마감을 해제하면 지급·공제 내역을 다시 수정할 수 있습니다. 수정 후 검토와 마감을 다시 진행하세요.', '마감 해제', () => { period().status = 'draft'; period().validated = false; period().closedAt = null; saveState(); render(); toast('마감이 해제되었습니다.'); });
    return;
  }
  if (!period().validated) { runReview(); if (canClosePayroll(period().employees)) toast('급여 검토가 완료되었습니다. 다시 마감을 선택하세요.'); return; }
  if (!canClosePayroll(period().employees)) { changeView('review'); toast('입력 오류와 미확인 내역을 모두 해소한 뒤 마감하세요.'); return; }
  if (!$('payment-date').checkValidity() || !period().paymentDate) { toast('유효한 지급일을 입력하세요.'); return; }
  const totals = summarize(period().employees);
  confirm(`${state.currentMonth} 급여를 마감할까요?`, `${period().employees.length}명 · 실지급액 ${won(totals.net)}원 · 지급일 ${period().paymentDate}. 마감 후 수정하려면 마감을 해제해야 합니다.`, '급여 마감', () => {
    period().status = 'closed'; period().closedAt = new Date().toISOString(); saveState(); render(); toast('급여 마감이 완료되었습니다. 급여대장과 명세서를 출력할 수 있습니다.');
  });
}

function download(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadTemplate() { download(exportEmployees(makeDemoEmployees().slice(0, 3), false), '급여입력_양식.csv'); }

function printPayslip() {
  const saved = period().employees.find(employee => employee.id === activeEmployeeId);
  const draft = readEmployeeDraft();
  const dirty = [...amountKeys, 'note', 'deductionsConfirmed', 'reviewed'].some(key => saved[key] !== draft[key]);
  if (dirty) { toast('수정한 내용을 먼저 저장한 뒤 명세서를 출력하세요.'); return; }
  const totals = calculatePayroll(saved);
  const lines = Array.from({ length: Math.max(earningFields.length, deductionFields.length) }, (_, index) => {
    const earning = earningFields[index], deduction = deductionFields[index];
    return `<tr><td>${earning ? earning[1] : ''}</td><td class="numeric">${earning ? won(saved[earning[0]]) : ''}</td><td>${deduction ? deduction[1] : ''}</td><td class="numeric">${deduction ? won(saved[deduction[0]]) : ''}</td></tr>`;
  }).join('');
  $('print-area').innerHTML = `<div class="payslip-header"><h1>${escapeHTML(state.currentMonth)} 급여명세서</h1><p>한빛컴퍼니 · ${isClosed() ? '마감 완료' : '미마감 미리보기'}</p></div><div class="payslip-meta"><span>성명: ${escapeHTML(saved.name)}</span><span>사번: ${escapeHTML(saved.id)}</span><span>부서: ${escapeHTML(saved.department)}</span><span>직급: ${escapeHTML(saved.position)}</span><span>귀속월: ${escapeHTML(state.currentMonth)}</span><span>지급일: ${escapeHTML(period().paymentDate)}</span></div><table class="payslip-table"><thead><tr><th>지급 항목</th><th class="numeric">금액 (원)</th><th>공제 항목</th><th class="numeric">금액 (원)</th></tr></thead><tbody>${lines}<tr><th>지급 합계</th><th class="numeric">${won(totals.gross)}</th><th>공제 합계</th><th class="numeric">${won(totals.deductions)}</th></tr></tbody></table><div class="payslip-net"><strong>실지급액</strong><strong>${won(totals.net)}원</strong></div><p class="payslip-note">계산: 기본급 + 식대 + 추가 수당 + 상여 − 공제 합계<br>세금·보험료 및 추가 수당은 확인된 금액을 입력해 합산합니다.<br>검토 메모: ${saved.note ? escapeHTML(saved.note) : '없음'}</p><p class="payslip-footer">시연용 가상 데이터 · 실제 교부용 명세서는 회사 기준과 법정 기재사항을 검증해 사용하세요.</p>`;
  window.print();
}

const tourSteps = [
  { title: '급여대장을 살펴보세요', description: '104명의 가상 직원 자료가 준비되어 있습니다. 직원별 지급·공제 합계와 실지급액을 바로 확인할 수 있습니다.', action: '급여대장 보기', run: () => { changeView('payroll'); filter = 'all'; page = 1; renderRows(); document.querySelector('.ledger-panel').scrollIntoView({ behavior: 'smooth', block: 'center' }); } },
  { title: '한 직원의 급여를 수정하세요', description: '김서윤님의 상여와 공제 금액을 확인하고 내역 확인을 완료해 저장하세요. 금액을 바꾸면 실지급액이 즉시 계산됩니다.', action: '직원 상세 열기', run: () => { changeView('payroll'); openEmployee(period().employees[0].id); } },
  { title: '검토가 필요한 직원을 확인하세요', description: '급여 검토를 실행해 남은 내역을 확인하세요. 공제 미확인과 변동 사유를 확인하고 직원별 내역 확인을 완료합니다.', action: '급여 검토 실행', run: () => runReview(true) },
  { title: '확인 후 마감하고 결과를 출력하세요', description: '직원별 확인을 모두 끝낸 뒤 급여 마감을 선택하세요. 급여대장을 내려받고 직원 상세에서 명세서를 인쇄·PDF로 저장할 수 있습니다.', action: '월 급여로 이동', run: () => { changeView('payroll'); window.scrollTo({ top: 0, behavior: 'smooth' }); } },
];

function renderTour() {
  $('tour-panel').hidden = tourStep === null;
  if (tourStep === null) return;
  const item = tourSteps[tourStep];
  $('tour-step-label').textContent = `DEMO GUIDE · ${tourStep + 1} / ${tourSteps.length}`;
  $('tour-title').textContent = item.title; $('tour-description').textContent = item.description;
  $('tour-action').textContent = item.action; $('tour-next').textContent = tourStep === tourSteps.length - 1 ? '시연 안내 끝내기' : '다음 단계';
}

function startTour() { tourStep = 0; changeView('payroll'); renderTour(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

document.addEventListener('click', event => {
  const employeeButton = event.target.closest('[data-employee]'); if (employeeButton) openEmployee(employeeButton.dataset.employee);
  const viewButton = event.target.closest('[data-view]'); if (viewButton) changeView(viewButton.dataset.view);
  const filterButton = event.target.closest('[data-filter]'); if (filterButton) { filter = filterButton.dataset.filter; page = 1; renderRows(); }
  const dialogButton = event.target.closest('[data-close-dialog]'); if (dialogButton) $(dialogButton.dataset.closeDialog).close();
  if (event.target.closest('[data-go-payroll]')) changeView('payroll');
});
$('employee-search').addEventListener('input', () => { page = 1; renderRows(); });
$('department-filter').addEventListener('change', () => { page = 1; renderRows(); });
$('prev-page').addEventListener('click', () => { page--; renderRows(); });
$('next-page').addEventListener('click', () => { page++; renderRows(); });
$('payroll-month').addEventListener('change', event => {
  const month = event.target.value;
  if (!event.target.checkValidity() || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return;
  if (!state.periods[month]) state.periods[month] = createPeriod(month);
  state.currentMonth = month; page = 1; filter = 'all'; $('employee-search').value = ''; $('department-filter').value = 'all'; saveState(); render();
  toast(`${month} 급여대장을 열었습니다. 새 월은 가상 데이터로 시작합니다.`);
});
$('payment-date').addEventListener('change', event => {
  if (isClosed()) return;
  if (!event.target.value || !event.target.checkValidity()) { event.target.value = period().paymentDate; toast('유효한 지급일을 입력하세요.'); return; }
  period().paymentDate = event.target.value; saveState();
});
$('employee-form').addEventListener('input', event => {
  if (event.target.matches('input[type="number"], #deductions-confirmed')) { $('employee-reviewed').checked = false; refreshEmployeePreview(); }
});
$('employee-form').addEventListener('submit', saveEmployee);
$('validate-payroll').addEventListener('click', () => runReview());
$('review-run').addEventListener('click', () => runReview(true));
$('close-payroll').addEventListener('click', closePayroll);
$('confirm-action').addEventListener('click', () => { $('confirm-dialog').close(); const action = confirmationAction; confirmationAction = null; action?.(); });
$('print-payslip').addEventListener('click', printPayslip);
$('export-csv').addEventListener('click', () => { download(exportEmployees(period().employees), `급여대장_${state.currentMonth}_${isClosed() ? '마감' : '미마감'}.csv`); toast('전체 직원의 급여대장을 내려받았습니다.'); });
['download-template', 'import-template'].forEach(id => $(id).addEventListener('click', downloadTemplate));
$('import-csv').addEventListener('click', () => {
  if (isClosed()) return;
  pendingImport = null; $('csv-file').value = ''; $('import-result').textContent = ''; $('confirm-import').disabled = true; $('import-dialog').showModal();
});
$('csv-file').addEventListener('change', async event => {
  pendingImport = null; $('confirm-import').disabled = true; $('import-result').textContent = '';
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 1_000_000) throw new Error('1MB 이하의 CSV 파일을 선택하세요.');
    const text = await file.text();
    if (text.includes('\uFFFD')) throw new Error('UTF-8 CSV로 저장한 파일을 선택하세요.');
    const rows = importEmployees(text);
    if (event.target.files[0] !== file) return;
    pendingImport = rows;
    const invalid = rows.filter(employee => validateEmployee(employee).some(issue => issue.severity === 'error')).length;
    $('import-result').innerHTML = `<div class="import-success">${rows.length}명 · 총 지급액 ${won(summarize(rows).gross)}원<br>가져오기 후 전원 재검토가 필요합니다.${invalid ? `<br>입력 오류 ${invalid}명은 수정 후 마감할 수 있습니다.` : ''}</div>`;
    $('confirm-import').disabled = false;
  } catch (error) { if (event.target.files[0] !== file) return; $('import-result').innerHTML = `<div class="import-error">${escapeHTML(error.message)}</div>`; }
});
$('confirm-import').addEventListener('click', () => {
  if (!pendingImport || isClosed()) return;
  period().employees = pendingImport; period().validated = false; pendingImport = null; page = 1; filter = 'all'; $('employee-search').value = ''; $('department-filter').value = 'all';
  saveState(); render(); $('import-dialog').close(); toast('급여자료를 가져왔습니다. 직원별 내역을 다시 확인하세요.');
});
function resetDemo() { confirm('시연 데이터를 초기화할까요?', '이 브라우저에서 수정한 모든 월의 시연 데이터가 초기화됩니다. 필요한 자료는 먼저 CSV로 내려받으세요.', '초기화', () => {
  state = { version: 1, currentMonth: '2026-09', periods: { '2026-09': createPeriod('2026-09') } }; filter = 'all'; page = 1; $('employee-search').value = ''; $('department-filter').value = 'all'; tourStep = null; saveState(); render(); renderTour(); changeView('payroll'); toast('104명의 가상 직원 데이터로 초기화했습니다.');
}); }
['reset-demo', 'reset-demo-guide'].forEach(id => $(id).addEventListener('click', resetDemo));
['demo-tour', 'guide-start'].forEach(id => $(id).addEventListener('click', startTour));
$('tour-next').addEventListener('click', () => { tourStep = tourStep === tourSteps.length - 1 ? null : tourStep + 1; renderTour(); });
$('tour-action').addEventListener('click', () => tourSteps[tourStep]?.run());
$('tour-close').addEventListener('click', () => { tourStep = null; renderTour(); });
render(); changeView(currentView);
