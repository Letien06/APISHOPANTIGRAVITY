import {
  appendRequestPage,
  buildRequestFilterParams,
  dismissSplash,
  escapeHtml,
  formatInteger,
  formatLoadedCount,
  formatMicrosInputValue,
  formatMicrosToUsd,
  formatModelsSummary,
  formatVnDateTime,
  getKeyStatusMeta,
  getRequestStatusMeta,
  getTransactionTypeMeta,
  initSplashGuard,
  isChargeCappedByReservation,
  isoUtcToVnInput,
  mergeRequestPages,
  parseUsdToMicros,
  renderDailySpendChartSvg,
  renderNullableValue,
  translateApiError,
  vnInputToIsoUtc,
} from '/assets/format.js';

initSplashGuard();

const PAGE_LIMIT = 50;
const BASE_URL = 'https://api.tiencoder.tech/v1';

const dom = {
  liveStatus: document.getElementById('live-status'),
  headerUserBadge: document.getElementById('header-user-badge'),
  logoutBtn: document.getElementById('logout-btn'),
  loading: document.getElementById('console-loading'),
  body: document.getElementById('console-body'),
  feedback: document.getElementById('console-feedback'),
  accountHeading: document.getElementById('account-heading'),
  accountEmail: document.getElementById('account-email'),
  copyUrlBtn: document.getElementById('console-copy-url'),
  accQuota: document.getElementById('acc-quota'),
  accUsed: document.getElementById('acc-used'),
  accReserved: document.getElementById('acc-reserved'),
  accRemaining: document.getElementById('acc-remaining'),
  keysLimitNote: document.getElementById('keys-limit-note'),
  liveToggleBtn: document.getElementById('console-live-toggle'),
  refreshBtn: document.getElementById('refresh-console-btn'),
  openCreateBtn: document.getElementById('open-create-btn'),
  keysEmpty: document.getElementById('keys-empty'),
  keysTableWrap: document.getElementById('keys-table-wrap'),
  keysTbody: document.getElementById('keys-tbody'),
  detailSection: document.getElementById('detail-section'),
  detailHeading: document.getElementById('detail-heading'),
  detailPrefix: document.getElementById('detail-prefix'),
  detailHistoryCount: document.getElementById('detail-history-count'),
  detailCloseBtn: document.getElementById('detail-close-btn'),
  detailEmpty: document.getElementById('detail-empty'),
  detailTableWrap: document.getElementById('detail-table-wrap'),
  detailTbody: document.getElementById('detail-tbody'),
  detailLoadMoreWrap: document.getElementById('detail-load-more-wrap'),
  detailLoadMoreBtn: document.getElementById('detail-load-more-btn'),
  modelsCount: document.getElementById('models-count'),
  modelsTbody: document.getElementById('models-tbody'),
  keyModal: document.getElementById('key-modal'),
  keyModalForm: document.getElementById('key-modal-form'),
  keyModalTitle: document.getElementById('key-modal-title'),
  keyModalCloseX: document.getElementById('key-modal-close-x'),
  keyModalCancel: document.getElementById('key-modal-cancel'),
  keyModalSubmit: document.getElementById('key-modal-submit'),
  keyModalError: document.getElementById('key-modal-error'),
  keyNameInput: document.getElementById('key-name-input'),
  keyNoExpiry: document.getElementById('key-no-expiry'),
  keyExpiryWrap: document.getElementById('key-expiry-wrap'),
  keyExpiryInput: document.getElementById('key-expiry-input'),
  keyModelChecklist: document.getElementById('key-model-checklist'),
  revealModal: document.getElementById('reveal-modal'),
  revealKeyName: document.getElementById('reveal-key-name'),
  revealKeyValue: document.getElementById('reveal-key-value'),
  copyRevealedBtn: document.getElementById('copy-revealed-btn'),
  copyFeedback: document.getElementById('copy-feedback'),
  closeRevealBtn: document.getElementById('close-reveal-btn'),
  disableModal: document.getElementById('disable-modal'),
  disableModalMessage: document.getElementById('disable-modal-message'),
  disableCancelBtn: document.getElementById('disable-cancel-btn'),
  disableConfirmBtn: document.getElementById('disable-confirm-btn'),
  openPasswordBtn: document.getElementById('open-password-btn'),
  passwordModal: document.getElementById('password-modal'),
  passwordModalForm: document.getElementById('password-modal-form'),
  passwordModalCloseX: document.getElementById('password-modal-close-x'),
  passwordModalCancel: document.getElementById('password-modal-cancel'),
  passwordModalSubmit: document.getElementById('password-modal-submit'),
  passwordModalError: document.getElementById('password-modal-error'),
  pwCurrentInput: document.getElementById('pw-current-input'),
  pwNewInput: document.getElementById('pw-new-input'),
  pwConfirmInput: document.getElementById('pw-confirm-input'),
  redeemForm: document.getElementById('redeem-form'),
  redeemCodeInput: document.getElementById('redeem-code-input'),
  redeemSubmitBtn: document.getElementById('redeem-submit-btn'),
  anToday: document.getElementById('an-today'),
  anPeriod: document.getElementById('an-period'),
  anSaved: document.getElementById('an-saved'),
  anRequests: document.getElementById('an-requests'),
  consoleChartBox: document.getElementById('console-chart-box'),
  consoleTopModelsWrap: document.getElementById('console-top-models-wrap'),
  consoleTopModelsTbody: document.getElementById('console-top-models-tbody'),
  txCount: document.getElementById('tx-count'),
  txEmpty: document.getElementById('tx-empty'),
  txTableWrap: document.getElementById('tx-table-wrap'),
  txTbody: document.getElementById('tx-tbody'),
  detailExportCsvBtn: document.getElementById('detail-export-csv-btn'),
  detailFilterForm: document.getElementById('detail-filter-form'),
  detailFromDate: document.getElementById('detail-from-date'),
  detailToDate: document.getElementById('detail-to-date'),
  detailModelFilter: document.getElementById('detail-model-filter'),
  detailStatusFilter: document.getElementById('detail-status-filter'),
  detailFilterReset: document.getElementById('detail-filter-reset'),
};

