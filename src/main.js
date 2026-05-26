import ExtensionsAPI from 'sn-extension-api';
import './style.css';

// --- Markdown parsing/serialization ---

function parseDaily(lines) {
  const rows = [];
  for (const line of lines) {
    const match = line.match(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(.+?)\s*\|\s*(\d+)\s*\|/);
    if (match) {
      rows.push({ date: match[1], category: match[2].trim(), cost: parseInt(match[3]) });
    }
  }
  return rows;
}

function parseRecurring(lines) {
  // Detect header order to support both legacy and new column layouts.
  // Legacy: Category | Item | Due       | Amount   | Paid
  // New:    Category | Item | Last Paid | Next Due | Amount
  let layout = 'new';
  for (const line of lines) {
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 5 && /^category$/i.test(cells[0])) {
      if (/^due$/i.test(cells[2]) && /^paid$/i.test(cells[4])) layout = 'legacy';
      else layout = 'new';
      break;
    }
  }

  const rows = [];
  for (const line of lines) {
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 5 && !cells[0].startsWith('--') && !/^category$/i.test(cells[0])) {
      if (layout === 'legacy') {
        // Migrate: legacy "Paid" date becomes lastPaid; "Due" becomes nextDue.
        rows.push({
          category: cells[0],
          item: cells[1],
          lastPaid: cells[4] === '-' ? '' : cells[4],
          nextDue: cells[2],
          amount: cells[3],
        });
      } else {
        rows.push({
          category: cells[0],
          item: cells[1],
          lastPaid: cells[2] === '-' ? '' : cells[2],
          nextDue: cells[3],
          amount: cells[4],
        });
      }
    }
  }
  return rows;
}

function parseMarkdown(text) {
  if (!text) return { daily: [], recurring: [] };

  const lines = text.split('\n');
  let dailyLines = [];
  let recurringLines = [];
  let target = null;

  for (const line of lines) {
    if (/daily expenses/i.test(line)) { target = 'daily'; continue; }
    if (/recurring expenses/i.test(line)) { target = 'recurring'; continue; }
    if (target === 'daily') dailyLines.push(line);
    if (target === 'recurring') recurringLines.push(line);
  }

  return {
    daily: parseDaily(dailyLines),
    recurring: parseRecurring(recurringLines),
  };
}

function pad(str, len) {
  const s = String(str);
  return s + ' '.repeat(Math.max(0, len - s.length));
}

function serializeMarkdown(daily, recurring) {
  let md = '# Spending\n\n## Yearly Recurring Expenses\n\n';

  const rCatW = Math.max(8, ...recurring.map(r => r.category.length));
  const rItemW = Math.max(4, ...recurring.map(r => r.item.length));
  const rLastW = Math.max(9, ...recurring.map(r => (r.lastPaid || '-').length));
  const rNextW = Math.max(8, ...recurring.map(r => r.nextDue.length));
  const rAmtW = Math.max(6, ...recurring.map(r => r.amount.length));

  md += `| ${pad('Category', rCatW)} | ${pad('Item', rItemW)} | ${pad('Last Paid', rLastW)} | ${pad('Next Due', rNextW)} | ${pad('Amount', rAmtW)} |\n`;
  md += `| ${'-'.repeat(rCatW)} | ${'-'.repeat(rItemW)} | ${'-'.repeat(rLastW)} | ${'-'.repeat(rNextW)} | ${'-'.repeat(rAmtW)} |\n`;
  for (const r of recurring) {
    md += `| ${pad(r.category, rCatW)} | ${pad(r.item, rItemW)} | ${pad(r.lastPaid || '-', rLastW)} | ${pad(r.nextDue, rNextW)} | ${pad(r.amount, rAmtW)} |\n`;
  }

  md += '\n---\n\n## Daily Expenses\n\n';

  const dCatW = Math.max(8, ...daily.map(r => r.category.length));
  const dCostW = Math.max(10, ...daily.map(r => String(r.cost).length));

  md += `| ${pad('Date', 10)} | ${pad('Category', dCatW)} | ${pad('Cost (lei)', dCostW)} |\n`;
  md += `| ${'-'.repeat(10)} | ${'-'.repeat(dCatW)} | ${'-'.repeat(dCostW)} |\n`;
  for (const r of daily) {
    md += `| ${pad(r.date, 10)} | ${pad(r.category, dCatW)} | ${pad(String(r.cost), dCostW)} |\n`;
  }

  return md;
}

// --- State ---

let daily = [];
let recurring = [];
let editorKit = null;
let editingDailyIndex = null;
let editingRecurringIndex = null;

// --- Rendering ---

function getCategories() {
  const cats = new Set(daily.map(r => r.category));
  return [...cats].sort();
}

function renderCategoryOptions() {
  const select = document.getElementById('expense-category');
  const cats = getCategories();
  select.innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');
}

