/* =====================================================================
   °•* Flâneur *•° 雲端同步、站點隨手記、素材庫、景點集章與旅遊小冊引擎
   檔案：assets/journal-cloud.js
   相依：assets/stamp-engine.js、assets/journal-core.js（須在其之後載入）
   ===================================================================== */

/* === 1. 本模組專屬狀態 === */
const NOTE_TAGS = [
    { key: '心情碎片', icon: '✍️' },
    { key: '美食口感', icon: '🍽️' },
    { key: '避坑提醒', icon: '⚠️' },
    { key: '實用情報', icon: '💡' },
    { key: '戰利好物', icon: '🛍️' }
];
const normalizeNoteTag = t => (t === '戰利品' ? '戰利好物' : (t || '心情碎片'));

let currentNoteDayFilter = 'ALL';
let currentNoteTagFilter = 'ALL';
let currentNoteRatingFilter = 'ALL'; // ALL | 4+ | 3 | 2- | RATED
let editingNoteId = null;
let showLibraryNoteForm = false;
let libraryFormRating = 0;

// 行程卡片內建隨手記編輯狀態
let activeInlineSpotIndex = null;
let editingInlineNoteId = null;
let inlineFormRating = 0;

// 景點印章收集彈窗狀態
let stampModalChIndex = null;
let editingStampId = null;
let stampControlsInited = false;
let modalSpotSuggestNames = [];
let modalSimilarStamps = [];

/* === 2. Google 試算表雲端同步核心 === */
async function callGasPost(payload) {
    const res = await fetch(GAS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // 避開 CORS 預檢請求
        body: JSON.stringify({ ...payload, password: cloudEditPassword })
    });
    return res.json();
}

async function loadCloudData() {
    cloudSyncState = 'loading';
    renderBudgetPanel();
    renderChecklistPanel();
    renderNotesPanel();
    refreshItinerarySpotNotes();
    refreshItinerarySpotStamps();

    try {
        const pwdQuery = cloudEditPassword ? `&password=${encodeURIComponent(cloudEditPassword)}` : '';
        const cloudRes = await fetch(`${GAS_API_URL}?action=getAll&tripId=${encodeURIComponent(tripId)}${pwdQuery}`).then(r => r.json());

        if (cloudRes?.ok) {
            cloudExpenses = Array.isArray(cloudRes.expenses) ? cloudRes.expenses : [];
            cloudChecklist = Array.isArray(cloudRes.checklist) ? cloudRes.checklist : [];
            cloudNotes = Array.isArray(cloudRes.notes)
                ? cloudRes.notes.map(n => ({
                    ...n,
                    tag: normalizeNoteTag(n.tag),
                    rating: Math.max(0, Math.min(5, Number(n.rating) || 0))
                }))
                : [];
            cloudStamps = Array.isArray(cloudRes.stamps) ? cloudRes.stamps : [];
            cloudSyncState = 'ready';
        } else {
            cloudSyncState = 'error';
        }
    } catch {
        cloudSyncState = 'error';
    }

    renderBudgetPanel();
    renderChecklistPanel();
    renderNotesPanel();
    refreshItinerarySpotNotes();
    refreshItinerarySpotStamps();
}

async function unlockCloudEdit() {
    const pwd = prompt('請輸入你的雲端編輯密碼（Apps Script 中設定的 EDIT_PASSWORD）：');
    if (!pwd) return false;
    try {
        const res = await fetch(GAS_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'verifyPassword', password: pwd })
        }).then(r => r.json());

        if (res?.ok) {
            cloudEditPassword = pwd;
            try { localStorage.setItem('flaneur_gas_pwd', pwd); } catch {}
            await loadCloudData(); // 解鎖後同步拉取私密隨手記事
            return true;
        }
        alert(res?.error || '密碼錯誤，請再確認一次！');
        return false;
    } catch {
        alert('連線雲端驗證失敗，請稍後再試。');
        return false;
    }
}

function lockCloudEdit() {
    cloudEditPassword = '';
    editingExpenseId = null;
    editingNoteId = null;
    activeInlineSpotIndex = null;
    editingInlineNoteId = null;
    showLibraryNoteForm = false;
    cloudNotes = [];
    // 印章資料為公開展示內容，鎖定時僅關閉彈窗、不清空已讀取的印章清單
    closeStampModal();
    try { localStorage.removeItem('flaneur_gas_pwd'); } catch {}
    renderBudgetPanel();
    renderChecklistPanel();
    renderNotesPanel();
    refreshItinerarySpotNotes();
    refreshItinerarySpotStamps();
}

function buildCloudAuthBarHTML() {
    const syncTag = cloudSyncState === 'loading' ? '⏳ 雲端同步中...' : (cloudSyncState === 'error' ? '⚠️ 雲端連線失敗' : '☁️ Google 試算表已連線');
    return `
        <div class="cloud-auth-bar">
            <div class="cloud-auth-status">
                <span>${cloudEditPassword ? '🔓 編輯已解鎖' : '🔒 唯讀瀏覽模式'}</span>
                <span style="color:var(--text-light);font-weight:500;">｜ ${syncTag}</span>
            </div>
            <div class="cloud-auth-actions">
                <button type="button" class="cloud-btn" onclick="loadCloudData()">↻ 重新同步</button>
                ${cloudEditPassword
                    ? `<button type="button" class="cloud-btn" onclick="lockCloudEdit()">🔒 鎖定</button>`
                    : `<button type="button" class="cloud-btn primary" onclick="unlockCloudEdit()">🔑 解鎖編輯</button>`}
            </div>
        </div>`;
}

/* =====================================================================
   3. 💰 統一台幣（NT$）互動記帳面板
   ===================================================================== */