const state = {
  user: null,
  keys: [],
  models: [],
  analytics: null,
  analyticsDays: 14,
  transactions: [],
  transactionsTotal: 0,
  selectedKey: null,
  history: [],
  historyTotal: 0,
  nextCursor: null,
  loadingMore: false,
  filters: { fromDate: '', toDate: '', model: 'all', status: 'all' },
  modalMode: 'create',
  editingKey: null,
  pendingDisableKey: null,
  revealedSecret: '',
  liveEnabled: true,
  pollTimer: null,
  pollInFlight: false,
  flashIds: new Set(),
  flashTimer: null,
};

const LIVE_INTERVAL_MS = 3000;

function setFeedback(message, tone = 'success') {
  if (!message) {
    dom.feedback.classList.add('hidden');
    dom.feedback.textContent = '';
    return;
  }
  dom.feedback.className = `alert alert-${tone}`;
  dom.feedback.textContent = message;
  dom.feedback.classList.remove('hidden');
  dom.liveStatus.textContent = message;
}

function wipeReveal() {
  state.revealedSecret = '';
  dom.revealKeyValue.textContent = '';
  dom.revealKeyName.textContent = '';
  dom.copyFeedback.textContent = '';
}

async function apiFetch(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  const init = { method, cache: 'no-store', credentials: 'same-origin', headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (res.status === 204) return null;
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok) {
    if (res.status === 401) {
      window.location.href = '/sign-in';
      throw { redirected: true };
    }
    throw { httpStatus: res.status, ...translateApiError(payload, res.status) };
  }
  return payload;
}

function renderAccount() {
  const u = state.user;
  dom.headerUserBadge.textContent = `@${u.username}`;
  dom.headerUserBadge.classList.remove('hidden');
  dom.accountHeading.textContent = `Xin chào, @${u.username}`;
  dom.accountEmail.textContent = `${u.email} · Tạo ngày ${formatVnDateTime(u.createdAt) ?? ''}`;
  const remainingMicros = u.remainingMicros ?? Math.max(0, u.quotaMicros - u.usedMicros - u.reservedMicros);
  dom.accQuota.textContent = formatMicrosToUsd(u.quotaMicros) ?? '$0.00';
  dom.accUsed.textContent = formatMicrosToUsd(u.usedMicros) ?? '$0.00';
  dom.accReserved.textContent = formatMicrosToUsd(u.reservedMicros) ?? '$0.00';
  dom.accRemaining.textContent = formatMicrosToUsd(remainingMicros) ?? '$0.00';
  const activeKeyCount = u.activeKeyCount ?? u.keyCount;
  dom.keysLimitNote.textContent = `Đang bật ${activeKeyCount}/${u.maxKeys} khóa hoạt động (tổng ${u.keyCount} khóa) · Tất cả khóa dùng chung số dư ví ${formatMicrosToUsd(remainingMicros)}`;
  dom.openCreateBtn.disabled = activeKeyCount >= u.maxKeys;
}

