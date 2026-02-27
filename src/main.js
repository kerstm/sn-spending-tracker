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
  const rows = [];
  for (const line of lines) {
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 5 && !cells[0].startsWith('--') && !cells[0].startsWith('Category')) {
      rows.push({
        category: cells[0],
        item: cells[1],
        due: cells[2],
        amount: cells[3],
        paid: cells[4] === '-' ? '' : cells[4],
      });
    }
  }
  return rows;
}

function parseMarkdown(text) {
  if (!text) return { daily: [], recurring: [] };

  const sections = text.split(/^---$/m);
  let dailyLines = [];
  let recurringLines = [];

  if (sections.length >= 2) {
    dailyLines = sections[0].split('\n');
    recurringLines = sections.slice(1).join('---').split('\n');
  } else {
    dailyLines = text.split('\n');
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
  let md = '# Spending\n\n## Daily Expenses\n\n';

  const dCatW = Math.max(8, ...daily.map(r => r.category.length));
  const dCostW = Math.max(10, ...daily.map(r => String(r.cost).length));

  md += `| ${pad('Date', 10)} | ${pad('Category', dCatW)} | ${pad('Cost (lei)', dCostW)} |\n`;
  md += `| ${'-'.repeat(10)} | ${'-'.repeat(dCatW)} | ${'-'.repeat(dCostW)} |\n`;
  for (const r of daily) {
    md += `| ${pad(r.date, 10)} | ${pad(r.category, dCatW)} | ${pad(String(r.cost), dCostW)} |\n`;
  }

  md += '\n---\n\n## Yearly Recurring Expenses\n\n';

  const rCatW = Math.max(8, ...recurring.map(r => r.category.length));
  const rItemW = Math.max(4, ...recurring.map(r => r.item.length));
  const rDueW = Math.max(3, ...recurring.map(r => r.due.length));
  const rAmtW = Math.max(6, ...recurring.map(r => r.amount.length));
  const rPaidW = Math.max(4, ...recurring.map(r => (r.paid || '-').length));

  md += `| ${pad('Category', rCatW)} | ${pad('Item', rItemW)} | ${pad('Due', rDueW)} | ${pad('Amount', rAmtW)} | ${pad('Paid', rPaidW)} |\n`;
  md += `| ${'-'.repeat(rCatW)} | ${'-'.repeat(rItemW)} | ${'-'.repeat(rDueW)} | ${'-'.repeat(rAmtW)} | ${'-'.repeat(rPaidW)} |\n`;
  for (const r of recurring) {
    md += `| ${pad(r.category, rCatW)} | ${pad(r.item, rItemW)} | ${pad(r.due, rDueW)} | ${pad(r.amount, rAmtW)} | ${pad(r.paid || '-', rPaidW)} |\n`;
  }

  return md;
}

// --- State ---

let daily = [];
let recurring = [];
let editorKit = null;

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
      <td><button class="btn btn-small btn-danger" data-action="delete-daily" data-index="${i}">x</button></td>
    </tr>
  `).join('');
}

function renderRecurring() {
  const tbody = document.querySelector('#recurring-table tbody');
  tbody.innerHTML = recurring.map((r, i) => `
    <tr>
      <td>${r.category}</td>
      <td>${r.item}</td>
      <td>${r.due}</td>
      <td>${r.amount}</td>
      <td class="${r.paid ? 'paid-yes' : 'paid-no'}">${r.paid || '-'}</td>
      <td>
        ${!r.paid ? `<button class="btn btn-small btn-mark" data-action="mark-paid" data-index="${i}">paid</button>` : `<button class="btn btn-small btn-ghost" data-action="mark-unpaid" data-index="${i}">undo</button>`}
        <button class="btn btn-small btn-danger" data-action="delete-recurring" data-index="${i}">x</button>
      </td>
    </tr>
  `).join('');
}

function render() {
  renderDaily();
  renderRecurring();
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
    expForm.style.display = expForm.style.display === 'none' ? 'block' : 'none';
    recForm.style.display = 'none';
    document.getElementById('expense-date').value = todayStr();
    renderCategoryOptions();
  });

  addRecBtn.addEventListener('click', () => {
    recForm.style.display = recForm.style.display === 'none' ? 'block' : 'none';
    expForm.style.display = 'none';
  });

  document.getElementById('cancel-expense').addEventListener('click', () => {
    expForm.style.display = 'none';
  });

  document.getElementById('cancel-recurring').addEventListener('click', () => {
    recForm.style.display = 'none';
  });

  document.getElementById('save-expense').addEventListener('click', () => {
    const date = document.getElementById('expense-date').value;
    const newCat = document.getElementById('new-category').value.trim();
    const category = newCat || document.getElementById('expense-category').value;
    const cost = parseInt(document.getElementById('expense-cost').value);

    if (!date || !category || !cost) return;

    daily.unshift({ date, category: category.toUpperCase(), cost });
    document.getElementById('new-category').value = '';
    document.getElementById('expense-cost').value = '';
    expForm.style.display = 'none';
    render();
    save();
  });

  document.getElementById('save-recurring').addEventListener('click', () => {
    const category = document.getElementById('recurring-category').value.trim().toUpperCase();
    const item = document.getElementById('recurring-item').value.trim().toUpperCase();
    const due = document.getElementById('recurring-due').value;
    const amount = document.getElementById('recurring-amount').value.trim();

    if (!category || !item || !due || !amount) return;

    recurring.push({ category, item, due, amount, paid: '' });
    recForm.style.display = 'none';
    document.getElementById('recurring-category').value = '';
    document.getElementById('recurring-item').value = '';
    document.getElementById('recurring-due').value = '';
    document.getElementById('recurring-amount').value = '';
    render();
    save();
  });

  // Table action buttons (event delegation)
  document.getElementById('daily-table').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.index);

    if (btn.dataset.action === 'delete-daily') {
      daily.splice(idx, 1);
      render();
      save();
    }
  });

  document.getElementById('recurring-table').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.index);

    if (btn.dataset.action === 'delete-recurring') {
      recurring.splice(idx, 1);
      render();
      save();
    } else if (btn.dataset.action === 'mark-paid') {
      recurring[idx].paid = todayStr();
      render();
      save();
    } else if (btn.dataset.action === 'mark-unpaid') {
      recurring[idx].paid = '';
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

## Daily Expenses

| Date       | Category  | Cost (lei) |
| ---------- | --------- | ---------- |
| 2025-01-02 | GROCERIES | 150        |
| 2025-01-01 | COFFEE    | 25         |

---

## Yearly Recurring Expenses

| Category | Item      | Due        | Amount   | Paid |
| -------- | --------- | ---------- | -------- | ---- |
| HOME     | INSURANCE | 2025-06-01 | 500 lei  | -    |
| CAR      | TAX       | 2025-03-15 | 200 lei  | -    |
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