function renderBudgetPanel() {
    const bContainer = $('pack-budget');
    if (!bContainer) return;

    const iconMap = { 交通: '🚄', 住宿: '🏨', 餐飲: '🍽️', 門票: '🎟️', 購物: '🛍️', 其他: '🧾' };
    const combinedList = [
        ...cloudExpenses.map(e => ({ ...e, isBaseline: false })),
        ...(includeBaselineEstimates ? baselineExpensesTWD : [])
    ];

    const sum = { 交通: 0, 住宿: 0, 餐飲: 0, 門票: 0, 購物: 0, 其他: 0 };
    combinedList.forEach(i => { sum[sum[i.category] !== undefined ? i.category : '其他'] += Number(i.twdAmount) || 0; });
    const totalTWD = Object.values(sum).reduce((a, b) => a + b, 0);
    const cloudOnlyTWD = cloudExpenses.reduce((a, b) => a + (Number(b.twdAmount) || 0), 0);

    const avgPerDayTWD = Math.round(totalTWD / Math.max(1, normalizedDays.length));
    const catRows = [
        { key: '交通', name: '🚄 交通車資', color: '#6B8EAD' },
        { key: '住宿', name: '🏨 住宿費用', color: '#8B7268' },
        { key: '餐飲', name: '🍽️ 餐飲美食', color: '#C97B63' },
        { key: '門票', name: '🎟️ 門票體驗', color: '#6B9476' },
        { key: '購物', name: '🛍️ 購物伴手禮', color: '#9A7AA0' },
        { key: '其他', name: '🧾 其他雜支', color: '#B5ACA3' }
    ].filter(c => sum[c.key] > 0 || ['交通', '住宿', '餐飲', '門票'].includes(c.key));

    const dayOptions = ['行前', ...normalizedDays.map(d => d.day)];
    const defaultForeignCur = tripId.includes('malaysia') ? 'MYR' : (currentCurrencyCode !== 'TWD' ? currentCurrencyCode : 'JPY');
    const editingItem = editingExpenseId ? cloudExpenses.find(e => e.id === editingExpenseId) : null;

    const fDate = editingItem?.date || todayISO();
    const fDay = editingItem?.day || (normalizedDays[0]?.day || 'Day 01');
    const fCat = editingItem?.category || '餐飲';
    const fTitle = editingItem?.title || '';
    const fPay = editingItem?.payMethod || '刷卡外幣';
    const fCur = editingItem?.currency || defaultForeignCur;
    const fOrig = editingItem ? editingItem.originalAmount : '';
    const fRate = editingItem ? editingItem.exchangeRate : (FALLBACK_TWD_RATES[fCur] || 1);
    const fFee = editingItem ? editingItem.hasFee : (fPay === '刷卡外幣' && fCur !== 'TWD');
    const fTwd = editingItem ? editingItem.twdAmount : '';
    const fNote = editingItem?.note || '';

    const filteredRows = currentExpenseFilter === 'ALL'
        ? combinedList
        : combinedList.filter(i => i.category === currentExpenseFilter);

    bContainer.innerHTML = `
        ${buildCloudAuthBarHTML()}

        <div class="budget-card">
            <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;">
                <div>
                    <div style="font-size:0.78rem;color:var(--text-light);">旅途總計（統一換算台幣）</div>
                    <div style="font-size:1.45rem;font-weight:700;color:#3B4D54;">${normalizedDays.length} 天 ・ ${totalTripSpotCount} 處打卡</div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:0.78rem;color:var(--text-light);">${includeBaselineEstimates ? '實支＋預估總計 (TWD)' : '雲端實際花費 (TWD)'}</div>
                    <div style="font-size:1.35rem;font-weight:700;color:#B84A39;">NT$${totalTWD.toLocaleString()}</div>
                </div>
            </div>
            <div class="budget-stacked-bar" title="點擊色塊可篩選下方花費明細">
                ${totalTWD > 0 ? catRows.filter(c => sum[c.key] > 0).map(c => {
                    const w = (sum[c.key] / totalTWD * 100).toFixed(2);
                    const pct = Math.round(sum[c.key] / totalTWD * 100);
                    return `<div class="budget-seg" style="width:${w}%;background:${c.color};" title="${c.name}：NT$${sum[c.key].toLocaleString()} (${pct}%)" onclick="currentExpenseFilter=(currentExpenseFilter==='${c.key}'?'ALL':'${c.key}');renderBudgetPanel();"></div>`;
                }).join('') : ''}
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;font-size:0.8rem;color:var(--text-light);">
                <span>雲端實支：NT$${cloudOnlyTWD.toLocaleString()} ｜ 日均約 NT$${avgPerDayTWD.toLocaleString()}</span>
                <label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;color:var(--text-dark);font-weight:600;">
                    <input type="checkbox" ${includeBaselineEstimates ? 'checked' : ''} onchange="includeBaselineEstimates=this.checked;renderBudgetPanel();"> 併入行程預估項目
                </label>
            </div>
            <div class="budget-legend-grid">
                ${catRows.map(c => {
                    const pct = totalTWD > 0 ? Math.round(sum[c.key] / totalTWD * 100) : 0;
                    const isSel = currentExpenseFilter === c.key;
                    return `
                        <div class="budget-legend-item ${isSel ? 'active' : ''}" onclick="currentExpenseFilter=(currentExpenseFilter==='${c.key}'?'ALL':'${c.key}');renderBudgetPanel();">
                            <span class="budget-legend-left"><span class="budget-dot" style="background:${c.color};"></span>${c.name}</span>
                            <span class="budget-legend-val">NT$${sum[c.key].toLocaleString()}<span class="budget-legend-pct">(${pct}%)</span></span>
                        </div>`;
                }).join('')}
            </div>
        </div>

        ${cloudEditPassword ? `
            <div class="expense-form-panel" id="expense-form-panel">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <strong style="font-size:0.94rem;color:var(--accent-brown-dark);">${editingItem ? '✏️ 編輯花費（可覆蓋實際帳單台幣金額）' : '➕ 新增一筆花費（自動依消費日換算台幣）'}</strong>
                    ${editingItem ? `<button type="button" class="cloud-btn" onclick="cancelEditExpense()">取消編輯</button>` : ''}
                </div>
                <div class="exp-form-grid">
                    <div class="exp-field">
                        <label>消費日期（抓當日匯率）</label>
                        <input type="date" id="exp-date" class="exp-input" value="${escHtml(fDate)}" onchange="fetchRateForForm()">
                    </div>
                    <div class="exp-field">
                        <label>所屬天數</label>
                        <select id="exp-day" class="exp-select">
                            ${dayOptions.map(d => `<option value="${escHtml(d)}" ${d === fDay ? 'selected' : ''}>${escHtml(d)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="exp-field">
                        <label>花費分類</label>
                        <select id="exp-cat" class="exp-select">
                            ${['交通', '住宿', '餐飲', '門票', '購物', '其他'].map(c => `<option value="${c}" ${c === fCat ? 'selected' : ''}>${iconMap[c]} ${c}</option>`).join('')}
                        </select>
                    </div>
                    <div class="exp-field">
                        <label>付款方式</label>
                        <select id="exp-pay" class="exp-select" onchange="onPayMethodChange()">
                            ${['刷卡外幣', '刷卡台幣', '外幣現金', '台幣現金', '行動支付'].map(p => `<option value="${p}" ${p === fPay ? 'selected' : ''}>${p}</option>`).join('')}
                        </select>
                    </div>
                    <div class="exp-field full">
                        <label>項目名稱</label>
                        <input type="text" id="exp-title" class="exp-input" placeholder="例如：新源隆白咖啡、KLIA Ekspres、紀念品" value="${escHtml(fTitle)}">
                    </div>
                    <div class="exp-field">
                        <label>刷卡 / 消費幣別</label>
                        <select id="exp-cur" class="exp-select" onchange="onCurrencyChange()">
                            ${[
                                ['TWD', 'TWD 台幣 (NT$)'], ['MYR', 'MYR 馬幣 (RM)'], ['SGD', 'SGD 新幣 (S$)'],
                                ['JPY', 'JPY 日幣 (¥)'], ['USD', 'USD 美金 ($)'], ['EUR', 'EUR 歐元 (€)'],
                                ['KRW', 'KRW 韓元 (₩)'], ['HKD', 'HKD 港幣 (HK$)']
                            ].map(([code, label]) => `<option value="${code}" ${code === fCur ? 'selected' : ''}>${label}</option>`).join('')}
                        </select>
                    </div>
                    <div class="exp-field">
                        <label>原幣金額</label>
                        <input type="number" step="any" id="exp-orig" class="exp-input" placeholder="輸入原價" value="${fOrig}" oninput="recalcFormTWD()">
                    </div>
                    <div class="exp-field">
                        <label>匯率（1 原幣 ≒ 台幣）</label>
                        <div class="exp-rate-row">
                            <input type="number" step="0.0001" id="exp-rate" class="exp-input" value="${fRate}" oninput="recalcFormTWD()">
                            <button type="button" class="cloud-btn" id="btn-fetch-rate" onclick="fetchRateForForm(true)" style="white-space:nowrap;">🔄 查匯率</button>
                        </div>
                    </div>
                    <div class="exp-field">
                        <label>台幣結算金額 NT$（對帳後可直接修改）</label>
                        <input type="number" id="exp-twd" class="exp-input" placeholder="自動換算，亦可手動改" value="${fTwd}" style="font-weight:700;color:#B84A39;">
                    </div>
                    <div class="exp-field full">
                        <label class="exp-check-row">
                            <input type="checkbox" id="exp-fee" ${fFee ? 'checked' : ''} onchange="recalcFormTWD()">
                            <span>加計 <strong>1.5% 海外刷卡手續費</strong>（刷外幣時自動估算）</span>
                        </label>
                    </div>
                    <div class="exp-field full">
                        <label>備註（選填）</label>
                        <input type="text" id="exp-note" class="exp-input" placeholder="例如：永豐卡、已核對帳單、2人平分" value="${escHtml(fNote)}">
                    </div>
                </div>
                <div class="exp-form-footer">
                    <span class="exp-rate-hint" id="exp-rate-hint">💡 選擇外幣與消費日期會自動抓取當日參考匯率</span>
                    <button type="button" class="cloud-btn primary" id="btn-save-exp" onclick="submitExpenseForm()">${editingItem ? '💾 更新雲端紀錄' : '💾 儲存至 Google 試算表'}</button>
                </div>
            </div>
        ` : ''}

        <div class="expense-detail-panel">
            <h4 style="margin:0 0 12px;font-size:0.98rem;color:#3B4D54;">📋 台幣花費明細（共 ${filteredRows.length} 筆）</h4>
            <div class="expense-filter-bar">
                ${['ALL', '交通', '住宿', '餐飲', '門票', '購物', '其他'].map(cat => `
                    <button type="button" class="expense-filter-btn ${currentExpenseFilter === cat ? 'active' : ''}" onclick="currentExpenseFilter='${cat}';renderBudgetPanel();">
                        ${cat === 'ALL' ? `全部 (${combinedList.length})` : `${iconMap[cat]} ${cat}`}
                    </button>`).join('')}
            </div>
            <div>
                ${filteredRows.length ? filteredRows.map(i => {
                    const fxDetail = i.currency && i.currency !== 'TWD'
                        ? `${i.currency} ${Number(i.originalAmount).toLocaleString()} × ${i.exchangeRate}${i.hasFee ? ' (+1.5%)' : ''}`
                        : '';
                    return `
                        <div class="expense-item-row">
                            <div class="expense-item-left">
                                <div class="expense-item-tags">
                                    <span class="expense-cat-tag ${i.category}">${iconMap[i.category] || '🧾'} ${escHtml(i.category)}</span>
                                    ${i.day ? `<span class="expense-sub-pill">${escHtml(i.day)}</span>` : ''}
                                    ${i.date ? `<span class="expense-sub-pill">${escHtml(i.date)}</span>` : ''}
                                    <span class="expense-sub-pill ${i.isBaseline ? 'est' : ''}">${escHtml(i.payMethod)}</span>
                                </div>
                                <div class="expense-item-title">${escHtml(i.title)}</div>
                                ${(fxDetail || i.note) ? `<div class="expense-fx-note">${fxDetail}${fxDetail && i.note ? ' ｜ ' : ''}${escHtml(i.note)}</div>` : ''}
                            </div>
                            <div class="expense-item-right">
                                <div class="expense-item-amount">NT$${Number(i.twdAmount).toLocaleString()}</div>
                                ${(!i.isBaseline && cloudEditPassword) ? `
                                    <div class="expense-row-ops">
                                        <button type="button" class="icon-mini-btn" onclick="startEditExpense('${escHtml(i.id)}')" title="編輯 / 更新實際帳單金額">✏️ 編輯</button>
                                        <button type="button" class="icon-mini-btn del" onclick="deleteCloudExpense('${escHtml(i.id)}')" title="刪除">🗑️</button>
                                    </div>` : ''}
                            </div>
                        </div>`;
                }).join('') : `<div style="text-align:center;padding:24px;color:var(--text-light);font-size:0.86rem;">目前尚無符合條件的花費紀錄</div>`}
            </div>
        </div>`;

    if (cloudEditPassword && !editingItem && fCur !== 'TWD') {
        fetchRateForForm(false);
    }
}

function onPayMethodChange() {
    const pay = $('exp-pay').value;
    const curEl = $('exp-cur'), feeEl = $('exp-fee');
    if (pay === '刷卡台幣' || pay === '台幣現金') {
        curEl.value = 'TWD'; $('exp-rate').value = 1; feeEl.checked = false;
        recalcFormTWD();
    } else if (pay === '刷卡外幣') {
        if (curEl.value === 'TWD') curEl.value = tripId.includes('malaysia') ? 'MYR' : 'JPY';
        feeEl.checked = true;
        fetchRateForForm(false);
    } else {
        feeEl.checked = false;
        recalcFormTWD();
    }
}

function onCurrencyChange() {
    const cur = $('exp-cur').value;
    if (cur === 'TWD') {
        $('exp-rate').value = 1; $('exp-fee').checked = false;
        $('exp-rate-hint').textContent = '台幣消費直接計入 NT$';
        recalcFormTWD();
    } else {
        $('exp-fee').checked = $('exp-pay').value === '刷卡外幣';
        fetchRateForForm(false);
    }
}

function recalcFormTWD() {
    const orig = parseFloat($('exp-orig')?.value);
    const rate = parseFloat($('exp-rate')?.value) || 1;
    const hasFee = Boolean($('exp-fee')?.checked);
    if (!isNaN(orig)) $('exp-twd').value = Math.round(orig * rate * (hasFee ? 1.015 : 1));
}

async function fetchRateForForm(showFeedback = false) {
    const cur = $('exp-cur')?.value;
    const date = $('exp-date')?.value || todayISO();
    const hint = $('exp-rate-hint');
    if (!cur || cur === 'TWD') {
        if ($('exp-rate')) $('exp-rate').value = 1;
        recalcFormTWD();
        return;
    }
    if (hint) hint.textContent = `⏳ 查詢 ${date} ${cur} ➔ TWD 匯率中...`;
    try {
        const res = await fetch(`${GAS_API_URL}?action=rate&from=${encodeURIComponent(cur)}&date=${encodeURIComponent(date)}`).then(r => r.json());
        if (res?.ok && res.rate) {
            if ($('exp-rate')) $('exp-rate').value = res.rate;
            recalcFormTWD();
            if (hint) hint.textContent = res.isFallback
                ? `✅ 已套用最新參考匯率 1 ${cur} = ${res.rate} TWD（${date} 尚未公布歷史匯率）`
                : `✅ 已套用 ${res.dateUsed} 匯率：1 ${cur} = ${res.rate} TWD`;
            return;
        }
    } catch {}
    const fb = FALLBACK_TWD_RATES[cur] || 1;
    if ($('exp-rate')) $('exp-rate').value = fb;
    recalcFormTWD();
    if (hint && showFeedback) hint.textContent = `⚠️ 暫改用預設參考匯率 ${fb}，你也可以直接手動修改`;
}

function startEditExpense(id) {
    editingExpenseId = id;
    renderBudgetPanel();
    $('expense-form-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelEditExpense() {
    editingExpenseId = null;
    renderBudgetPanel();
}

async function submitExpenseForm() {
    const title = ($('exp-title').value || '').trim();
    const twdAmount = Math.round(Number($('exp-twd').value) || 0);
    const origAmount = Number($('exp-orig').value) || twdAmount;
    if (!title) return alert('請輸入花費項目名稱！');
    if (!twdAmount) return alert('請輸入金額！');

    const btn = $('btn-save-exp');
    btn.disabled = true; btn.textContent = '⏳ 同步中...';

    const itemData = {
        id: editingExpenseId || `exp_${Date.now()}`,
        tripId,
        date: $('exp-date').value || todayISO(),
        day: $('exp-day').value || '',
        category: $('exp-cat').value || '其他',
        title,
        payMethod: $('exp-pay').value || '刷卡外幣',
        currency: $('exp-cur').value || 'TWD',
        originalAmount: origAmount,
        exchangeRate: Number($('exp-rate').value) || 1,
        hasFee: Boolean($('exp-fee').checked),
        twdAmount,
        note: ($('exp-note').value || '').trim()
    };

    try {
        const res = await callGasPost({ action: 'saveExpense', data: itemData });
        if (res?.ok) {
            const idx = cloudExpenses.findIndex(e => e.id === itemData.id);
            if (idx >= 0) cloudExpenses[idx] = itemData;
            else cloudExpenses.unshift(itemData);
            editingExpenseId = null;
            renderBudgetPanel();
        } else {
            alert(res?.error || '儲存失敗，請確認密碼是否正確');
            btn.disabled = false; btn.textContent = '💾 儲存至 Google 試算表';
        }
    } catch {
        alert('雲端連線失敗，請稍後再試');
        btn.disabled = false; btn.textContent = '💾 儲存至 Google 試算表';
    }
}

async function deleteCloudExpense(id) {
    if (!confirm('確定要從 Google 試算表刪除這筆花費紀錄嗎？')) return;
    try {
        const res = await callGasPost({ action: 'deleteExpense', id });
        if (res?.ok) {
            cloudExpenses = cloudExpenses.filter(e => e.id !== id);
            if (editingExpenseId === id) editingExpenseId = null;
            renderBudgetPanel();
        } else {
            alert(res?.error || '刪除失敗');
        }
    } catch { alert('雲端連線失敗'); }
}

/* =====================================================================
   4. ✅ 行前準備互動式 Check List 面板
   ===================================================================== */
function getSuggestedChecklistForTrip() {
    const common = [
        { group: '證件與入境', text: '護照正本（確認效期滿 6 個月以上）' },
        { group: '證件與入境', text: '機票電子憑證、飯店訂房確認單離線存檔' },
        { group: '交通與票券', text: '海外刷卡信用卡（開啟海外刷卡 / 確認免年費與回饋）' },
        { group: '電子與網路', text: '行動電源（限隨身手提上機）與充電線' },
        { group: '電子與網路', text: '海外 eSIM 或實體網卡設定完成' },
        { group: '個人藥品雜項', text: '個人常備藥品（腸胃藥、止痛藥、OK繃）' }
    ];
    if (tripId.includes('malaysia')) {
        return [
            { group: '證件與入境', text: '馬來西亞 MDAC 電子入境卡（出發前 3 天內線上免費填寫）' },
            { group: '證件與入境', text: '新加坡 SG Arrival Card（入境前 3 天內線上免費填寫）' },
            ...common,
            { group: '交通與票券', text: '下載 Grab App 並事先綁定信用卡' },
            { group: '交通與票券', text: '確認 ETS 電動列車車票與跨國包車聯絡資訊' },
            { group: '電子與網路', text: '英規三腳（Type G）萬國轉接頭' },
            { group: '衣物與鞋履', text: '折疊晴雨傘、防曬乳、太陽眼鏡（防熱帶午後雷陣雨）' },
            { group: '衣物與鞋履', text: '輕薄長袖外套（火車、商場與劇場冷氣強）' }
        ];
    }
    if (tripId.includes('tohoku') || currentTripTimezone === 'Asia/Tokyo') {
        return [
            { group: '證件與入境', text: 'Visit Japan Web 入境與海關 QR Code 截圖' },
            ...common,
            { group: '交通與票券', text: 'Suica / ICOCA 交通卡儲值（或綁定 Apple Pay）' },
            { group: '衣物與鞋履', text: '防風保暖外套、發熱衣、手套、毛帽、簡易冰爪' },
            { group: '個人藥品雜項', text: '暖暖包（手握式＋貼式，防低溫手機掉電）' }
        ];
    }
    return common;
}

function renderChecklistPanel() {
    const box = $('pack-checklist');
    if (!box) return;

    const total = cloudChecklist.length;
    const done = cloudChecklist.filter(i => i.checked).length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    const groups = {};
    cloudChecklist.forEach(item => {
        const g = item.group || '必備物品';
        if (!groups[g]) groups[g] = [];
        groups[g].push(item);
    });

    box.innerHTML = `
        ${buildCloudAuthBarHTML()}

        <div class="checklist-card">
            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">
                <strong style="font-size:1.02rem;color:var(--accent-sage-dark);">✅ 行前準備進度</strong>
                <span style="font-weight:700;color:var(--accent-sage-dark);">${done} / ${total} 項 (${pct}%)</span>
            </div>
            <div class="chk-progress-bar"><div class="chk-progress-fill" style="width:${pct}%;"></div></div>
            <div style="font-size:0.78rem;color:var(--text-light);">
                ${total === 0 ? '尚未建立本趟旅程的行前準備清單' : (pct === 100 ? '🎉 太棒了！行前物品已全數準備就緒，安心出發！' : '點擊項目即可打勾並即時同步至 Google 試算表')}
            </div>
        </div>

        <div class="checklist-card">
            ${cloudEditPassword ? `
                <div class="chk-add-row">
                    <select id="chk-group" class="exp-select">
                        <option value="證件與入境">🛂 證件與入境</option>
                        <option value="交通與票券">🚄 交通與票券</option>
                        <option value="衣物與鞋履">👕 衣物與鞋履</option>
                        <option value="電子與網路">📱 電子與網路</option>
                        <option value="個人藥品雜項">💊 藥品雜項</option>
                    </select>
                    <input type="text" id="chk-text" class="exp-input" placeholder="新增準備項目（如：轉接頭、泳衣...）" onkeydown="if(event.key==='Enter')addChecklistItem()">
                    <button type="button" class="cloud-btn sage" onclick="addChecklistItem()">＋ 新增</button>
                </div>
            ` : ''}

            ${total === 0 ? `
                <div class="draft-empty-box" style="margin:8px 0;padding:28px 16px;">
                    <div style="font-size:1.8rem;margin-bottom:6px;">🧳</div>
                    <div style="margin-bottom:12px;">這趟旅程還沒有行前準備清單喔！</div>
                    <button type="button" class="cloud-btn sage" onclick="importSuggestedChecklist()">✨ 一鍵匯入本趟建議清單</button>
                </div>
            ` : Object.entries(groups).map(([gName, items]) => {
                const gDone = items.filter(i => i.checked).length;
                return `
                    <div class="chk-group-title">
                        <span>${escHtml(gName)}</span>
                        <span style="font-weight:500;color:var(--text-light);">${gDone}/${items.length}</span>
                    </div>
                    ${items.map(item => `
                        <div class="chk-item-row">
                            <label class="chk-label ${item.checked ? 'done' : ''}">
                                <input type="checkbox" ${item.checked ? 'checked' : ''} onchange="toggleChecklistItem('${escHtml(item.id)}', this.checked)">
                                <span>${escHtml(item.text)}</span>
                            </label>
                            ${cloudEditPassword ? `<button type="button" class="icon-mini-btn del" onclick="deleteChecklistItem('${escHtml(item.id)}')" title="刪除">✕</button>` : ''}
                        </div>`).join('')}`;
            }).join('')}
        </div>`;
}

async function importSuggestedChecklist() {
    if (!cloudEditPassword) {
        const ok = await unlockCloudEdit();
        if (!ok) return;
    }
    const nowTs = Date.now();
    const items = getSuggestedChecklistForTrip().map((it, idx) => ({
        id: `chk_${nowTs}_${idx}`, tripId, group: it.group, text: it.text, checked: false
    }));
    try {
        const res = await callGasPost({ action: 'initChecklist', tripId, items });
        if (res?.ok) {
            cloudChecklist = [...cloudChecklist, ...items];
            renderChecklistPanel();
        } else {
            alert(res?.error || '匯入失敗');
        }
    } catch { alert('雲端連線失敗'); }
}

async function addChecklistItem() {
    const text = ($('chk-text')?.value || '').trim();
    if (!text) return;
    const item = { id: `chk_${Date.now()}`, tripId, group: $('chk-group').value || '必備物品', text, checked: false };
    cloudChecklist.push(item);
    renderChecklistPanel();
    try {
        const res = await callGasPost({ action: 'saveChecklistItem', data: item });
        if (!res?.ok) {
            cloudChecklist = cloudChecklist.filter(i => i.id !== item.id);
            alert(res?.error || '新增失敗');
            renderChecklistPanel();
        }
    } catch {
        cloudChecklist = cloudChecklist.filter(i => i.id !== item.id);
        alert('雲端同步失敗');
        renderChecklistPanel();
    }
}

async function toggleChecklistItem(id, checked) {
    if (!cloudEditPassword) {
        renderChecklistPanel();
        await unlockCloudEdit();
        return;
    }
    const target = cloudChecklist.find(i => i.id === id);
    if (!target) return;
    target.checked = checked;
    renderChecklistPanel();
    try {
        const res = await callGasPost({ action: 'toggleChecklist', id, checked });
        if (!res?.ok) {
            target.checked = !checked;
            alert(res?.error || '更新狀態失敗');
            renderChecklistPanel();
        }
    } catch {
        target.checked = !checked;
        alert('雲端連線失敗');
        renderChecklistPanel();
    }
}

async function deleteChecklistItem(id) {
    const backup = [...cloudChecklist];
    cloudChecklist = cloudChecklist.filter(i => i.id !== id);
    renderChecklistPanel();
    try {
        const res = await callGasPost({ action: 'deleteChecklistItem', id });
        if (!res?.ok) {
            cloudChecklist = backup;
            alert(res?.error || '刪除失敗');
            renderChecklistPanel();
        }
    } catch {
        cloudChecklist = backup;
        alert('雲端連線失敗');
        renderChecklistPanel();
    }
}

/* =====================================================================
   5. ⭐ 星級評價小工具 ＆ 行程站點內建隨手記
   ===================================================================== */
function formatStarsText(rating) {
    const r = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
    if (!r) return '';
    return '★'.repeat(r) + '☆'.repeat(5 - r);
}

function buildStarPickerHTML(mode, rating, chIndex = 0) {
    const cur = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
    const handler = mode === 'inline'
        ? n => `setInlineSpotRating(${chIndex}, ${n})`
        : n => `setLibraryNoteRating(${n})`;
    return `
        <div class="star-picker" aria-label="星級評價">
            ${[1, 2, 3, 4, 5].map(n => `
                <button type="button" class="star-btn ${n <= cur ? 'active' : ''}" onclick="${handler(n)}" title="${n} 顆星">★</button>
            `).join('')}
            ${cur > 0
                ? `<span style="font-size:0.75rem;color:#B7791F;font-weight:700;margin-left:4px;">${cur}.0 ★</span>
                   <button type="button" class="star-clear-btn" onclick="${handler(0)}">清除</button>`
                : `<span style="font-size:0.74rem;color:var(--text-light);margin-left:4px;">未評分（選填）</span>`}
        </div>`;
}

function getNotesForSpot(dayKey, spotName) {
    if (!cloudEditPassword || !cloudNotes.length) return [];
    const targetKey = normalizeSpotKey(dayKey, spotName);
    const pureLower = String(spotName || '').trim().toLowerCase();
    return cloudNotes.filter(n => {
        if (!n.spot) return false;
        if (normalizeSpotKey(n.day, n.spot) === targetKey) return true;
        return (!n.day || n.day === dayKey) && n.spot.trim().toLowerCase() === pureLower;
    });
}

function jumpToNotesLibrary() {
    switchRightView('view-pack');
    const btn = document.querySelector('.pack-sub-btn[data-panel="pack-notes"]');
    switchPackSubTab('pack-notes', btn);
}

function refreshItinerarySpotNotes() {
    const unlockSlot = $('itin-unlock-bar');
    const tripStampCount = cloudStamps.filter(s => s.tripId === tripId).length;
    if (unlockSlot) {
        if (cloudEditPassword) {
            const ratedCount = cloudNotes.filter(n => n.rating > 0).length;
            unlockSlot.innerHTML = `
                <div class="itin-unlock-bar">
                    <span>🔓 <strong>編輯已解鎖</strong>（本趟 ${cloudNotes.length} 則筆記・${ratedCount} 筆評分・${tripStampCount} 枚印章）</span>
                    <div class="itin-unlock-actions">
                        <a href="passport.html" class="cloud-btn" style="text-decoration:none;">🛂 護照印章牆</a>
                        <button type="button" class="cloud-btn sage" onclick="jumpToNotesLibrary()">📋 寫作素材庫</button>
                        <button type="button" class="cloud-btn" onclick="lockCloudEdit()">🔒 鎖定</button>
                    </div>
                </div>`;
        } else {
            unlockSlot.innerHTML = `
                <div class="itin-unlock-bar">
                    <span>🔒 隨手記與集章目前為唯讀狀態${tripStampCount > 0 ? `（本趟已收 ${tripStampCount} 枚印章）` : ''}</span>
                    <div class="itin-unlock-actions">
                        <a href="passport.html" class="cloud-btn" style="text-decoration:none;">🛂 護照印章牆</a>
                        <button type="button" class="cloud-btn primary" onclick="unlockCloudEdit()">🔑 解鎖編輯</button>
                    </div>
                </div>`;
        }
    }

    currentChaptersList.forEach((ch, chIndex) => renderSingleSpotNoteMount(chIndex));
}

function renderSingleSpotNoteMount(chIndex) {
    const ch = currentChaptersList[chIndex];
    const starSlot = $(`spot-star-slot-${chIndex}`);
    const mount = $(`spot-notes-mount-${chIndex}`);
    if (!ch || !starSlot || !mount) return;

    // 未解鎖時完全不顯示私人筆記與星級
    if (!cloudEditPassword) {
        starSlot.innerHTML = '';
        mount.innerHTML = '';
        return;
    }

    const spotNotes = getNotesForSpot(ch._dayKey, ch._pureName);
    const ratedNotes = spotNotes.filter(n => n.rating > 0);
    if (ratedNotes.length) {
        const avg = (ratedNotes.reduce((a, b) => a + b.rating, 0) / ratedNotes.length).toFixed(1).replace(/\.0$/, '');
        starSlot.innerHTML = `<span class="spot-star-badge" title="我的旅途評分">★ ${avg}</span>`;
    } else {
        starSlot.innerHTML = '';
    }

    const isFormOpen = activeInlineSpotIndex === chIndex;
    if (!spotNotes.length && !isFormOpen) {
        mount.innerHTML = '';
        return;
    }

    const editingItem = (isFormOpen && editingInlineNoteId)
        ? cloudNotes.find(n => n.id === editingInlineNoteId)
        : null;
    const fTag = normalizeNoteTag(editingItem?.tag || (ch._isFoodSpot ? '美食口感' : '心情碎片'));
    const fContent = editingItem?.content || '';

    mount.innerHTML = `
        <div class="spot-notes-section">
            <div class="spot-notes-head">
                <span>📝 此站隨手記與評價（${spotNotes.length} 則）</span>
                ${!isFormOpen ? `<button type="button" class="icon-mini-btn" onclick="openSpotNoteEditorByIndex(${chIndex})">＋ 新增一則</button>` : ''}
            </div>

            ${spotNotes.map(n => {
                const tagNorm = normalizeNoteTag(n.tag);
                const tagIcon = NOTE_TAGS.find(t => t.key === tagNorm)?.icon || '📝';
                return `
                    <div class="spot-note-item">
                        <div class="spot-note-item-top">
                            <div class="note-meta">
                                <span class="note-tag-pill">${tagIcon} ${escHtml(tagNorm)}</span>
                                ${n.rating > 0 ? `<span class="note-rating-pill">${formatStarsText(n.rating)} ${n.rating}.0</span>` : ''}
                                <span class="note-time">${escHtml(n.createdAt)}</span>
                            </div>
                            <div class="expense-row-ops">
                                <button type="button" class="icon-mini-btn" onclick="openSpotNoteEditorByIndex(${chIndex}, '${escHtml(n.id)}')">✏️ 編輯</button>
                                <button type="button" class="icon-mini-btn del" onclick="deleteCloudNote('${escHtml(n.id)}')">🗑️</button>
                            </div>
                        </div>
                        <div class="spot-note-item-body">${escHtml(n.content)}</div>
                    </div>`;
            }).join('')}

            ${isFormOpen ? `
                <div class="spot-inline-form" id="spot-inline-form-${chIndex}">
                    <div class="spot-inline-row">
                        <div id="inline-star-wrap-${chIndex}">${buildStarPickerHTML('inline', inlineFormRating, chIndex)}</div>
                        <select id="inline-note-tag-${chIndex}" class="exp-select" style="width:auto;min-width:130px;padding:5px 8px;font-size:0.8rem;">
                            ${NOTE_TAGS.map(t => `<option value="${t.key}" ${t.key === fTag ? 'selected' : ''}>${t.icon} ${t.key}</option>`).join('')}
                        </select>
                    </div>
                    <textarea id="inline-note-content-${chIndex}" class="note-textarea" style="min-height:76px;" placeholder="記下【${escHtml(ch._pureName)}】的真實口感、排隊時間、避坑細節或當下心情...">${escHtml(fContent)}</textarea>
                    <div class="spot-inline-row" style="justify-content:flex-end;">
                        <button type="button" class="cloud-btn" onclick="closeInlineSpotNoteEditor(${chIndex})">取消</button>
                        <button type="button" class="cloud-btn primary" id="btn-save-inline-${chIndex}" onclick="submitInlineSpotNote(${chIndex})">${editingItem ? '💾 更新筆記' : '💾 儲存至雲端'}</button>
                    </div>
                </div>
            ` : ''}
        </div>`;
}

async function openSpotNoteEditorByIndex(chIndex, editNoteId = null) {
    if (!cloudEditPassword) {
        const ok = await unlockCloudEdit();
        if (!ok) return;
    }
    const ch = currentChaptersList[chIndex];
    if (!ch) return;

    const card = $(`itin-card-${ch.id}`);
    if (card) card.classList.add('open');

    activeInlineSpotIndex = chIndex;
    editingInlineNoteId = editNoteId;
    const editingItem = editNoteId ? cloudNotes.find(n => n.id === editNoteId) : null;
    inlineFormRating = editingItem ? (Number(editingItem.rating) || 0) : 0;

    refreshItinerarySpotNotes();
    setTimeout(() => {
        const formEl = $(`spot-inline-form-${chIndex}`);
        formEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        $(`inline-note-content-${chIndex}`)?.focus();
    }, 60);
}

function closeInlineSpotNoteEditor(chIndex) {
    activeInlineSpotIndex = null;
    editingInlineNoteId = null;
    inlineFormRating = 0;
    renderSingleSpotNoteMount(chIndex);
}

function setInlineSpotRating(chIndex, val) {
    inlineFormRating = val;
    const wrap = $(`inline-star-wrap-${chIndex}`);
    if (wrap) wrap.innerHTML = buildStarPickerHTML('inline', inlineFormRating, chIndex);
}

async function submitInlineSpotNote(chIndex) {
    const ch = currentChaptersList[chIndex];
    if (!ch) return;
    const content = ($(`inline-note-content-${chIndex}`)?.value || '').trim();
    if (!content && !inlineFormRating) return alert('請輸入記事內容，或先點選星級評分！');

    const btn = $(`btn-save-inline-${chIndex}`);
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 同步中...'; }

    const oldItem = editingInlineNoteId ? cloudNotes.find(n => n.id === editingInlineNoteId) : null;
    const now = new Date();
    const localNow = `${todayISO()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const noteData = {
        id: editingInlineNoteId || `note_${Date.now()}`,
        tripId,
        day: ch._dayKey || 'Day 01',
        spot: ch._pureName || '',
        tag: normalizeNoteTag($(`inline-note-tag-${chIndex}`)?.value || '心情碎片'),
        content: content || `（給予 ${inlineFormRating} 顆星評價）`,
        rating: inlineFormRating,
        createdAt: oldItem?.createdAt || localNow
    };

    try {
        const res = await callGasPost({ action: 'saveNote', data: noteData });
        if (res?.ok) {
            if (res.createdAt) noteData.createdAt = res.createdAt;
            const idx = cloudNotes.findIndex(n => n.id === noteData.id);
            if (idx >= 0) cloudNotes[idx] = noteData;
            else cloudNotes.unshift(noteData);

            activeInlineSpotIndex = null;
            editingInlineNoteId = null;
            inlineFormRating = 0;
            refreshItinerarySpotNotes();
            renderNotesPanel();
        } else {
            alert(res?.error || '儲存失敗');
            if (btn) { btn.disabled = false; btn.textContent = '💾 儲存至雲端'; }
        }
    } catch {
        alert('雲端連線失敗，請稍後再試');
        if (btn) { btn.disabled = false; btn.textContent = '💾 儲存至雲端'; }
    }
}

/* =====================================================================
   6. 📋 寫作素材庫（原隨手記事分頁升級：三維度篩選 ＆ 雙格式匯出）
   ===================================================================== */
function getSpotOptionsForDay(dayKey) {
    const targetDays = (!dayKey || dayKey === '行前' || dayKey === 'ALL')
        ? normalizedDays
        : normalizedDays.filter(d => d.day === dayKey);
    const names = [];
    targetDays.forEach(d => (d.chapters || []).forEach(ch => {
        const n = ch.spotName?.trim() || (ch.title || '').replace(/^\d+\.\s*/, '').replace(/^[^｜|]+[｜|]\s*/, '').trim();
        if (n && !names.includes(n)) names.push(n);
    }));
    return names;
}

function updateNoteSpotSuggestions() {
    const dayVal = $('note-day')?.value || 'Day 01';
    const dl = $('note-spot-list');
    if (!dl) return;
    dl.innerHTML = getSpotOptionsForDay(dayVal).map(s => `<option value="${escHtml(s)}"></option>`).join('');
}

function getFilteredNotesForLibrary() {
    return cloudNotes.filter(n => {
        if (currentNoteDayFilter !== 'ALL' && n.day !== currentNoteDayFilter) return false;
        if (currentNoteTagFilter !== 'ALL' && normalizeNoteTag(n.tag) !== currentNoteTagFilter) return false;
        const r = Number(n.rating) || 0;
        if (currentNoteRatingFilter === '4+' && r < 4) return false;
        if (currentNoteRatingFilter === '3' && r !== 3) return false;
        if (currentNoteRatingFilter === '2-' && (r === 0 || r > 2)) return false;
        if (currentNoteRatingFilter === 'RATED' && r === 0) return false;
        return true;
    });
}

function setLibraryNoteRating(val) {
    libraryFormRating = val;
    const wrap = $('library-star-wrap');
    if (wrap) wrap.innerHTML = buildStarPickerHTML('library', libraryFormRating);
}

function toggleLibraryNoteForm(forceState) {
    showLibraryNoteForm = typeof forceState === 'boolean' ? forceState : !showLibraryNoteForm;
    if (!showLibraryNoteForm) {
        editingNoteId = null;
        libraryFormRating = 0;
    }
    renderNotesPanel();
}

function renderNotesPanel() {
    const box = $('pack-notes');
    if (!box) return;

    if (!cloudEditPassword) {
        box.innerHTML = `
            ${buildCloudAuthBarHTML()}
            <div class="draft-empty-box" style="padding:40px 20px;">
                <div style="font-size:2rem;margin-bottom:8px;">🔒</div>
                <div style="font-weight:700;color:var(--accent-brown-dark);font-size:1.02rem;margin-bottom:6px;">
                    私人寫作素材庫（未公開）
                </div>
                <p style="margin:0 0 16px;font-size:0.86rem;">
                    旅途中於「📅 行程安排」各站點寫下的隨手記與星級評價，都會自動彙整在這裡。<br>
                    為保護草稿隱私，請先輸入編輯密碼解鎖檢視與匯出素材。
                </p>
                <button type="button" class="cloud-btn primary" onclick="unlockCloudEdit()">🔑 解鎖寫作素材庫</button>
            </div>`;
        return;
    }

    const dayOptions = ['行前', ...normalizedDays.map(d => d.day)];
    const editingItem = editingNoteId ? cloudNotes.find(n => n.id === editingNoteId) : null;
    const isFormVisible = showLibraryNoteForm || Boolean(editingItem);
    const fDay = editingItem?.day || (normalizedDays[0]?.day || 'Day 01');
    const fSpot = editingItem?.spot || '';
    const fTag = normalizeNoteTag(editingItem?.tag || '心情碎片');
    const fContent = editingItem?.content || '';
    if (editingItem && libraryFormRating === 0 && editingItem.rating > 0) {
        libraryFormRating = editingItem.rating;
    }

    const filteredNotes = getFilteredNotesForLibrary();

    box.innerHTML = `
        ${buildCloudAuthBarHTML()}

        <div class="notes-quick-toggle-bar">
            <span>💡 景點筆記建議直接寫在「📅 行程安排」各站點卡片；零碎雜記可在此補記。</span>
            <button type="button" class="cloud-btn primary" onclick="toggleLibraryNoteForm()">${isFormVisible ? '▲ 收合表單' : '＋ 補記零碎雜記'}</button>
        </div>

        ${isFormVisible ? `
            <div class="expense-form-panel" id="note-form-panel">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <strong style="font-size:0.94rem;color:var(--accent-brown-dark);">${editingItem ? '✏️ 編輯素材筆記' : '📝 補記一筆（同步至 Google 試算表）'}</strong>
                    <button type="button" class="cloud-btn" onclick="cancelEditNote()">取消</button>
                </div>
                <div class="exp-form-grid">
                    <div class="exp-field">
                        <label>天數</label>
                        <select id="note-day" class="exp-select" onchange="updateNoteSpotSuggestions()">
                            ${dayOptions.map(d => `<option value="${escHtml(d)}" ${d === fDay ? 'selected' : ''}>${escHtml(d)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="exp-field">
                        <label>分類標籤</label>
                        <select id="note-tag" class="exp-select">
                            ${NOTE_TAGS.map(t => `<option value="${t.key}" ${t.key === fTag ? 'selected' : ''}>${t.icon} ${t.key}</option>`).join('')}
                        </select>
                    </div>
                    <div class="exp-field full">
                        <label>對應站點（選填，留空即為不綁定景點之雜記）</label>
                        <input type="text" id="note-spot" class="exp-input" list="note-spot-list" placeholder="點選當日站點，或自由輸入新地點" value="${escHtml(fSpot)}">
                        <datalist id="note-spot-list"></datalist>
                    </div>
                    <div class="exp-field full">
                        <label>星級評價（選填）</label>
                        <div id="library-star-wrap">${buildStarPickerHTML('library', libraryFormRating)}</div>
                    </div>
                    <div class="exp-field full">
                        <label>記事內容</label>
                        <textarea id="note-content" class="note-textarea" placeholder="記下搭車心情、行前備忘、機場好物或想放進遊記的句子...">${escHtml(fContent)}</textarea>
                    </div>
                </div>
                <div class="exp-form-footer">
                    <span class="exp-rate-hint">💡 存檔後將即時同步回對應的行程站點卡片</span>
                    <button type="button" class="cloud-btn primary" id="btn-save-note" onclick="submitNoteForm()">${editingItem ? '💾 更新這則素材' : '💾 儲存至素材庫'}</button>
                </div>
            </div>
        ` : ''}

        <div class="expense-detail-panel">
            <div class="notes-library-head">
                <h4 style="margin:0;font-size:0.98rem;color:#3B4D54;">📋 寫作素材庫（共 ${filteredNotes.length} / ${cloudNotes.length} 則）</h4>
                <div class="notes-copy-bar">
                    <button type="button" class="cloud-btn sage" id="btn-copy-draft" onclick="copyNotesMaterial('draft')">📋 複製結構化草稿</button>
                    <button type="button" class="cloud-btn slate" id="btn-copy-ai" onclick="copyNotesMaterial('ai')">🤖 複製 AI 遊記素材包</button>
                </div>
            </div>

            <div class="notes-filter-grid">
                <select class="exp-select" onchange="currentNoteDayFilter=this.value;renderNotesPanel();">
                    <option value="ALL" ${currentNoteDayFilter === 'ALL' ? 'selected' : ''}>全部天數</option>
                    ${dayOptions.map(d => `<option value="${escHtml(d)}" ${currentNoteDayFilter === d ? 'selected' : ''}>${escHtml(d)}</option>`).join('')}
                </select>
                <select class="exp-select" onchange="currentNoteTagFilter=this.value;renderNotesPanel();">
                    <option value="ALL" ${currentNoteTagFilter === 'ALL' ? 'selected' : ''}>全部分類標籤</option>
                    ${NOTE_TAGS.map(t => `<option value="${t.key}" ${currentNoteTagFilter === t.key ? 'selected' : ''}>${t.icon} ${t.key}</option>`).join('')}
                </select>
                <select class="exp-select" onchange="currentNoteRatingFilter=this.value;renderNotesPanel();">
                    <option value="ALL" ${currentNoteRatingFilter === 'ALL' ? 'selected' : ''}>全部星級</option>
                    <option value="4+" ${currentNoteRatingFilter === '4+' ? 'selected' : ''}>⭐ 4★ 以上必推</option>
                    <option value="3" ${currentNoteRatingFilter === '3' ? 'selected' : ''}>⭐ 3★ 中規中矩</option>
                    <option value="2-" ${currentNoteRatingFilter === '2-' ? 'selected' : ''}>⚠️ 2★ 以下避雷</option>
                    <option value="RATED" ${currentNoteRatingFilter === 'RATED' ? 'selected' : ''}>★ 僅看有評分</option>
                </select>
            </div>

            <div>
                ${filteredNotes.length ? filteredNotes.map(n => {
                    const tagNorm = normalizeNoteTag(n.tag);
                    const tagIcon = NOTE_TAGS.find(t => t.key === tagNorm)?.icon || '📝';
                    return `
                        <div class="note-card tag-${escHtml(tagNorm)}">
                            <div class="note-card-top">
                                <div class="note-meta">
                                    <span class="note-tag-pill">${tagIcon} ${escHtml(tagNorm)}</span>
                                    <span class="expense-sub-pill">${escHtml(n.day)}</span>
                                    ${n.spot ? `<span class="note-spot-pill">📍 ${escHtml(n.spot)}</span>` : ''}
                                    ${n.rating > 0 ? `<span class="note-rating-pill">${formatStarsText(n.rating)} ${n.rating}.0</span>` : ''}
                                    <span class="note-time">${escHtml(n.createdAt)}</span>
                                </div>
                                <div class="expense-row-ops">
                                    <button type="button" class="icon-mini-btn" onclick="startEditNote('${escHtml(n.id)}')">✏️ 編輯</button>
                                    <button type="button" class="icon-mini-btn del" onclick="deleteCloudNote('${escHtml(n.id)}')">🗑️</button>
                                </div>
                            </div>
                            <div class="note-content">${escHtml(n.content)}</div>
                        </div>`;
                }).join('') : `<div style="text-align:center;padding:24px;color:var(--text-light);font-size:0.86rem;">目前沒有符合條件的素材筆記，可直接在「📅 行程安排」的景點卡片裡隨手寫下第一則紀錄！</div>`}
            </div>
        </div>`;

    if (isFormVisible) updateNoteSpotSuggestions();
}

function startEditNote(id) {
    const target = cloudNotes.find(n => n.id === id);
    editingNoteId = id;
    showLibraryNoteForm = true;
    libraryFormRating = target ? (Number(target.rating) || 0) : 0;
    renderNotesPanel();
    $('note-form-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelEditNote() {
    editingNoteId = null;
    showLibraryNoteForm = false;
    libraryFormRating = 0;
    renderNotesPanel();
}

async function submitNoteForm() {
    const content = ($('note-content')?.value || '').trim();
    if (!content && !libraryFormRating) return alert('請輸入記事內容或選擇星級！');

    const btn = $('btn-save-note');
    btn.disabled = true; btn.textContent = '⏳ 同步中...';

    const oldItem = editingNoteId ? cloudNotes.find(n => n.id === editingNoteId) : null;
    const now = new Date();
    const localNow = `${todayISO()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const noteData = {
        id: editingNoteId || `note_${Date.now()}`,
        tripId,
        day: $('note-day').value || 'Day 01',
        spot: ($('note-spot').value || '').trim(),
        tag: normalizeNoteTag($('note-tag').value || '心情碎片'),
        content: content || `（給予 ${libraryFormRating} 顆星評價）`,
        rating: libraryFormRating,
        createdAt: oldItem?.createdAt || localNow
    };

    try {
        const res = await callGasPost({ action: 'saveNote', data: noteData });
        if (res?.ok) {
            if (res.createdAt) noteData.createdAt = res.createdAt;
            const idx = cloudNotes.findIndex(n => n.id === noteData.id);
            if (idx >= 0) cloudNotes[idx] = noteData;
            else cloudNotes.unshift(noteData);
            editingNoteId = null;
            showLibraryNoteForm = false;
            libraryFormRating = 0;
            renderNotesPanel();
            refreshItinerarySpotNotes();
        } else {
            alert(res?.error || '儲存失敗');
            btn.disabled = false; btn.textContent = '💾 儲存至素材庫';
        }
    } catch {
        alert('雲端連線失敗，請稍後再試');
        btn.disabled = false; btn.textContent = '💾 儲存至素材庫';
    }
}

async function deleteCloudNote(id) {
    if (!confirm('確定要刪除這則隨手記事嗎？')) return;
    try {
        const res = await callGasPost({ action: 'deleteNote', id });
        if (res?.ok) {
            cloudNotes = cloudNotes.filter(n => n.id !== id);
            if (editingNoteId === id) { editingNoteId = null; showLibraryNoteForm = false; }
            if (editingInlineNoteId === id) { editingInlineNoteId = null; activeInlineSpotIndex = null; }
            renderNotesPanel();
            refreshItinerarySpotNotes();
        } else {
            alert(res?.error || '刪除失敗');
        }
    } catch { alert('雲端連線失敗'); }
}

async function copyNotesMaterial(mode = 'draft') {
    const list = getFilteredNotesForLibrary().slice().reverse();
    if (!list.length) return alert('目前沒有可複製的素材筆記');

    const byDay = new Map();
    list.forEach(n => {
        const dKey = n.day || '未分類天數';
        if (!byDay.has(dKey)) byDay.set(dKey, new Map());
        const spotMap = byDay.get(dKey);
        const sKey = n.spot || '旅途零碎雜記';
        if (!spotMap.has(sKey)) spotMap.set(sKey, []);
        spotMap.get(sKey).push(n);
    });

    const tripTitle = rawItineraryData.tripTitle || rawJournalData.tripTitle || tripId;
    const sections = [];
    byDay.forEach((spotMap, dayKey) => {
        const dayLines = [`## ${dayKey}`];
        spotMap.forEach((notes, spotName) => {
            const rated = notes.filter(n => n.rating > 0);
            const starBadge = rated.length ? `（${formatStarsText(rated[0].rating)} ${rated[0].rating}.0）` : '';
            dayLines.push(`### ${spotName}${starBadge}`);
            notes.forEach(n => {
                dayLines.push(`- [${normalizeNoteTag(n.tag)}${n.createdAt ? '・' + n.createdAt : ''}] ${n.content}`);
            });
        });
        sections.push(dayLines.join('\n'));
    });

    let outputText = `# ${tripTitle}｜旅途寫作素材\n\n${sections.join('\n\n')}`;
    if (mode === 'ai') {
        outputText = [
            `請根據以下我在「${tripTitle}」旅途中記錄的實測素材與星級評價，協助我潤飾整理成溫暖、有畫面感的繁體中文遊記草稿。`,
            `整理需求：`,
            `1. 依天數與站點分段，保留我的真實口感、排隊時間、星級評價與避坑提醒。`,
            `2. 遇到「避坑提醒」或「實用情報」時，可額外整理成簡短的重點提示。`,
            `3. 語氣自然親切，不要過度浮誇，適合直接貼回我的電子旅行手帳（data/${tripId}.json）。`,
            ``,
            `=== 旅途原始素材開始 ===`,
            outputText
        ].join('\n');
    }

    try {
        await navigator.clipboard.writeText(outputText);
    } catch {
        const ta = document.createElement('textarea');
        ta.value = outputText; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
    }

    const btnId = mode === 'ai' ? 'btn-copy-ai' : 'btn-copy-draft';
    const origText = mode === 'ai' ? '🤖 複製 AI 遊記素材包' : '📋 複製結構化草稿';
    const btn = $(btnId);
    if (btn) {
        btn.textContent = '✔ 已複製到剪貼簿！';
        setTimeout(() => { btn.textContent = origText; }, 1800);
    }
}

/* =====================================================================
   7. 📖 旅遊小冊產生器（@media print 專屬 PDF 排版）
   ===================================================================== */
function openBookletModal() {
    const overlay = $('booklet-modal-overlay');
    if (!overlay) return;

    const privWrap = $('pb-inc-notes-wrap');
    const privChk = $('pb-inc-notes');
    if (privWrap && privChk) {
        privWrap.style.display = cloudEditPassword ? 'flex' : 'none';
        privChk.checked = false;
    }

    overlay.classList.add('open');
}

function closeBookletModal() {
    $('booklet-modal-overlay')?.classList.remove('open');
}

function collectBookletCoverPhotos() {
    const photos = [];
    for (const d of normalizedDays) {
        for (const ch of (d.chapters || [])) {
            const candidates = [];
            if (isMediaFile(ch.mediaPlaceholder) && !isVideoFile(ch.mediaPlaceholder)) {
                candidates.push(normalizeMediaSrc(ch.mediaPlaceholder));
            }
            (ch.mediaList || []).forEach(it => {
                const src = typeof it === 'string' ? it : (it?.src || it?.file || it?.url || '');
                if (isMediaFile(src) && !isVideoFile(src)) candidates.push(normalizeMediaSrc(src));
            });
            for (const src of candidates) {
                if (!photos.includes(src)) photos.push(src);
                if (photos.length >= 3) return photos;
            }
        }
    }
    return photos;
}

function setDynamicPrintPageSize(sizeMode) {
    let styleEl = $('dynamic-print-page-style');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'dynamic-print-page-style';
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = sizeMode === 'a5'
        ? '@media print { @page { size: A5 portrait; margin: 8mm; } }'
        : '@media print { @page { size: A4 portrait; margin: 11mm; } }';
}

function generateAndPrintBooklet() {
    const container = $('print-booklet');
    if (!container) return;

    const sizeMode = document.querySelector('input[name="pb-size"]:checked')?.value || 'a4';
    const incCover = Boolean($('pb-inc-cover')?.checked);
    const incVouchers = Boolean($('pb-inc-vouchers')?.checked);
    const incTransit = Boolean($('pb-inc-transit')?.checked);
    const incItinerary = Boolean($('pb-inc-itinerary')?.checked);
    const incMemo = Boolean($('pb-inc-memo')?.checked);
    const incChecklist = Boolean($('pb-inc-checklist')?.checked);
    const incPersonalNotes = Boolean(cloudEditPassword && $('pb-inc-notes')?.checked);

    setDynamicPrintPageSize(sizeMode);
    container.className = sizeMode === 'a5' ? 'size-a5' : '';

    const mainTitle = rawItineraryData.tripTitle || rawJournalData.tripTitle || '電子旅行手帳';
    const dateRange = (currentTripStartDate && currentTripEndDate)
        ? `${currentTripStartDate} ➔ ${currentTripEndDate}`
        : (rawItineraryData.dateSubTitle || '');
    const regions = [...new Set(normalizedDays.map(d => d.region).filter(Boolean))].join(' · ');

    const htmlParts = [];

    if (incCover) {
        const coverPhotos = collectBookletCoverPhotos();
        htmlParts.push(`
            <section class="pb-cover">
                <div class="pb-cover-brand">°•* FLÂNEUR TRAVELOGUE *•°</div>
                <div>
                    <h1 class="pb-cover-title">${escHtml(mainTitle)}</h1>
                    <div class="pb-cover-meta">
                        ${dateRange ? `<div>📅 ${escHtml(dateRange)}</div>` : ''}
                        ${regions ? `<div style="margin-top:4px;">📍 ${escHtml(regions)}</div>` : ''}
                    </div>
                    ${coverPhotos.length ? `
                        <div class="pb-cover-collage">
                            ${coverPhotos.map(src => `<img src="${escHtml(src)}" alt="旅程封面">`).join('')}
                        </div>` : ''}
                </div>
                <div>
                    <div class="pb-cover-summary">
                        <div>總天數<strong>${normalizedDays.length} 天</strong></div>
                        <div>安排站點<strong>${totalTripSpotCount} 處</strong></div>
                        <div>住宿飯店<strong>${cachedMergedHotels.length} 間</strong></div>
                    </div>
                    <div class="pb-cover-foot" style="margin-top:12px;">
                        ${incPersonalNotes ? '含個人實測星級與旅途隨手記 ｜ ' : ''}匯出日期：${todayISO()}
                    </div>
                </div>
            </section>`);
    }

    if ((incVouchers && cachedMergedHotels.length) || (incTransit && cachedTransits.length)) {
        let secHtml = `<section class="pb-section-page">`;
        if (incVouchers && cachedMergedHotels.length) {
            secHtml += `<h2 class="pb-section-title">🏨 住宿憑證與通關地址速查</h2>`;
            secHtml += cachedMergedHotels.map(h => `
                <div class="pb-hotel-card">
                    <div class="pb-hotel-head">
                        <span>${escHtml(h.officialName)}</span>
                        <span>${escHtml(h.dayStart)} ➔ ${escHtml(h.dayEnd)}（共 ${h.totalNights} 晚）</span>
                    </div>
                    <table class="pb-hotel-table">
                        <tr><th>訂單編號</th><td>${escHtml((h.bookingIds || []).join(' / '))}</td></tr>
                        <tr><th>房型專案</th><td>${escHtml(h.roomType)} ｜ ${escHtml(h.mealPlan)}</td></tr>
                        <tr><th>地址交通</th><td>${escHtml(h.address || '—')}</td></tr>
                    </table>
                </div>`).join('');
        }
        if (incTransit && cachedTransits.length) {
            secHtml += `
                <h2 class="pb-section-title" style="margin-top:14px;">🚄 重要交通與跨城移動時刻表</h2>
                <table class="pb-transit-table">
                    <thead><tr><th>天數</th><th>時間</th><th>動線與交通方式</th><th>席次／預估車資</th></tr></thead>
                    <tbody>
                        ${cachedTransits.map(t => `
                            <tr>
                                <td><strong>${escHtml(t.day)}</strong></td>
                                <td>${escHtml(t.alignedClock)}<br><small>${t.mins}分</small></td>
                                <td>${t.icon} <strong>${escHtml(t.routeText)}</strong><br><small>${escHtml(t.modeName)}・${escHtml(t.timeRange)}</small></td>
                                <td>${escHtml(t.seatType)}<br><small>NT$${toTwd(t.cost, t.currency).toLocaleString()}</small></td>
                            </tr>`).join('')}
                    </tbody>
                </table>`;
        }
        secHtml += `</section>`;
        htmlParts.push(secHtml);
    }

    if (incItinerary) {
        normalizedDays.forEach(dayObj => {
            let dayMins = 0, dayCost = 0;
            const spotCards = [];

            (dayObj.chapters || []).forEach((ch, idxInDay) => {
                const meta = classifyChapterMeta(ch, idxInDay, idxInDay > 0 ? dayObj.chapters[idxInDay - 1] : null);
                if (meta.transitInfo && idxInDay > 0 && meta.transitInfo.mode !== 'flight') {
                    const segTwd = toTwd(meta.transitInfo.cost, ch.transitCurrency);
                    dayMins += meta.transitInfo.mins;
                    dayCost += segTwd;
                    spotCards.push(`<div class="pb-transit-mini">${meta.transitInfo.icon} ${escHtml(meta.transitInfo.modeName)}｜${escHtml(meta.transitInfo.routeText)}（約 ${meta.transitInfo.mins} 分・NT$${segTwd.toLocaleString()}）</div>`);
                }

                let personalBlock = '';
                if (incPersonalNotes) {
                    const matchedNotes = getNotesForSpot(dayObj.day, meta.pureName);
                    if (matchedNotes.length) {
                        personalBlock = matchedNotes.map(n => `
                            <div class="pb-personal-note">
                                <strong>📝 我的隨手記${n.rating > 0 ? `・${formatStarsText(n.rating)} ${n.rating}.0` : ''}（${escHtml(normalizeNoteTag(n.tag))}）：</strong>${escHtml(n.content)}
                            </div>`).join('');
                    }
                }

                spotCards.push(`
                    <div class="pb-spot-card">
                        <div class="pb-spot-head">
                            <span class="pb-spot-time">${escHtml(meta.timeStr)}</span>
                            <span class="pb-spot-cat">${escHtml(meta.categoryLabel)}</span>
                            <span class="pb-spot-name">${escHtml(meta.pureName)}</span>
                        </div>
                        <div class="pb-spot-intro">${escHtml(meta.introText)}</div>
                        ${meta.noteText ? `<div class="pb-spot-note">⚠️ ${escHtml(meta.noteText)}</div>` : ''}
                        ${personalBlock}
                    </div>`);
            });

            const hrs = Math.floor(dayMins / 60), mins = dayMins % 60;
            const moveSummary = hrs > 0 ? `${hrs} 時 ${mins} 分` : `${mins} 分`;

            htmlParts.push(`
                <section class="pb-day-page">
                    <div class="pb-day-banner">
                        <h2>${escHtml(dayObj.day)}｜${escHtml(dayObj.itinDayTitle || dayObj.dayTitle || '')}</h2>
                        <div class="pb-day-banner-meta">📍 ${escHtml(dayObj.region || '')} ｜ 當日區域移動約 ${moveSummary} ｜ 預估交通 NT$${dayCost.toLocaleString()}</div>
                    </div>
                    ${spotCards.join('')}
                    ${incMemo ? `<div class="pb-memo-box"><span class="pb-memo-title">✍️ 旅途隨筆 ／ 車站紀念章留白區</span></div>` : ''}
                </section>`);
        });
    }

    if (incChecklist) {
        const srcList = cloudChecklist.length ? cloudChecklist : getSuggestedChecklistForTrip().map(i => ({ ...i, checked: false }));
        const grouped = {};
        srcList.forEach(item => {
            const g = item.group || '必備物品';
            if (!grouped[g]) grouped[g] = [];
            grouped[g].push(item);
        });
        htmlParts.push(`
            <section class="pb-checklist-page">
                <h2 class="pb-section-title">✅ 行前準備確認清單</h2>
                <div class="pb-chk-grid">
                    ${Object.entries(grouped).map(([gName, items]) => `
                        <div class="pb-chk-group">
                            <h4>${escHtml(gName)}</h4>
                            ${items.map(it => `<div class="pb-chk-row">${it.checked ? '☑' : '☐'} ${escHtml(it.text)}</div>`).join('')}
                        </div>`).join('')}
                </div>
            </section>`);
    }

    container.innerHTML = htmlParts.join('');
    closeBookletModal();

    setTimeout(() => window.print(), 180);
}

/* =====================================================================
   8. 💮 行程站點主動收集景點印章（含即時預覽、相似章防呆與雲端同步）
   ===================================================================== */
function getStampsForSpot(ch) {
    if (!ch || !Array.isArray(cloudStamps) || !cloudStamps.length) return [];
    return cloudStamps.filter(s => s.tripId === tripId && s.spotId && s.spotId === ch.id);
}

function refreshItinerarySpotStamps() {
    currentChaptersList.forEach((ch, chIndex) => {
        const slot = $(`spot-stamp-slot-${chIndex}`);
        const btn = $(`spot-stamp-btn-${chIndex}`);
        const spotStamps = getStampsForSpot(ch);

        if (slot) {
            slot.innerHTML = spotStamps.length
                ? `<span class="spot-stamp-badge" title="已收入旅遊護照">💮 ${spotStamps.length > 1 ? `已收 ${spotStamps.length} 章` : '已收印章'}</span>`
                : '';
        }
        if (btn) {
            btn.classList.toggle('collected', spotStamps.length > 0);
            btn.textContent = spotStamps.length > 0
                ? `💮 已收印章${spotStamps.length > 1 ? ` (${spotStamps.length})` : ''} ✓`
                : '💮 收集景點章';
        }
    });
}

function initStampModalControls() {
    if (stampControlsInited || typeof FlaneurStampEngine === 'undefined') return;
    const shapeSel = $('stp-shape');
    const motifSel = $('stp-motif');
    const swatchBox = $('stp-color-swatches');

    if (shapeSel) {
        shapeSel.innerHTML = FlaneurStampEngine.STAMP_SHAPES
            .map(s => `<option value="${s.key}">${escHtml(s.label)}</option>`).join('');
    }
    if (motifSel) {
        motifSel.innerHTML = FlaneurStampEngine.STAMP_MOTIFS
            .map(m => `<option value="${m.key}">${escHtml(m.label)}</option>`).join('');
    }
    if (swatchBox) {
        swatchBox.innerHTML = FlaneurStampEngine.STAMP_COLORS
            .map(c => `<button type="button" class="stamp-color-swatch" data-color="${c.key}" style="background:${c.key};" title="${escHtml(c.label)}" onclick="selectStampColor('${c.key}')"></button>`).join('');
    }
    stampControlsInited = true;
}

function selectStampColor(colorKey) {
    const input = $('stp-color');
    if (input) input.value = colorKey;
    document.querySelectorAll('#stp-color-swatches .stamp-color-swatch').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.color === colorKey);
    });
    updateStampModalPreview();
}

async function openSpotStampModal(chIndex, editId = null) {
    if (typeof FlaneurStampEngine === 'undefined') {
        return alert('印章引擎尚未載入完成，請重新整理頁面再試。');
    }
    if (!cloudEditPassword) {
        const ok = await unlockCloudEdit();
        if (!ok) return;
    }

    initStampModalControls();
    const ch = currentChaptersList[chIndex];
    if (!ch) return;

    stampModalChIndex = chIndex;
    const spotStamps = getStampsForSpot(ch);

    // 若本站已收過印章且沒有指定新建，預設開啟第一顆供管理，同時上方可切換「＋ 同站再收一顆」
    const targetStamp = editId === '__NEW__'
        ? null
        : (editId ? spotStamps.find(s => s.id === editId) : (spotStamps[0] || null));

    loadStampIntoModalForm(targetStamp, ch, spotStamps);
    $('stamp-modal-overlay')?.classList.add('open');
}

function loadStampIntoModalForm(stampObj, ch, spotStamps) {
    const eng = FlaneurStampEngine;
    const isEdit = Boolean(stampObj);
    editingStampId = isEdit ? stampObj.id : null;

    if (isEdit) {
        $('stp-name').value = stampObj.name || '';
        $('stp-country').value = stampObj.country || '';
        $('stp-region').value = stampObj.region || '';
        $('stp-date').value = stampObj.date || eng.calcTripDayDate(currentTripStartDate, ch._dayKey) || todayISO();
        $('stp-shape').value = stampObj.shape || 'circle';
        $('stp-motif').value = stampObj.motif || 'landmark';
        $('stp-custom-img').value = stampObj.customImage || '';
        $('stp-note').value = stampObj.note || '';
        selectStampColor(stampObj.color || '#354F6B');

        $('stamp-modal-title').textContent = '✏️ 管理景點印章';
        $('btn-save-stamp').textContent = '💾 更新護照印章';
        $('btn-delete-stamp').style.display = 'inline-block';
    } else {
        const preset = eng.inferStampPreset({
            name: ch._pureName,
            categoryLabel: ch._categoryLabel,
            isFood: ch._isFoodSpot,
            region: ch._region,
            country: ch._country,
            tripId,
            timezone: currentTripTimezone
        });
        $('stp-name').value = preset.name;
        $('stp-country').value = preset.country;
        $('stp-region').value = preset.region;
        $('stp-date').value = eng.calcTripDayDate(currentTripStartDate, ch._dayKey) || todayISO();
        $('stp-shape').value = preset.shape;
        $('stp-motif').value = preset.motif;
        $('stp-custom-img').value = '';
        $('stp-note').value = '';
        selectStampColor(preset.color);

        $('stamp-modal-title').textContent = '💮 收集景點印章';
        $('btn-save-stamp').textContent = '💮 蓋章並收入護照';
        $('btn-delete-stamp').style.display = 'none';
    }

    // 1. 本站已收印章管理條
    const existingBox = $('stamp-existing-on-spot');
    if (existingBox) {
        if (spotStamps.length) {
            existingBox.style.display = 'block';
            existingBox.innerHTML = `
                <div class="stamp-existing-head">
                    <span>✓ 本站已收錄 ${spotStamps.length} 枚印章（點擊可修改，或同站再蓋一顆）</span>
                </div>
                <div class="stamp-existing-chips">
                    ${spotStamps.map(s => `
                        <button type="button" class="stamp-existing-chip ${editingStampId === s.id ? 'active' : ''}"
                                onclick="openSpotStampModal(${stampModalChIndex}, '${escHtml(s.id)}')">
                            💮 ${escHtml(s.name)}（${escHtml(s.date || '無日期')}）
                        </button>`).join('')}
                    <button type="button" class="stamp-existing-chip ${!editingStampId ? 'active' : ''}"
                            onclick="openSpotStampModal(${stampModalChIndex}, '__NEW__')">
                        ＋ 同站再收一顆
                    </button>
                </div>`;
        } else {
            existingBox.style.display = 'none';
            existingBox.innerHTML = '';
        }
    }

    // 2. 複合站名快選建議（自動拆解 → / ＆ / 括號）
    const suggestBox = $('stamp-suggest-box');
    modalSpotSuggestNames = eng.suggestStampNames(ch.spotName || ch.title || ch._pureName);
    if (suggestBox) {
        if (modalSpotSuggestNames.length > 1) {
            suggestBox.style.display = 'block';
            suggestBox.innerHTML = `
                <div class="stamp-suggest-title">✨ 站點名稱快選（偵測到複合站名，點擊可直接套用簡潔章名）：</div>
                <div class="stamp-suggest-chips">
                    ${modalSpotSuggestNames.map((n, idx) => `
                        <button type="button" class="stamp-suggest-chip" onclick="applySuggestedStampName(${idx})">${escHtml(n)}</button>
                    `).join('')}
                </div>`;
        } else {
            suggestBox.style.display = 'none';
            suggestBox.innerHTML = '';
        }
    }

    onStampFormInput();
}

function applySuggestedStampName(idx) {
    const picked = modalSpotSuggestNames[idx];
    if (!picked) return;
    $('stp-name').value = picked;
    // 若正在新增印章，順便依新名稱自動切換對應外框、圖樣與印泥色
    if (!editingStampId && typeof FlaneurStampEngine !== 'undefined') {
        const ch = currentChaptersList[stampModalChIndex] || {};
        const preset = FlaneurStampEngine.inferStampPreset({
            name: picked,
            categoryLabel: ch._categoryLabel,
            isFood: ch._isFoodSpot,
            region: $('stp-region')?.value || ch._region,
            country: $('stp-country')?.value || ch._country,
            tripId,
            timezone: currentTripTimezone
        });
        $('stp-shape').value = preset.shape;
        $('stp-motif').value = preset.motif;
        selectStampColor(preset.color);
    }
    onStampFormInput();
}

function applyExistingStampSuggestion(idx) {
    const item = modalSimilarStamps[idx];
    if (!item) return;
    $('stp-name').value = item.name;
    if (item.country) $('stp-country').value = item.country;
    if (item.region) $('stp-region').value = item.region;
    if (item.shape) $('stp-shape').value = item.shape;
    if (item.motif) $('stp-motif').value = item.motif;
    if (item.customImage) $('stp-custom-img').value = item.customImage;
    if (item.color) selectStampColor(item.color);
    onStampFormInput();
}

function onStampFormInput() {
    const name = ($('stp-name')?.value || '').trim();
    const dateVal = ($('stp-date')?.value || '').trim();
    const simBox = $('stamp-similar-box');

    if (simBox && typeof FlaneurStampEngine !== 'undefined') {
        const otherStamps = cloudStamps.filter(s => s.id !== editingStampId);
        const sameDayDup = dateVal && name
            ? otherStamps.find(s => s.date === dateVal && String(s.name || '').trim().toLowerCase() === name.toLowerCase())
            : null;
        modalSimilarStamps = FlaneurStampEngine.findSimilarExistingStamps(name, otherStamps);

        if (sameDayDup) {
            simBox.style.display = 'block';
            simBox.innerHTML = `
                <div class="stamp-suggest-title">⚠️ 「${escHtml(sameDayDup.name)}」在 ${escHtml(dateVal)} 已經收錄過囉！為避免重複蓋章，請修改名稱或點上方已收印章直接編輯。</div>`;
        } else if (modalSimilarStamps.length) {
            const hasExact = modalSimilarStamps.some(m => m.exact);
            simBox.style.display = 'block';
            simBox.innerHTML = `
                <div class="stamp-suggest-title">
                    ${hasExact
                        ? '💡 護照裡已有同名印章！不同日期儲存後將自動合併為同一顆並累計次數（點擊可同步沿用舊章樣式）：'
                        : '💡 防呆提醒：護照裡已有相似名稱的印章，點擊可直接沿用相同名稱與樣式，避免收成兩顆重複章：'}
                </div>
                <div class="stamp-suggest-chips">
                    ${modalSimilarStamps.map((item, idx) => `
                        <button type="button" class="stamp-suggest-chip warn-chip" onclick="applyExistingStampSuggestion(${idx})">
                            💮 沿用「${escHtml(item.name)}」・已收 ${item.visitCount} 次
                        </button>`).join('')}
                </div>`;
        } else {
            simBox.style.display = 'none';
            simBox.innerHTML = '';
        }
    }

    updateStampModalPreview();
}

function updateStampModalPreview() {
    const previewEl = $('stamp-modal-preview');
    const ctxEl = $('stamp-modal-context');
    if (!previewEl || typeof FlaneurStampEngine === 'undefined') return;

    const stampObj = {
        name: ($('stp-name')?.value || '').trim() || '景點印章',
        country: ($('stp-country')?.value || '').trim(),
        region: ($('stp-region')?.value || '').trim(),
        date: ($('stp-date')?.value || '').trim(),
        shape: $('stp-shape')?.value || 'circle',
        motif: $('stp-motif')?.value || 'landmark',
        color: $('stp-color')?.value || '#354F6B',
        customImage: ($('stp-custom-img')?.value || '').trim()
    };

    previewEl.innerHTML = FlaneurStampEngine.renderStampVisualHTML(stampObj, { noTilt: true });

    const ch = currentChaptersList[stampModalChIndex];
    if (ctxEl && ch) {
        ctxEl.textContent = `${editingStampId ? '編輯中' : '綁定行程'}：${ch._dayKey} ｜ ${ch._pureName}`;
    }
}

function closeStampModal() {
    $('stamp-modal-overlay')?.classList.remove('open');
    stampModalChIndex = null;
    editingStampId = null;
    modalSpotSuggestNames = [];
    modalSimilarStamps = [];
}

async function submitStampModal() {
    const ch = currentChaptersList[stampModalChIndex];
    if (!ch) return;

    const name = ($('stp-name')?.value || '').trim();
    const dateVal = ($('stp-date')?.value || '').trim();
    if (!name) return alert('請輸入印章名稱！');

    // 前端即時攔截同日同名重複
    const dup = dateVal
        ? cloudStamps.find(s => s.id !== editingStampId && s.date === dateVal && String(s.name || '').trim().toLowerCase() === name.toLowerCase())
        : null;
    if (dup) {
        return alert(`「${name}」在 ${dateVal} 已經收集過囉！請修改名稱或直接編輯原本的印章。`);
    }

    const btn = $('btn-save-stamp');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ 蓋印同步中...';

    const stampData = {
        id: editingStampId || `stp_${Date.now()}`,
        name,
        country: ($('stp-country')?.value || '').trim(),
        region: ($('stp-region')?.value || '').trim(),
        date: dateVal,
        tripId,
        day: ch._dayKey || '',
        spotId: ch.id || '',
        shape: $('stp-shape')?.value || 'circle',
        motif: $('stp-motif')?.value || 'landmark',
        color: $('stp-color')?.value || '#354F6B',
        customImage: ($('stp-custom-img')?.value || '').trim(),
        note: ($('stp-note')?.value || '').trim()
    };

    try {
        const res = await callGasPost({ action: 'saveStamp', data: stampData });
        if (res?.ok) {
            const idx = cloudStamps.findIndex(s => s.id === stampData.id);
            if (idx >= 0) cloudStamps[idx] = stampData;
            else cloudStamps.unshift(stampData);

            refreshItinerarySpotStamps();
            refreshItinerarySpotNotes();
            closeStampModal();
        } else {
            alert(res?.error || '儲存印章失敗，請確認密碼與網路連線');
        }
    } catch {
        alert('雲端連線失敗，請稍後再試');
    } finally {
        btn.disabled = false;
        btn.textContent = origText;
    }
}

async function deleteEditingStamp() {
    if (!editingStampId) return;
    if (!confirm('確定要從旅遊護照移除這枚印章紀錄嗎？')) return;

    const btn = $('btn-delete-stamp');
    btn.disabled = true;
    try {
        const res = await callGasPost({ action: 'deleteStamp', id: editingStampId });
        if (res?.ok) {
            cloudStamps = cloudStamps.filter(s => s.id !== editingStampId);
            refreshItinerarySpotStamps();
            refreshItinerarySpotNotes();
            closeStampModal();
        } else {
            alert(res?.error || '刪除失敗');
        }
    } catch {
        alert('雲端連線失敗');
    } finally {
        btn.disabled = false;
    }
}