function renderModels() {
  dom.modelsCount.textContent = `${state.models.length} model`;
  dom.modelsTbody.innerHTML = state.models
    .map(
      (m) => {
        const cachedRate = m.cachedInputMicrosPerMillion ?? Math.round((m.inputMicrosPerMillion ?? 0) * 0.25);
        return `
      <tr>
        <td class="mono"><strong>${escapeHtml(m.id)}</strong></td>
        <td class="num">${escapeHtml(formatMicrosToUsd(m.inputMicrosPerMillion))}</td>
        <td class="num"><strong style="color: #059669">${escapeHtml(formatMicrosToUsd(cachedRate))}</strong></td>
        <td class="num">${escapeHtml(formatMicrosToUsd(m.outputMicrosPerMillion))}</td>
        <td class="num">${escapeHtml(formatInteger(m.maxInputTokens))}</td>
        <td class="num">${escapeHtml(formatInteger(m.maxOutputTokens))}</td>
        <td><button type="button" class="btn btn-outline btn-sm" data-copy-model="${escapeHtml(m.id)}">Sao chép ID</button></td>
      </tr>
    `;
      },
    )
    .join('');

  if (dom.detailModelFilter) {
    const prev = dom.detailModelFilter.value || 'all';
    dom.detailModelFilter.innerHTML = [
      '<option value="all">Tất cả model</option>',
      ...state.models.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.id)}</option>`),
    ].join('');
    if ([...dom.detailModelFilter.options].some((opt) => opt.value === prev)) {
      dom.detailModelFilter.value = prev;
    }
  }
}

function renderAnalytics() {
  const data = state.analytics;
  if (!data || !dom.consoleChartBox) return;
  const s = data.summary ?? {};
  if (dom.anToday) dom.anToday.textContent = formatMicrosToUsd(s.todaySpentMicros ?? 0) ?? '$0.00';
  if (dom.anPeriod) dom.anPeriod.textContent = formatMicrosToUsd(s.periodSpentMicros ?? 0) ?? '$0.00';
  if (dom.anSaved) dom.anSaved.textContent = formatMicrosToUsd(s.periodSavedMicros ?? 0) ?? '$0.00';
  if (dom.anRequests) dom.anRequests.textContent = formatInteger(s.totalRequests ?? 0) ?? '0';
  dom.consoleChartBox.innerHTML = renderDailySpendChartSvg(data.daily);

  const topModels = Array.isArray(data.topModels) ? data.topModels : [];
  if (topModels.length === 0) {
    dom.consoleTopModelsWrap?.classList.add('hidden');
    if (dom.consoleTopModelsTbody) dom.consoleTopModelsTbody.innerHTML = '';
  } else {
    dom.consoleTopModelsWrap?.classList.remove('hidden');
    if (dom.consoleTopModelsTbody) {
      dom.consoleTopModelsTbody.innerHTML = topModels
        .map(
          (m) => `
        <tr>
          <td class="mono"><strong>${escapeHtml(m.model)}</strong></td>
          <td class="num">${escapeHtml(formatInteger(m.requests))}</td>
          <td class="num">${escapeHtml(formatInteger(m.inputTokens))} / <span style="color:#059669">${escapeHtml(formatInteger(m.cachedTokens))}</span> / ${escapeHtml(formatInteger(m.outputTokens))}</td>
          <td class="num" style="color:#7c3aed; font-weight:700">${escapeHtml(formatMicrosToUsd(m.savedMicros) ?? '$0.00')}</td>
          <td class="num"><strong>${escapeHtml(formatMicrosToUsd(m.spentMicros) ?? '$0.00')}</strong></td>
        </tr>
      `,
        )
        .join('');
    }
  }
}

function renderTransactions() {
  if (!dom.txTbody) return;
  const total = Math.max(state.transactions.length, state.transactionsTotal);
  if (dom.txCount) dom.txCount.textContent = `${formatInteger(total) ?? '0'} giao dịch`;
  if (state.transactions.length === 0) {
    dom.txEmpty?.classList.remove('hidden');
    dom.txTableWrap?.classList.add('hidden');
    dom.txTbody.innerHTML = '';
    return;
  }
  dom.txEmpty?.classList.add('hidden');
  dom.txTableWrap?.classList.remove('hidden');
  dom.txTbody.innerHTML = state.transactions
    .map((tx) => {
      const meta = getTransactionTypeMeta(tx.type);
      const pos = tx.deltaMicros >= 0;
      const sign = pos ? '+' : '';
      return `
      <tr>
        <td class="num">${renderNullableValue(formatVnDateTime(tx.createdAt))}</td>
        <td><span class="badge badge-${meta.tone}">${escapeHtml(meta.label)}</span></td>
        <td class="num"><span class="${pos ? 'tx-delta-pos' : 'tx-delta-neg'}">${escapeHtml(sign + (formatMicrosToUsd(tx.deltaMicros) ?? '$0.00'))}</span></td>
        <td class="num"><strong>${escapeHtml(formatMicrosToUsd(tx.balanceAfterMicros) ?? '$0.00')}</strong></td>
        <td>
          <div>${escapeHtml(tx.note ?? '—')}</div>
          ${tx.refCode ? `<span class="sub-line mono">Mã: ${escapeHtml(tx.refCode)}</span>` : ''}
        </td>
      </tr>
    `;
    })
    .join('');
}

function hasActiveHistoryFilter() {
  return Boolean(
    state.filters.fromDate
    || state.filters.toDate
    || (state.filters.model && state.filters.model !== 'all')
    || (state.filters.status && state.filters.status !== 'all'),
  );
}

function renderKeyModelsCell(models) {
  if (models === null) {
    const preview = state.models.slice(0, 3).map((m) => m.id);
    const extra = state.models.length > 3 ? ` +${state.models.length - 3}` : '';
    return `<div><span class="badge badge-info">Tất cả (${state.models.length})</span></div>${
      preview.length ? `<span class="sub-line mono">${escapeHtml(preview.join(', '))}${escapeHtml(extra)}</span>` : ''
    }`;
  }
  if (Array.isArray(models) && models.length === 0) {
    return '<span class="badge badge-warning">Không cấp quyền</span>';
  }
  const preview = models.slice(0, 3);
  const extra = models.length > 3 ? ` +${models.length - 3}` : '';
  return `<div class="mono" style="font-size: 0.78rem">${escapeHtml(preview.join(', '))}${escapeHtml(extra)}</div>`;
}

function renderKeys() {
  if (state.keys.length === 0) {
    dom.keysEmpty.classList.remove('hidden');
    dom.keysTableWrap.classList.add('hidden');
    dom.keysTbody.innerHTML = '';
    return;
  }
  dom.keysEmpty.classList.add('hidden');
  dom.keysTableWrap.classList.remove('hidden');
  dom.keysTbody.innerHTML = state.keys
    .map((key) => {
      const meta = getKeyStatusMeta(key.status);
      const selected = state.selectedKey?.id === key.id;
      const expires =
        key.expiresAt === null
          ? 'Không đặt hạn dùng'
          : renderNullableValue(formatVnDateTime(key.expiresAt));
      const copyControl = key.canCopy
        ? `<button type="button" class="btn btn-outline btn-sm" style="min-height: 26px; padding: 0 9px; font-size: 0.74rem" data-action="copy-key" data-id="${escapeHtml(key.id)}">Sao chép</button>`
        : `<span class="muted-null" style="font-size: 0.73rem" title="Khóa tạo trước bản cập nhật không lưu bản mã hóa để sao chép lại">(khóa cũ)</span>`;
      return `
        <tr class="${selected ? 'selected-row' : ''}">
          <td>
            <strong>${escapeHtml(key.name)}</strong>
            <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 4px">
              <span class="mono" style="font-size: 0.8rem; color: #475569">${escapeHtml(key.keyPrefix)}•••</span>
              ${copyControl}
            </div>
          </td>
          <td><span class="badge badge-${meta.tone}">${escapeHtml(meta.label)}</span></td>
          <td class="num">
            <div><strong>${escapeHtml(formatMicrosToUsd(key.usedMicros))}</strong></div>
            <span class="sub-line">Dùng chung ví · Còn ${escapeHtml(formatMicrosToUsd(key.remainingMicros))}</span>
          </td>
          <td class="num">${escapeHtml(formatInteger(key.requestCount) ?? '0')}</td>
          <td class="num">${expires}</td>
          <td>${renderKeyModelsCell(key.models)}</td>
          <td>
            <div class="row-actions">
              <button type="button" class="btn btn-outline btn-sm" data-action="history" data-id="${escapeHtml(key.id)}">Lịch sử</button>
              <button type="button" class="btn btn-outline btn-sm" data-action="edit" data-id="${escapeHtml(key.id)}">Sửa</button>
              ${
                key.enabled
                  ? `<button type="button" class="btn btn-danger-outline btn-sm" data-action="disable" data-id="${escapeHtml(key.id)}">Vô hiệu hóa</button>`
                  : `<button type="button" class="btn btn-mint btn-sm" data-action="enable" data-id="${escapeHtml(key.id)}">Bật lại</button>`
              }
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

function renderHistory() {
  if (!state.selectedKey) {
    dom.detailSection.classList.add('hidden');
    return;
  }
  dom.detailSection.classList.remove('hidden');
  dom.detailHeading.textContent = `Lịch sử khóa: ${state.selectedKey.name}`;
  dom.detailPrefix.textContent = `${state.selectedKey.keyPrefix}•••`;
  const total = hasActiveHistoryFilter()
    ? Math.max(state.history.length, state.historyTotal)
    : Math.max(state.history.length, state.historyTotal, Number(state.selectedKey.requestCount ?? 0));
  dom.detailHistoryCount.textContent = formatLoadedCount(state.history.length, total);

  if (state.history.length === 0) {
    dom.detailEmpty.classList.remove('hidden');
    dom.detailTableWrap.classList.add('hidden');
    dom.detailLoadMoreWrap.classList.add('hidden');
    return;
  }

  dom.detailEmpty.classList.add('hidden');
  dom.detailTableWrap.classList.remove('hidden');
  dom.detailTbody.innerHTML = state.history
    .map((item) => {
      const meta = getRequestStatusMeta(item.status);
      const capped = isChargeCappedByReservation(item);
      const inTok = formatInteger(item.inputTokens);
      const outTok = formatInteger(item.outputTokens);
      const cachedTok = item.cachedTokens > 0 ? formatInteger(item.cachedTokens) : null;
      return `
        <tr class="${state.flashIds.has(item.id) ? 'row-new' : ''}">
          <td class="num">
            <div>${renderNullableValue(formatVnDateTime(item.createdAt))}</div>
            <span class="sub-line">Xong: ${renderNullableValue(formatVnDateTime(item.finishedAt))}</span>
          </td>
          <td>
            <div class="mono">${escapeHtml(item.model)}</div>
            <span class="sub-line mono">${escapeHtml(item.endpoint)}</span>
          </td>
          <td>
            <div class="badge-stack">
              <span class="badge badge-${meta.tone}">${escapeHtml(meta.label)}</span>
              ${item.estimated ? '<span class="badge badge-warning">Ước tính</span>' : ''}
            </div>
            <span class="sub-line">${item.httpStatus !== null ? `HTTP ${escapeHtml(item.httpStatus)}` : renderNullableValue(null)}</span>
          </td>
          <td class="num">
            <div>${renderNullableValue(formatMicrosToUsd(item.inputCostMicros))}</div>
            <span class="sub-line">${inTok !== null ? `${escapeHtml(inTok)} token` : renderNullableValue(null)}</span>
            ${cachedTok ? `<span class="sub-line" style="color: #059669; font-weight: 700">Cache: ${escapeHtml(cachedTok)} tok (-75%)</span>` : ''}
          </td>
          <td class="num">
            <div>${renderNullableValue(formatMicrosToUsd(item.outputCostMicros))}</div>
            <span class="sub-line">${outTok !== null ? `${escapeHtml(outTok)} token` : renderNullableValue(null)}</span>
          </td>
          <td class="num">
            <strong>${renderNullableValue(formatMicrosToUsd(item.chargedMicros))}</strong>
            ${capped ? '<div class="cap-note">Tổng chi phí đầu vào + đầu ra khác khoản đã trừ do giới hạn khoản giữ chỗ.</div>' : ''}
          </td>
        </tr>
      `;
    })
    .join('');

  if (state.nextCursor !== null) {
    dom.detailLoadMoreWrap.classList.remove('hidden');
    dom.detailLoadMoreBtn.disabled = state.loadingMore;
    dom.detailLoadMoreBtn.textContent = state.loadingMore ? 'Đang tải thêm...' : 'Tải thêm';
  } else {
    dom.detailLoadMoreWrap.classList.add('hidden');
  }
}

function updateLiveToggleUi() {
  if (!dom.liveToggleBtn) return;
  dom.liveToggleBtn.setAttribute('aria-pressed', String(state.liveEnabled));
  dom.liveToggleBtn.innerHTML = state.liveEnabled
    ? '<span class="live-dot-pulse" aria-hidden="true"></span><span>Trực tiếp</span>'
    : '<span class="live-dot-paused" aria-hidden="true"></span><span>Tạm dừng</span>';
}

async function silentPollConsole() {
  if (!state.liveEnabled || state.pollInFlight || document.hidden) return;
  if (dom.keyModal.open || dom.revealModal.open || dom.disableModal.open || dom.passwordModal?.open) return;
  state.pollInFlight = true;
  try {
    const selectedId = state.selectedKey?.id ?? null;
    const pollHistory = Boolean(selectedId) && !state.loadingMore;
    const histQuery = buildRequestFilterParams({ limit: PAGE_LIMIT, ...state.filters });
    const [keysData, latestPage] = await Promise.all([
      apiFetch('/api/console/keys'),
      pollHistory
        ? apiFetch(`/api/console/keys/${encodeURIComponent(selectedId)}/requests?${histQuery}`)
        : Promise.resolve(null),
    ]);
    state.user = keysData.user;
    state.keys = Array.isArray(keysData.items) ? keysData.items : [];
    if (selectedId) {
      const freshSelected = state.keys.find((k) => k.id === selectedId) ?? null;
      state.selectedKey = freshSelected;
    }
    renderAccount();
    renderKeys();
    if (pollHistory && !state.loadingMore && latestPage && state.selectedKey && state.selectedKey.id === selectedId) {
      const prevTotal = state.historyTotal;
      const nextTotal = Number.isSafeInteger(latestPage.total) ? latestPage.total : prevTotal;
      const { merged, nextCursor, changed } = mergeRequestPages(
        state.history,
        Array.isArray(latestPage.items) ? latestPage.items : [],
        {
          pageLimit: PAGE_LIMIT,
          incomingCursor: latestPage.nextCursor ?? null,
          currentCursor: state.nextCursor,
        },
      );
      const updated =
        changed.size > 0
        || merged.length !== state.history.length
        || nextCursor !== state.nextCursor
        || nextTotal !== prevTotal;
      if (updated) {
        state.history = merged;
        state.historyTotal = nextTotal;
        state.nextCursor = nextCursor;
        state.flashIds = changed;
        renderHistory();
        clearTimeout(state.flashTimer);
        state.flashTimer = setTimeout(() => {
          state.flashIds.clear();
        }, 1700);
      }
    }
  } catch {
    // Silent poll ignores transient errors unless redirected on 401
  } finally {
    state.pollInFlight = false;
  }
}

function startConsoleLivePolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(silentPollConsole, LIVE_INTERVAL_MS);
}