function renderDaily() {
  const tbody = document.querySelector('#daily-table tbody');
  tbody.innerHTML = daily.map((r, i) => `
    <tr>
      <td>${r.date}</td>
      <td>${r.category}</td>
      <td class="cost-cell">${r.cost.toLocaleString()}</td>
      <td><button class="btn btn-small btn-edit" data-action="edit-daily" data-index="${i}">edit</button> <button class="btn btn-small btn-danger" data-action="delete-daily" data-index="${i}">x</button></td>
    </tr>
  `).join('');
}

function daysUntil(dateStr) {
  const due = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((due - now) / (1000 * 60 * 60 * 24));
}

function statusBadge(days) {
  const base = 'display:inline-block !important;padding:2px 8px !important;border-radius:4px !important;font-size:11px !important;font-weight:600 !important;white-space:nowrap !important;';
  if (days < 0) return `<span style="${base}background:#dc3545 !important;color:#fff !important;">Overdue ${Math.abs(days)}d</span>`;
  if (days === 0) return `<span style="${base}background:#dc3545 !important;color:#fff !important;">Due today</span>`;
  if (days <= 30) return `<span style="${base}background:#ffa500 !important;color:#fff !important;">${days}d left</span>`;
  if (days <= 90) return `<span style="${base}background:#17a2b8 !important;color:#fff !important;">${days}d left</span>`;
  return `<span style="${base}background:rgba(136,136,136,0.15) !important;color:#888 !important;">${days}d left</span>`;
}

