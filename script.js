(() => {
    const STORAGE_KEY = 'pfm_data_v1';
    const defaultData = { budget: null, fixedItems: [], expenses: [], currentMonth: null };

    function monthKey(date) { return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0'); }
    function todayISO() { const d = new Date(); return d.toISOString().slice(0, 10); }

    function ensureDataShape(raw) {
        if (!raw || typeof raw !== 'object') return { ...defaultData };
        return {
            budget: raw.budget != null ? Number(raw.budget) : null,
            fixedItems: Array.isArray(raw.fixedItems) ? raw.fixedItems.map(fi => ({ name: String(fi.name || ''), price: Number(fi.price || 0) })) : [],
            expenses: Array.isArray(raw.expenses) ? raw.expenses.map(ex => ({ date: String(ex.date || todayISO()), name: String(ex.name || ''), price: Number(ex.price || 0) })) : [],
            currentMonth: raw.currentMonth || null
        };
    }

    function readStorage() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            const shaped = ensureDataShape(parsed);
            if (!shaped.currentMonth) shaped.currentMonth = monthKey(new Date());
            return shaped;
        } catch (e) {
            return { ...defaultData, currentMonth: monthKey(new Date()) };
        }
    }

    function saveStorage(data) {
        const toSave = ensureDataShape(data);
        if (!toSave.currentMonth) toSave.currentMonth = monthKey(new Date());
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    }

    function mergeUploaded(upload) {
        const cur = readStorage();
        const up = ensureDataShape(upload);
        const out = { ...cur };
        if (up.budget != null && out.budget == null) out.budget = up.budget;
        up.fixedItems.forEach(fi => {
            const name = fi.name.trim();
            const price = Number(fi.price || 0);
            if (!name) return;
            const exists = out.fixedItems.some(x => x.name.toLowerCase() === name.toLowerCase() && Number(x.price) === price);
            if (!exists) out.fixedItems.push({ name, price });
        });
        up.expenses.forEach(ex => {
            const date = ex.date || todayISO();
            const name = ex.name || '';
            const price = Number(ex.price || 0);
            const exists = out.expenses.some(x => x.date === date && x.name === name && Number(x.price) === price);
            if (!exists) out.expenses.push({ date, name, price });
        });
        if (!out.currentMonth) out.currentMonth = up.currentMonth || monthKey(new Date());
        saveStorage(out);
        return out;
    }

    const budgetInput = document.getElementById('budgetInput');
    const itemName = document.getElementById('itemName');
    const itemPrice = document.getElementById('itemPrice');
    const fileInput = document.getElementById('fileInput');
    const saveInputBtn = document.getElementById('saveInputBtn');
    const fixedItemsContainer = document.getElementById('fixedItemsContainer');
    const expenseTableBody = document.querySelector('#expenseTable tbody');
    const newRowBtn = document.getElementById('newRowBtn');
    const totalPriceEl = document.getElementById('totalPrice');
    const showBudget = document.getElementById('showBudget');
    const showExpenses = document.getElementById('showExpenses');
    const showRemaining = document.getElementById('showRemaining');
    const downloadBtn = document.getElementById('downloadBtn');
    const clearAllBtn = document.getElementById('clearAllBtn');
    const clearMonthBtn = document.getElementById('clearMonthBtn');
    const exportMonthBtn = document.getElementById('exportMonthBtn');

    function handleMonthlyRolloverIfNeeded() {
        const data = readStorage();
        const nowKey = monthKey(new Date());
        if (data.currentMonth !== nowKey) {
            const totalExp = (data.expenses || []).reduce((s, e) => s + Number(e.price || 0), 0);
            const remaining = (data.budget != null ? Number(data.budget) : 0) - totalExp;
            const newData = { budget: remaining, fixedItems: data.fixedItems || [], expenses: [], currentMonth: nowKey };
            saveStorage(newData);
        }
    }

    function renderAll() {
        const data = readStorage();
        showBudget.textContent = data.budget != null ? Number(data.budget) : '—';
        renderFixedItems(data.fixedItems || []);
        renderExpenseTable(data.expenses || []);
        updateSummary();
        budgetInput.value = data.budget != null ? data.budget : '';
    }

    function renderFixedItems(items) {
        fixedItemsContainer.innerHTML = '';
        if (!items.length) { fixedItemsContainer.innerHTML = '<span style="color:#94a3b8">No fixed items yet</span>'; return; }
        items.forEach((it, idx) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = it.name + ' — ' + it.price;
            btn.title = 'Add "' + it.name + '" at price ' + it.price;
            btn.addEventListener('click', () => addExpense({ date: todayISO(), name: it.name, price: Number(it.price) }));
            fixedItemsContainer.appendChild(btn);
        });
    }

    function renderExpenseTable(expenses) {
        expenseTableBody.innerHTML = '';
        expenses.forEach((row, idx) => {
            const tr = document.createElement('tr');
            tr.dataset.index = String(idx);
            const tdDate = document.createElement('td');
            const dateInput = document.createElement('input');
            dateInput.type = 'date';
            dateInput.value = row.date || todayISO();
            dateInput.addEventListener('change', e => handleRowEdit(tr, 'date', e.target.value));
            tdDate.appendChild(dateInput);
            const tdName = document.createElement('td');
            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.value = row.name || '';
            nameInput.placeholder = 'Item name';
            nameInput.addEventListener('input', e => handleRowEdit(tr, 'name', e.target.value));
            tdName.appendChild(nameInput);
            const tdPrice = document.createElement('td');
            const priceInput = document.createElement('input');
            priceInput.type = 'number';
            priceInput.min = 0;
            priceInput.value = row.price != null ? Number(row.price) : 0;
            priceInput.addEventListener('input', e => handleRowEdit(tr, 'price', e.target.value));
            tdPrice.appendChild(priceInput);
            const tdAct = document.createElement('td');
            const delBtn = document.createElement('button');
            delBtn.className = 'del';
            delBtn.textContent = '✕';
            delBtn.title = 'Delete this row';
            delBtn.addEventListener('click', () => { const i = Number(tr.dataset.index); deleteExpense(i); });
            tdAct.appendChild(delBtn);
            tr.appendChild(tdDate); tr.appendChild(tdName); tr.appendChild(tdPrice); tr.appendChild(tdAct);
            expenseTableBody.appendChild(tr);
        });
        updateSummary();
    }

    function handleRowEdit(rowEl, field, value) {
        const idx = Number(rowEl.dataset.index);
        const data = readStorage();
        if (!data.expenses || !data.expenses[idx]) return;
        if (field === 'price') data.expenses[idx].price = isNaN(Number(value)) ? 0 : Number(value);
        else data.expenses[idx][field] = value;
        saveStorage(data);
        updateSummary();
        renderAll();
    }

    function addExpense(exp) {
        const data = readStorage();
        data.expenses = data.expenses || [];
        data.expenses.push({ date: String(exp.date || todayISO()), name: (exp.name || ''), price: Number(exp.price || 0) });
        saveStorage(data);
        renderAll();
    }

    function deleteExpense(index) {
        const data = readStorage();
        if (!Array.isArray(data.expenses) || index < 0 || index >= data.expenses.length) return;
        data.expenses.splice(index, 1);
        saveStorage(data);
        renderAll();
    }

    function updateSummary() {
        const data = readStorage();
        const total = (data.expenses || []).reduce((s, e) => s + Number(e.price || 0), 0);
        totalPriceEl.textContent = total;
        showExpenses.textContent = total;
        const budget = data.budget != null ? Number(data.budget) : null;
        showBudget.textContent = budget != null ? budget : '—';
        const remaining = budget != null ? (budget - total) : '—';
        showRemaining.textContent = typeof remaining === 'number' ? remaining : '—';
    }

    function attachListeners() {
        saveInputBtn.addEventListener('click', () => {
            const data = readStorage();
            const newBudgetVal = budgetInput.value !== '' ? Number(budgetInput.value) : null;
            if (newBudgetVal != null && !isNaN(newBudgetVal)) data.budget = newBudgetVal;
            const name = itemName.value.trim();
            const priceVal = itemPrice.value !== '' ? Number(itemPrice.value) : null;
            if (name && priceVal != null && !isNaN(priceVal)) {
                data.fixedItems = data.fixedItems || [];
                const exists = data.fixedItems.some(x => x.name.toLowerCase() === name.toLowerCase() && Number(x.price) === Number(priceVal));
                if (!exists) data.fixedItems.push({ name, price: Number(priceVal) });
            }
            saveStorage(data);
            const file = fileInput.files && fileInput.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    try { const parsed = JSON.parse(ev.target.result); mergeUploaded(parsed); fileInput.value = ''; renderAll(); alert('Uploaded and merged JSON successfully.'); }
                    catch (err) { alert('Could not parse JSON file.'); }
                };
                reader.readAsText(file);
            } else {
                renderAll();
            }
            itemName.value = ''; itemPrice.value = '';
        });

        newRowBtn.addEventListener('click', () => { addExpense({ date: todayISO(), name: '', price: 0 }); });

        downloadBtn.addEventListener('click', () => {
            const data = readStorage();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'pfm_backup_' + (new Date()).toISOString().slice(0, 10) + '.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
        });

        clearAllBtn.addEventListener('click', () => {
            if (confirm('This will clear all saved data from localStorage. Are you sure?')) {
                localStorage.removeItem(STORAGE_KEY);
                saveStorage({ ...defaultData, currentMonth: monthKey(new Date()) });
                renderAll();
            }
        });

        clearMonthBtn.addEventListener('click', () => {
            if (confirm('Clear all expenses for the current month? This will not remove fixed items or budget.')) {
                const data = readStorage(); data.expenses = []; saveStorage(data); renderAll();
            }
        });

        exportMonthBtn.addEventListener('click', () => {
            const data = readStorage();
            const exportObj = { budget: data.budget, fixedItems: data.fixedItems, expenses: data.expenses, currentMonth: data.currentMonth };
            const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'pfm_month_' + (data.currentMonth || monthKey(new Date())) + '.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
        });

        budgetInput.addEventListener('change', () => { const data = readStorage(); const val = budgetInput.value !== '' ? Number(budgetInput.value) : null; data.budget = val; saveStorage(data); updateSummary(); });

        document.addEventListener('dragover', e => e.preventDefault());
        window.addEventListener('beforeunload', () => { saveStorage(readStorage()); });
    }

    handleMonthlyRolloverIfNeeded();
    renderAll();
    attachListeners();
})();