async function loadAnalytics(days = state.analyticsDays) {
  state.analyticsDays = days;
  document.querySelectorAll('.days-pill[data-console-days]').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.consoleDays) === days);
  });
  try {
    state.analytics = await apiFetch(`/api/console/analytics?days=${encodeURIComponent(days)}`);
    renderAnalytics();
  } catch {
    // Non-fatal
  }
}

async function loadAll() {
  const [keysData, modelsData, analyticsData, txData] = await Promise.all([
    apiFetch('/api/console/keys'),
    apiFetch('/api/public/models'),
    apiFetch(`/api/console/analytics?days=${encodeURIComponent(state.analyticsDays)}`).catch(() => null),
    apiFetch('/api/console/transactions?limit=50').catch(() => ({ items: [], total: 0 })),
  ]);
  state.user = keysData.user;
  state.keys = Array.isArray(keysData.items) ? keysData.items : [];
  state.models = Array.isArray(modelsData.items) ? modelsData.items : [];
  if (analyticsData) state.analytics = analyticsData;
  state.transactions = Array.isArray(txData?.items) ? txData.items : [];
  state.transactionsTotal = Number.isSafeInteger(txData?.total) ? txData.total : state.transactions.length;
  if (state.selectedKey) {
    state.selectedKey = state.keys.find((k) => k.id === state.selectedKey.id) ?? null;
  }
  renderAccount();
  renderModels();
  renderAnalytics();
  renderTransactions();
  renderKeys();
  dom.loading.classList.add('hidden');
  dom.body.classList.remove('hidden');
  if (state.selectedKey) {
    await openHistory(state.selectedKey);
  } else if (state.keys.length === 1) {
    await openHistory(state.keys[0]);
  } else {
    renderHistory();
  }
}