function addYears(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y + n, m - 1, d);
  // Handle Feb 29 rolling into March on non-leap years.
  if (target.getMonth() !== m - 1) {
    return `${y + n}-${String(m).padStart(2, '0')}-${String(new Date(y + n, m, 0).getDate()).padStart(2, '0')}`;
  }
  return `${y + n}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function renderRecurring() {
  const tbody = document.querySelector('#recurring-table tbody');
  tbody.innerHTML = recurring.map((r, i) => {
    const days = daysUntil(r.nextDue);
    const rowClass = days < 0 ? 'row-overdue' : days <= 30 ? 'row-urgent' : '';
    return `
    <tr class="${rowClass}">
      <td>${r.category}</td>
      <td>${r.item}</td>
      <td class="${r.lastPaid ? 'paid-yes' : 'paid-no'}">${r.lastPaid || '-'}</td>
      <td>${r.nextDue}</td>
      <td>${statusBadge(days)}</td>
      <td>${r.amount}</td>
      <td>
        <button class="btn btn-small btn-edit" data-action="edit-recurring" data-index="${i}">edit</button>
        <button class="btn btn-small btn-mark" data-action="mark-paid" data-index="${i}">paid</button>
        <button class="btn btn-small btn-danger" data-action="delete-recurring" data-index="${i}">x</button>
      </td>
    </tr>
  `;}).join('');
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function renderMonthlyStats() {
  const stats = {};
  for (const r of daily) {
    const key = r.date.slice(0, 7); // "YYYY-MM"
    stats[key] = (stats[key] || 0) + r.cost;
  }
  const sorted = Object.entries(stats).sort((a, b) => a[0].localeCompare(b[0]));
  const el = document.getElementById('monthly-stats');
  if (sorted.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="monthly-stats">' +
    sorted.map(([month, total]) => {
      const m = MONTHS[parseInt(month.slice(5)) - 1];
      const y = month.slice(0, 4);
      return `<span class="month-pill">${m} ${y}: <strong>${total.toLocaleString()} lei</strong></span>`;
    }).join('') +
    '</div>';
}

function render() {
  renderDaily();
  renderRecurring();
  renderMonthlyStats();
  renderCategoryOptions();
}

// --- Save ---

function save() {
  const text = serializeMarkdown(daily, recurring);
  if (editorKit) {
    editorKit.text = text;
  }
}

// --- Today helper ---

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// --- Event handlers ---

function setupEvents() {
  const addExpBtn = document.getElementById('add-expense-btn');
  const addRecBtn = document.getElementById('add-recurring-btn');
  const expForm = document.getElementById('add-expense-form');
  const recForm = document.getElementById('add-recurring-form');

  addExpBtn.addEventListener('click', () => {
    editingDailyIndex = null;
    document.getElementById('save-expense').textContent = 'Save';
    expForm.style.display = expForm.style.display === 'none' ? 'block' : 'none';
    recForm.style.display = 'none';
    document.getElementById('expense-date').value = todayStr();
    document.getElementById('new-category').value = '';
    document.getElementById('expense-cost').value = '';
    renderCategoryOptions();
  });

  addRecBtn.addEventListener('click', () => {
    editingRecurringIndex = null;
    document.getElementById('save-recurring').textContent = 'Save';
    recForm.style.display = recForm.style.display === 'none' ? 'block' : 'none';
    expForm.style.display = 'none';
    document.getElementById('recurring-category').value = '';
    document.getElementById('recurring-item').value = '';
    document.getElementById('recurring-last-paid').value = '';
    document.getElementById('recurring-next-due').value = '';
    document.getElementById('recurring-amount').value = '';
  });

  document.getElementById('cancel-expense').addEventListener('click', () => {
    editingDailyIndex = null;
    document.getElementById('save-expense').textContent = 'Save';
    expForm.style.display = 'none';
  });

  document.getElementById('cancel-recurring').addEventListener('click', () => {
    editingRecurringIndex = null;
    document.getElementById('save-recurring').textContent = 'Save';
    recForm.style.display = 'none';
  });

  document.getElementById('save-expense').addEventListener('click', () => {
    const date = document.getElementById('expense-date').value;
    const newCat = document.getElementById('new-category').value.trim();
    const category = newCat || document.getElementById('expense-category').value;
    const cost = parseInt(document.getElementById('expense-cost').value);

    if (!date || !category || !cost) return;

    if (editingDailyIndex !== null) {
      daily[editingDailyIndex] = { date, category: category.toUpperCase(), cost };
      editingDailyIndex = null;
      document.getElementById('save-expense').textContent = 'Save';
    } else {
      daily.unshift({ date, category: category.toUpperCase(), cost });
    }
    document.getElementById('new-category').value = '';
    document.getElementById('expense-cost').value = '';
    expForm.style.display = 'none';
    render();
    save();
  });

  document.getElementById('save-recurring').addEventListener('click', () => {
    const category = document.getElementById('recurring-category').value.trim().toUpperCase();
    const item = document.getElementById('recurring-item').value.trim().toUpperCase();
    const lastPaid = document.getElementById('recurring-last-paid').value;
    const nextDue = document.getElementById('recurring-next-due').value;
    const amount = document.getElementById('recurring-amount').value.trim();

    if (!category || !item || !nextDue || !amount) return;

    if (editingRecurringIndex !== null) {
      recurring[editingRecurringIndex] = { category, item, lastPaid, nextDue, amount };
      editingRecurringIndex = null;
      document.getElementById('save-recurring').textContent = 'Save';
    } else {
      recurring.unshift({ category, item, lastPaid, nextDue, amount });
    }
    recForm.style.display = 'none';
    document.getElementById('recurring-category').value = '';
    document.getElementById('recurring-item').value = '';
    document.getElementById('recurring-last-paid').value = '';
    document.getElementById('recurring-next-due').value = '';
    document.getElementById('recurring-amount').value = '';
    render();
    save();
  });

  // Table action buttons (event delegation)
  document.getElementById('daily-table').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.index);

    if (btn.dataset.action === 'edit-daily') {
      editingDailyIndex = idx;
      document.getElementById('expense-date').value = daily[idx].date;
      renderCategoryOptions();
      document.getElementById('expense-category').value = daily[idx].category;
      document.getElementById('new-category').value = '';
      document.getElementById('expense-cost').value = daily[idx].cost;
      document.getElementById('save-expense').textContent = 'Update';
      expForm.style.display = 'block';
      recForm.style.display = 'none';
    } else if (btn.dataset.action === 'delete-daily') {
      daily.splice(idx, 1);
      render();
      save();
    }
  });

  document.getElementById('recurring-table').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.index);

    if (btn.dataset.action === 'edit-recurring') {
      editingRecurringIndex = idx;
      document.getElementById('recurring-category').value = recurring[idx].category;
      document.getElementById('recurring-item').value = recurring[idx].item;
      document.getElementById('recurring-last-paid').value = recurring[idx].lastPaid || '';
      document.getElementById('recurring-next-due').value = recurring[idx].nextDue;
      document.getElementById('recurring-amount').value = recurring[idx].amount;
      document.getElementById('save-recurring').textContent = 'Update';
      recForm.style.display = 'block';
      expForm.style.display = 'none';
    } else if (btn.dataset.action === 'delete-recurring') {
      recurring.splice(idx, 1);
      render();
      save();
    } else if (btn.dataset.action === 'mark-paid') {
      recurring[idx].lastPaid = todayStr();
      recurring[idx].nextDue = addYears(recurring[idx].nextDue, 1);
      render();
      save();
    }
  });
}

// --- Init ---

function initExtension() {
  editorKit = ExtensionsAPI;
  editorKit.initialize();

  editorKit.subscribe((text) => {
    const data = parseMarkdown(text || '');
    daily = data.daily;
    recurring = data.recurring;
    render();
  });
}

function initDemo() {
  // Load from the existing consolidated format for demo/testing
  const demoText = `# Spending

## Yearly Recurring Expenses

| Category | Item      | Last Paid  | Next Due   | Amount   |
| -------- | --------- | ---------- | ---------- | -------- |
| HOME     | INSURANCE | 2024-06-01 | 2025-06-01 | 500 lei  |
| CAR      | TAX       | 2024-03-15 | 2025-03-15 | 200 lei  |

---

## Daily Expenses

| Date       | Category  | Cost (lei) |
| ---------- | --------- | ---------- |
| 2025-01-02 | GROCERIES | 150        |
| 2025-01-01 | COFFEE    | 25         |
`;

  const data = parseMarkdown(demoText);
  daily = data.daily;
  recurring = data.recurring;
  render();
}

setupEvents();

// Detect if running inside Standard Notes or standalone
if (window.parent !== window) {
  initExtension();
} else {
  initDemo();
}