async function openHistory(key) {
  state.selectedKey = key;
  renderKeys();
  const qs = buildRequestFilterParams({ limit: PAGE_LIMIT, ...state.filters });
  const page = await apiFetch(`/api/console/keys/${encodeURIComponent(key.id)}/requests?${qs}`);
  if (state.selectedKey?.id !== key.id) return;
  state.history = Array.isArray(page.items) ? page.items : [];
  state.historyTotal = Number.isSafeInteger(page.total) ? page.total : state.history.length;
  state.nextCursor = page.nextCursor ?? null;
  renderHistory();
}

async function loadMoreHistory() {
  if (!state.selectedKey || state.nextCursor === null || state.loadingMore) return;
  const keyId = state.selectedKey.id;
  const cursor = state.nextCursor;
  state.loadingMore = true;
  renderHistory();
  try {
    const qs = buildRequestFilterParams({ limit: PAGE_LIMIT, before: cursor, ...state.filters });
    const page = await apiFetch(
      `/api/console/keys/${encodeURIComponent(keyId)}/requests?${qs}`,
    );
    if (state.selectedKey?.id !== keyId) return;
    state.history = appendRequestPage(state.history, page.items ?? []);
    if (Number.isSafeInteger(page.total)) state.historyTotal = page.total;
    state.nextCursor = page.nextCursor ?? null;
  } finally {
    state.loadingMore = false;
    renderHistory();
  }
}

function setModelScope(scope) {
  const radio = dom.keyModalForm.querySelector(`input[name="modelScope"][value="${scope}"]`);
  if (radio) radio.checked = true;
  dom.keyModelChecklist.classList.toggle('hidden', scope !== 'custom');
}

function populateChecklist(selectedIds) {
  const set = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  dom.keyModelChecklist.innerHTML = state.models
    .map(
      (m) => `
      <label class="checkbox-row">
        <input type="checkbox" name="allowedModels" value="${escapeHtml(m.id)}" ${set.has(m.id) ? 'checked' : ''} />
        <span class="mono">${escapeHtml(m.id)}</span>
      </label>
    `,
    )
    .join('');
}

function showModalError(message) {
  if (!message) {
    dom.keyModalError.classList.add('hidden');
    dom.keyModalError.textContent = '';
    return;
  }
  dom.keyModalError.textContent = message;
  dom.keyModalError.classList.remove('hidden');
}

function openCreateModal() {
  state.modalMode = 'create';
  state.editingKey = null;
  dom.keyModalTitle.textContent = 'Tạo khóa API mới';
  dom.keyModalSubmit.textContent = 'Tạo khóa';
  dom.keyNameInput.value = '';
  dom.keyNoExpiry.checked = true;
  dom.keyExpiryInput.value = '';
  dom.keyExpiryWrap.classList.add('hidden');
  populateChecklist([]);
  setModelScope('all');
  showModalError('');
  dom.keyModal.showModal();
  dom.keyNameInput.focus();
}

function openEditModal(key) {
  state.modalMode = 'edit';
  state.editingKey = key;
  dom.keyModalTitle.textContent = `Chỉnh sửa khóa: ${key.name}`;
  dom.keyModalSubmit.textContent = 'Lưu thay đổi';
  dom.keyNameInput.value = key.name;
  if (key.expiresAt === null) {
    dom.keyNoExpiry.checked = true;
    dom.keyExpiryInput.value = '';
    dom.keyExpiryWrap.classList.add('hidden');
  } else {
    dom.keyNoExpiry.checked = false;
    dom.keyExpiryInput.value = isoUtcToVnInput(key.expiresAt);
    dom.keyExpiryWrap.classList.remove('hidden');
  }
  populateChecklist(key.models);
  setModelScope(key.models === null ? 'all' : 'custom');
  showModalError('');
  dom.keyModal.showModal();
  dom.keyNameInput.focus();
}

dom.keyModalForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showModalError('');
  const name = dom.keyNameInput.value.trim();
  if (!name || name.length > 100) {
    showModalError('Tên khóa phải dài từ 1 đến 100 ký tự.');
    return;
  }
  let expiresAt = null;
  if (!dom.keyNoExpiry.checked) {
    if (!dom.keyExpiryInput.value.trim()) {
      showModalError('Chọn thời điểm hết hạn (Giờ Việt Nam) hoặc tích "Không đặt hạn dùng".');
      return;
    }
    const parsedExp = vnInputToIsoUtc(dom.keyExpiryInput.value);
    if (!parsedExp.ok) {
      showModalError(parsedExp.error);
      return;
    }
    expiresAt = parsedExp.value;
  }
  const scope = dom.keyModalForm.querySelector('input[name="modelScope"]:checked')?.value ?? 'all';
  const models =
    scope === 'all'
      ? null
      : [...dom.keyModelChecklist.querySelectorAll('input[name="allowedModels"]:checked')].map((el) => el.value);

  dom.keyModalSubmit.disabled = true;
  try {
    if (state.modalMode === 'create') {
      const created = await apiFetch('/api/console/keys', {
        method: 'POST',
        body: { name, expiresAt, models },
      });
      dom.keyModal.close();
      state.revealedSecret = created.key;
      dom.revealKeyName.textContent = `${created.name} (${created.keyPrefix}•••)`;
      dom.revealKeyValue.textContent = created.key;
      dom.copyFeedback.textContent = '';
      dom.revealModal.showModal();
      setFeedback(`Đã tạo khóa "${created.name}".`, 'success');
      await loadAll();
    } else if (state.editingKey) {
      await apiFetch(`/api/console/keys/${encodeURIComponent(state.editingKey.id)}`, {
        method: 'PATCH',
        body: { name, expiresAt, models },
      });
      dom.keyModal.close();
      setFeedback(`Đã cập nhật khóa "${name}".`, 'success');
      await loadAll();
    }
  } catch (error) {
    if (!error?.redirected) showModalError(error.message ?? 'Không thể lưu khóa.');
  } finally {
    dom.keyModalSubmit.disabled = false;
  }
});

dom.keysTbody.addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const key = state.keys.find((k) => k.id === btn.dataset.id);
  if (!key) return;
  if (btn.dataset.action === 'copy-key') {
    btn.disabled = true;
    try {
      const data = await apiFetch(`/api/console/keys/${encodeURIComponent(key.id)}/secret`);
      if (data?.key) {
        await navigator.clipboard.writeText(data.key);
        btn.textContent = 'Đã chép ✓';
        setTimeout(() => {
          btn.textContent = 'Sao chép';
        }, 1600);
      }
    } catch (error) {
      if (!error?.redirected) setFeedback(error.message ?? 'Không thể sao chép khóa này.', 'danger');
    } finally {
      btn.disabled = false;
    }
  } else if (btn.dataset.action === 'history') {
    await openHistory(key);
  } else if (btn.dataset.action === 'edit') {
    openEditModal(key);
  } else if (btn.dataset.action === 'disable') {
    state.pendingDisableKey = key;
    dom.disableModalMessage.textContent = `Bạn có chắc muốn vô hiệu hóa khóa "${key.name}" (${key.keyPrefix}•••)?`;
    dom.disableModal.showModal();
  } else if (btn.dataset.action === 'enable') {
    try {
      await apiFetch(`/api/console/keys/${encodeURIComponent(key.id)}`, {
        method: 'PATCH',
        body: { enabled: true },
      });
      setFeedback(`Đã bật lại khóa "${key.name}".`, 'success');
      await loadAll();
    } catch (error) {
      if (!error?.redirected) setFeedback(error.message ?? 'Không thể bật lại khóa.', 'danger');
    }
  }
});

dom.disableConfirmBtn.addEventListener('click', async () => {
  const key = state.pendingDisableKey;
  if (!key) return;
  dom.disableConfirmBtn.disabled = true;
  try {
    await apiFetch(`/api/console/keys/${encodeURIComponent(key.id)}`, { method: 'DELETE' });
    state.pendingDisableKey = null;
    dom.disableModal.close();
    setFeedback(`Đã vô hiệu hóa khóa "${key.name}".`, 'success');
    await loadAll();
  } catch (error) {
    if (!error?.redirected) setFeedback(error.message ?? 'Không thể vô hiệu hóa khóa.', 'danger');
  } finally {
    dom.disableConfirmBtn.disabled = false;
  }
});

dom.disableCancelBtn.addEventListener('click', () => {
  state.pendingDisableKey = null;
  dom.disableModal.close();
});

dom.logoutBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store', credentials: 'same-origin' });
  } finally {
    wipeReveal();
    window.location.href = '/sign-in';
  }
});

dom.consoleCopyUrl = dom.copyUrlBtn;
dom.copyUrlBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(BASE_URL);
    dom.copyUrlBtn.textContent = 'Đã chép ✓';
    setTimeout(() => {
      dom.copyUrlBtn.textContent = 'Sao chép';
    }, 1800);
  } catch {
    dom.copyUrlBtn.textContent = 'Ctrl+C';
  }
});

dom.refreshBtn.addEventListener('click', () => {
  setFeedback('');
  loadAll().catch((err) => {
    if (!err?.redirected) setFeedback(err.message ?? 'Không thể làm mới.', 'danger');
  });
});

dom.openCreateBtn.addEventListener('click', openCreateModal);
dom.detailCloseBtn.addEventListener('click', () => {
  state.selectedKey = null;
  renderKeys();
  renderHistory();
});
dom.detailLoadMoreBtn.addEventListener('click', loadMoreHistory);

dom.keyNoExpiry.addEventListener('change', () => {
  dom.keyExpiryWrap.classList.toggle('hidden', dom.keyNoExpiry.checked);
});
dom.keyModalForm.addEventListener('change', (e) => {
  if (e.target.name === 'modelScope') {
    dom.keyModelChecklist.classList.toggle('hidden', e.target.value !== 'custom');
  }
});
dom.keyModalCancel.addEventListener('click', () => dom.keyModal.close());
dom.keyModalCloseX.addEventListener('click', () => dom.keyModal.close());

dom.copyRevealedBtn.addEventListener('click', async () => {
  if (!state.revealedSecret) return;
  try {
    await navigator.clipboard.writeText(state.revealedSecret);
    dom.copyFeedback.textContent = 'Đã sao chép khóa vào clipboard.';
  } catch {
    dom.copyFeedback.textContent = 'Hãy bôi đen khóa trong khung và bấm Ctrl+C.';
  }
});
dom.closeRevealBtn.addEventListener('click', () => {
  wipeReveal();
  dom.revealModal.close();
});
dom.revealModal.addEventListener('close', wipeReveal);

document.addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-copy-model]');
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.dataset.copyModel);
    btn.textContent = 'Đã chép ✓';
    setTimeout(() => {
      btn.textContent = 'Sao chép ID';
    }, 1500);
  } catch {
    btn.textContent = 'Ctrl+C';
  }
});

if (dom.liveToggleBtn) {
  dom.liveToggleBtn.addEventListener('click', () => {
    state.liveEnabled = !state.liveEnabled;
    updateLiveToggleUi();
    if (state.liveEnabled) silentPollConsole();
  });
}

document.querySelectorAll('.days-pill[data-console-days]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const days = Number(btn.dataset.consoleDays) || 14;
    loadAnalytics(days);
  });
});

if (dom.redeemForm) {
  dom.redeemForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = dom.redeemCodeInput.value.trim();
    if (!code) {
      setFeedback('Vui lòng nhập mã Giftcode trước khi áp dụng.', 'warning');
      dom.redeemCodeInput.focus();
      return;
    }
    dom.redeemSubmitBtn.disabled = true;
    try {
      const res = await apiFetch('/api/console/redeem', { method: 'POST', body: { code } });
      dom.redeemCodeInput.value = '';
      const addedUsd = formatMicrosToUsd(res.giftcode?.amountMicros ?? 0);
      setFeedback(`Đã nạp thành công ${addedUsd} từ mã ${res.giftcode?.code ?? code} vào ví của bạn!`, 'success');
      await loadAll();
    } catch (error) {
      if (!error?.redirected) setFeedback(error.message ?? 'Không thể áp dụng mã Giftcode.', 'danger');
    } finally {
      dom.redeemSubmitBtn.disabled = false;
    }
  });
}

function showPasswordError(msg) {
  if (!dom.passwordModalError) return;
  if (!msg) {
    dom.passwordModalError.classList.add('hidden');
    dom.passwordModalError.textContent = '';
    return;
  }
  dom.passwordModalError.textContent = msg;
  dom.passwordModalError.classList.remove('hidden');
}

if (dom.openPasswordBtn && dom.passwordModal) {
  dom.openPasswordBtn.addEventListener('click', () => {
    dom.pwCurrentInput.value = '';
    dom.pwNewInput.value = '';
    dom.pwConfirmInput.value = '';
    showPasswordError('');
    dom.passwordModal.showModal();
    dom.pwCurrentInput.focus();
  });
  dom.passwordModalCancel.addEventListener('click', () => dom.passwordModal.close());
  dom.passwordModalCloseX.addEventListener('click', () => dom.passwordModal.close());
  dom.passwordModalForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showPasswordError('');
    const currentPassword = dom.pwCurrentInput.value;
    const newPassword = dom.pwNewInput.value;
    const confirmPassword = dom.pwConfirmInput.value;
    if (!currentPassword) {
      showPasswordError('Vui lòng nhập mật khẩu hiện tại.');
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      showPasswordError('Mật khẩu mới phải dài từ 8 đến 128 ký tự.');
      return;
    }
    if (newPassword !== confirmPassword) {
      showPasswordError('Mật khẩu xác nhận không khớp với mật khẩu mới.');
      return;
    }
    dom.passwordModalSubmit.disabled = true;
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      dom.passwordModal.close();
      setFeedback('Đã đổi mật khẩu thành công. Các phiên đăng nhập ở thiết bị khác đã bị đăng xuất.', 'success');
    } catch (error) {
      if (!error?.redirected) showPasswordError(error.message ?? 'Không thể đổi mật khẩu.');
    } finally {
      dom.passwordModalSubmit.disabled = false;
    }
  });
}

if (dom.detailFilterForm) {
  dom.detailFilterForm.addEventListener('submit', (event) => {
    event.preventDefault();
    state.filters = {
      fromDate: dom.detailFromDate?.value ?? '',
      toDate: dom.detailToDate?.value ?? '',
      model: dom.detailModelFilter?.value ?? 'all',
      status: dom.detailStatusFilter?.value ?? 'all',
    };
    if (state.selectedKey) {
      openHistory(state.selectedKey).catch((err) => {
        if (!err?.redirected) setFeedback(err.message ?? 'Không thể lọc lịch sử.', 'danger');
      });
    }
  });
}

if (dom.detailFilterReset) {
  dom.detailFilterReset.addEventListener('click', () => {
    if (dom.detailFromDate) dom.detailFromDate.value = '';
    if (dom.detailToDate) dom.detailToDate.value = '';
    if (dom.detailModelFilter) dom.detailModelFilter.value = 'all';
    if (dom.detailStatusFilter) dom.detailStatusFilter.value = 'all';
    state.filters = { fromDate: '', toDate: '', model: 'all', status: 'all' };
    if (state.selectedKey) openHistory(state.selectedKey).catch(() => {});
  });
}

if (dom.detailExportCsvBtn) {
  dom.detailExportCsvBtn.addEventListener('click', () => {
    if (!state.selectedKey) return;
    const qs = buildRequestFilterParams(state.filters);
    const url = `/api/console/keys/${encodeURIComponent(state.selectedKey.id)}/requests.csv${qs ? `?${qs}` : ''}`;
    window.location.href = url;
  });
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.liveEnabled) silentPollConsole();
});

updateLiveToggleUi();
loadAll()
  .then(() => {
    startConsoleLivePolling();
    dismissSplash();
  })
  .catch((err) => {
    if (!err?.redirected) {
      dom.loading.classList.add('hidden');
      dom.body.classList.remove('hidden');
      setFeedback(err.message ?? 'Không thể tải Console.', 'danger');
      dismissSplash();
    }
  });
