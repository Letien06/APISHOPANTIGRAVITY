import {
  appendRequestPage,
  buildRequestFilterParams,
  dismissSplash,
  escapeHtml,
  formatBytes,
  formatInteger,
  formatLoadedCount,
  formatMicrosInputValue,
  formatMicrosToUsd,
  formatModelsSummary,
  formatVnDateTime,
  getGiftcodeStatusMeta,
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
  triggerBlobDownload,
  vnInputToIsoUtc,
} from '/admin/assets/format.js';

initSplashGuard();

const PAGE_LIMIT = 50;
const LIVE_INTERVAL_MS = 3000;

const dom = {
  liveStatus: document.getElementById('live-status'),
  logoutBtn: document.getElementById('logout-btn'),
  adminLiveToggle: document.getElementById('admin-live-toggle'),
  authSection: document.getElementById('auth-section'),
  passwordAuthForm: document.getElementById('password-auth-form'),
  adminUsernameInput: document.getElementById('admin-username-input'),
  adminPasswordInput: document.getElementById('admin-password-input'),
  toggleAdminPassword: document.getElementById('toggle-admin-password'),
  passwordAuthSubmit: document.getElementById('password-auth-submit'),
  authForm: document.getElementById('auth-form'),
  authError: document.getElementById('auth-error'),
  adminTokenInput: document.getElementById('admin-token-input'),
  toggleAdminToken: document.getElementById('toggle-admin-token'),
  authSubmitBtn: document.getElementById('auth-submit-btn'),
  workspace: document.getElementById('workspace'),
  globalFeedback: document.getElementById('global-feedback'),
  refreshAllBtn: document.getElementById('refresh-all-btn'),
  openCreateKeyBtn: document.getElementById('open-create-key-btn'),
  keysEmpty: document.getElementById('keys-empty'),
  keysTableWrap: document.getElementById('keys-table-wrap'),
  keysTbody: document.getElementById('keys-tbody'),
  usersCount: document.getElementById('users-count'),
  usersEmpty: document.getElementById('users-empty'),
  usersTableWrap: document.getElementById('users-table-wrap'),
  usersTbody: document.getElementById('users-tbody'),
  userModal: document.getElementById('user-modal'),
  userModalForm: document.getElementById('user-modal-form'),
  userModalTitle: document.getElementById('user-modal-title'),
  userModalCloseX: document.getElementById('user-modal-close-x'),
  userModalCancel: document.getElementById('user-modal-cancel'),
  userModalSubmit: document.getElementById('user-modal-submit'),
  userModalError: document.getElementById('user-modal-error'),
  userQuotaInput: document.getElementById('user-quota-input'),
  userQuotaHint: document.getElementById('user-quota-hint'),
  userEnabledInput: document.getElementById('user-enabled-input'),
  modelsCount: document.getElementById('models-count'),
  modelsTbody: document.getElementById('models-tbody'),
  detailSection: document.getElementById('detail-section'),
  detailHeading: document.getElementById('detail-heading'),
  detailPrefix: document.getElementById('detail-prefix'),
  detailStatusBadge: document.getElementById('detail-status-badge'),
  detailCopyKeyBtn: document.getElementById('detail-copy-key-btn'),
  detailEditBtn: document.getElementById('detail-edit-btn'),
  detailToggleEnabledBtn: document.getElementById('detail-toggle-enabled-btn'),
  detailCloseBtn: document.getElementById('detail-close-btn'),
  detailQuota: document.getElementById('detail-quota'),
  detailUsed: document.getElementById('detail-used'),
  detailReserved: document.getElementById('detail-reserved'),
  detailRemaining: document.getElementById('detail-remaining'),
  detailRequests: document.getElementById('detail-requests'),
  detailCreated: document.getElementById('detail-created'),
  detailExpires: document.getElementById('detail-expires'),
  detailModels: document.getElementById('detail-models'),
  detailHistoryCount: document.getElementById('detail-history-count'),
  detailHistoryError: document.getElementById('detail-history-error'),
  detailHistoryEmpty: document.getElementById('detail-history-empty'),
  detailHistoryTableWrap: document.getElementById('detail-history-table-wrap'),
  detailHistoryTbody: document.getElementById('detail-history-tbody'),
  detailLoadMoreWrap: document.getElementById('detail-load-more-wrap'),
  detailLoadMoreBtn: document.getElementById('detail-load-more-btn'),
  liveRequestsCount: document.getElementById('live-requests-count'),
  liveRequestsError: document.getElementById('live-requests-error'),
  liveRequestsEmpty: document.getElementById('live-requests-empty'),
  liveRequestsTableWrap: document.getElementById('live-requests-table-wrap'),
  liveRequestsTbody: document.getElementById('live-requests-tbody'),
  liveLoadMoreWrap: document.getElementById('live-load-more-wrap'),
  liveLoadMoreBtn: document.getElementById('live-load-more-btn'),
  ovActiveKeys: document.getElementById('ov-active-keys'),
  ovUsers: document.getElementById('ov-users'),
  ovRequests: document.getElementById('ov-requests'),
  ovSpent: document.getElementById('ov-spent'),
  navCountKeys: document.getElementById('nav-count-keys'),
  navCountLive: document.getElementById('nav-count-live'),
  navCountUsers: document.getElementById('nav-count-users'),
  navCountModels: document.getElementById('nav-count-models'),
  keysSearch: document.getElementById('keys-search'),
  keysStatusFilter: document.getElementById('keys-status-filter'),
  liveSearch: document.getElementById('live-search'),
  usersSearch: document.getElementById('users-search'),
  modelsSearch: document.getElementById('models-search'),
  keyModal: document.getElementById('key-modal'),
  keyModalForm: document.getElementById('key-modal-form'),
  keyModalTitle: document.getElementById('key-modal-title'),
  keyModalCloseX: document.getElementById('key-modal-close-x'),
  keyModalCancel: document.getElementById('key-modal-cancel'),
  keyModalSubmit: document.getElementById('key-modal-submit'),
  keyModalError: document.getElementById('key-modal-error'),
  keyNameInput: document.getElementById('key-name-input'),
  keyQuotaInput: document.getElementById('key-quota-input'),
  keyQuotaHint: document.getElementById('key-quota-hint'),
  keyNoExpiry: document.getElementById('key-no-expiry'),
  keyExpiryInputWrap: document.getElementById('key-expiry-input-wrap'),
  keyExpiryInput: document.getElementById('key-expiry-input'),
  keyModelChecklist: document.getElementById('key-model-checklist'),
  keyEnabledField: document.getElementById('key-enabled-field'),
  keyEnabledInput: document.getElementById('key-enabled-input'),
  revealModal: document.getElementById('reveal-modal'),
  revealKeyName: document.getElementById('reveal-key-name'),
  revealKeyValue: document.getElementById('reveal-key-value'),
  copyRevealedKeyBtn: document.getElementById('copy-revealed-key-btn'),
  copyFeedback: document.getElementById('copy-feedback'),
  closeRevealModalBtn: document.getElementById('close-reveal-modal-btn'),
  disableModal: document.getElementById('disable-modal'),
  disableModalMessage: document.getElementById('disable-modal-message'),
  disableModalError: document.getElementById('disable-modal-error'),
  disableModalCancel: document.getElementById('disable-modal-cancel'),
  disableModalConfirm: document.getElementById('disable-modal-confirm'),
  navCountGiftcodes: document.getElementById('nav-count-giftcodes'),
  userNoteInput: document.getElementById('user-note-input'),
  userResetPwInput: document.getElementById('user-reset-pw-input'),
  userGenPwBtn: document.getElementById('user-gen-pw-btn'),
  userResetPwBtn: document.getElementById('user-reset-pw-btn'),
  detailExportCsvBtn: document.getElementById('detail-export-csv-btn'),
  detailFilterForm: document.getElementById('detail-filter-form'),
  detailFromDate: document.getElementById('detail-from-date'),
  detailToDate: document.getElementById('detail-to-date'),
  detailModelFilter: document.getElementById('detail-model-filter'),
  detailStatusFilter: document.getElementById('detail-status-filter'),
  detailFilterReset: document.getElementById('detail-filter-reset'),
  liveExportCsvBtn: document.getElementById('live-export-csv-btn'),
  liveFilterForm: document.getElementById('live-filter-form'),
  liveFromDate: document.getElementById('live-from-date'),
  liveToDate: document.getElementById('live-to-date'),
  liveModelFilter: document.getElementById('live-model-filter'),
  liveStatusFilter: document.getElementById('live-status-filter'),
  liveFilterReset: document.getElementById('live-filter-reset'),
  admAnToday: document.getElementById('adm-an-today'),
  admAnPeriod: document.getElementById('adm-an-period'),
  admAnSaved: document.getElementById('adm-an-saved'),
  admAnTopup: document.getElementById('adm-an-topup'),
  admChartBox: document.getElementById('adm-chart-box'),
  admTopModelsEmpty: document.getElementById('adm-top-models-empty'),
  admTopModelsWrap: document.getElementById('adm-top-models-wrap'),
  admTopModelsTbody: document.getElementById('adm-top-models-tbody'),
  admTopUsersEmpty: document.getElementById('adm-top-users-empty'),
  admTopUsersWrap: document.getElementById('adm-top-users-wrap'),
  admTopUsersTbody: document.getElementById('adm-top-users-tbody'),
  backupsPolicyNote: document.getElementById('backups-policy-note'),
  createBackupBtn: document.getElementById('create-backup-btn'),
  backupsEmpty: document.getElementById('backups-empty'),
  backupsTableWrap: document.getElementById('backups-table-wrap'),
  backupsTbody: document.getElementById('backups-tbody'),
  openGiftcodeBtn: document.getElementById('open-giftcode-btn'),
  giftcodesEmpty: document.getElementById('giftcodes-empty'),
  giftcodesTableWrap: document.getElementById('giftcodes-table-wrap'),
  giftcodesTbody: document.getElementById('giftcodes-tbody'),
  ledgerCount: document.getElementById('ledger-count'),
  ledgerEmpty: document.getElementById('ledger-empty'),
  ledgerTableWrap: document.getElementById('ledger-table-wrap'),
  ledgerTbody: document.getElementById('ledger-tbody'),
  giftcodeModal: document.getElementById('giftcode-modal'),
  giftcodeModalForm: document.getElementById('giftcode-modal-form'),
  giftcodeModalCloseX: document.getElementById('giftcode-modal-close-x'),
  giftcodeModalCancel: document.getElementById('giftcode-modal-cancel'),
  giftcodeModalSubmit: document.getElementById('giftcode-modal-submit'),
  giftcodeModalError: document.getElementById('giftcode-modal-error'),
  gcCodeInput: document.getElementById('gc-code-input'),
  gcAmountInput: document.getElementById('gc-amount-input'),
  gcMaxUsesInput: document.getElementById('gc-max-uses-input'),
  gcNoExpiry: document.getElementById('gc-no-expiry'),
  gcExpiryWrap: document.getElementById('gc-expiry-wrap'),
  gcExpiryInput: document.getElementById('gc-expiry-input'),
  gcNoteInput: document.getElementById('gc-note-input'),
};

// Strictly in-memory session state — never persisted to cookies or web storage.
const state = {
  adminToken: '',
  authenticated: false,
  generation: 0,
  controller: null,
  models: [],
  keys: [],
  users: [],
  giftcodes: [],
  transactions: [],
  transactionsTotal: 0,
  analytics: null,
  analyticsDays: 14,
  backupsMeta: { enabled: false, intervalHours: 24, retentionCount: 14 },
  backups: [],
  detailFilters: { fromDate: '', toDate: '', model: 'all', status: 'all' },
  liveFilters: { fromDate: '', toDate: '', model: 'all', status: 'all', q: '' },
  editingUser: null,
  selectedKey: null,
  selectedHistory: [],
  selectedHistoryTotal: 0,
  selectedNextCursor: null,
  loadingMoreHistory: false,
  liveRequests: [],
  liveTotal: 0,
  liveNextCursor: null,
  loadingMoreLive: false,
  liveEnabled: true,
  pollTimer: null,
  pollInFlight: false,
  liveFlashIds: new Set(),
  liveFlashTimer: null,
  detailFlashIds: new Set(),
  detailFlashTimer: null,
  activePage: 'keys',
  modalMode: 'create', // 'create' | 'edit'
  editingKey: null,
  pendingDisableKey: null,
  oneTimeRevealedKey: '',
};

function announce(message) {
  dom.liveStatus.textContent = message;
}

function resetTokenMasking() {
  dom.adminTokenInput.type = 'password';
  dom.toggleAdminToken.textContent = 'Hiện mã';
  dom.toggleAdminToken.setAttribute('aria-pressed', 'false');
  if (dom.adminPasswordInput && dom.toggleAdminPassword) {
    dom.adminPasswordInput.type = 'password';
    dom.toggleAdminPassword.textContent = 'Hiện mật khẩu';
    dom.toggleAdminPassword.setAttribute('aria-pressed', 'false');
  }
}

function abortInFlight() {
  if (state.controller) {
    state.controller.abort();
    state.controller = null;
  }
}

function setGlobalFeedback(message, tone = 'success') {
  if (!message) {
    dom.globalFeedback.classList.add('hidden');
    dom.globalFeedback.textContent = '';
    return;
  }
  dom.globalFeedback.className = `alert alert-${tone}`;
  dom.globalFeedback.textContent = message;
  dom.globalFeedback.classList.remove('hidden');
  announce(message);
}

function setAuthError(message) {
  if (!message) {
    dom.authError.classList.add('hidden');
    dom.authError.textContent = '';
    return;
  }
  dom.authError.textContent = message;
  dom.authError.classList.remove('hidden');
  announce(message);
}

function wipeOneTimeReveal() {
  state.oneTimeRevealedKey = '';
  dom.revealKeyValue.textContent = '';
  dom.revealKeyName.textContent = '';
  dom.copyFeedback.textContent = '';
}

function closeDialogSafe(dialog) {
  if (dialog.open) dialog.close();
}

function logout(reasonMessage = '', { notifyServer = false } = {}) {
  if (notifyServer) {
    fetch('/admin/v1/logout', { method: 'POST', cache: 'no-store', credentials: 'same-origin' }).catch(() => {});
  }
  state.generation += 1;
  abortInFlight();
  state.adminToken = '';
  state.authenticated = false;
  state.models = [];
  state.keys = [];
  state.users = [];
  state.editingUser = null;
  state.selectedKey = null;
  state.selectedHistory = [];
  state.selectedHistoryTotal = 0;
  state.selectedNextCursor = null;
  state.liveRequests = [];
  state.liveTotal = 0;
  state.liveNextCursor = null;
  clearTimeout(state.liveFlashTimer);
  clearTimeout(state.detailFlashTimer);
  state.liveFlashIds.clear();
  state.detailFlashIds.clear();
  state.editingKey = null;
  state.pendingDisableKey = null;
  wipeOneTimeReveal();
  closeDialogSafe(dom.keyModal);
  closeDialogSafe(dom.revealModal);
  closeDialogSafe(dom.disableModal);
  closeDialogSafe(dom.userModal);
  if (dom.giftcodeModal) closeDialogSafe(dom.giftcodeModal);
  state.giftcodes = [];
  state.transactions = [];
  state.backups = [];
  state.analytics = null;

  dom.adminTokenInput.value = '';
  if (dom.adminPasswordInput) dom.adminPasswordInput.value = '';
  resetTokenMasking();
  dom.keysTbody.innerHTML = '';
  dom.usersTbody.innerHTML = '';
  dom.modelsTbody.innerHTML = '';
  dom.detailHistoryTbody.innerHTML = '';
  if (dom.liveRequestsTbody) dom.liveRequestsTbody.innerHTML = '';
  dom.detailSection.classList.add('hidden');
  dom.workspace.classList.add('hidden');
  dom.logoutBtn.classList.add('hidden');
  dom.authSection.classList.remove('hidden');
  setGlobalFeedback('');
  setAuthError(reasonMessage);
  if (dom.adminPasswordInput) dom.adminPasswordInput.focus();
  else dom.adminTokenInput.focus();
}

async function adminFetch(path, { method = 'GET', body, signal } = {}) {
  const headers = {
    Accept: 'application/json',
  };
  if (state.adminToken) {
    headers.Authorization = `Bearer ${state.adminToken}`;
  }
  const init = {
    method,
    cache: 'no-store',
    credentials: 'same-origin',
    headers,
    signal,
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw { network: true, message: 'Không thể kết nối tới API quản trị.' };
  }

  if (response.status === 204) {
    return null;
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const translated = translateApiError(payload, response.status);
    if (response.status === 401 && translated.code === 'admin_required' && state.authenticated) {
      logout(translated.message);
    }
    throw { httpStatus: response.status, ...translated };
  }
  return payload;
}

async function adminDownloadFile(path, filename) {
  const headers = {};
  if (state.adminToken) {
    headers.Authorization = `Bearer ${state.adminToken}`;
  }
  const response = await fetch(path, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    headers,
  });
  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const translated = translateApiError(payload, response.status);
    if (response.status === 401 && translated.code === 'admin_required' && state.authenticated) {
      logout(translated.message);
    }
    throw { httpStatus: response.status, ...translated };
  }
  const blob = await response.blob();
  triggerBlobDownload(blob, filename);
}

const VALID_PAGES = new Set(['keys', 'live', 'users', 'analytics', 'giftcodes', 'models']);

function pageFromHash() {
  const h = (window.location.hash || '').replace(/^#/, '').trim().toLowerCase();
  return VALID_PAGES.has(h) ? h : 'keys';
}

function setActivePage(page, { updateHash = true } = {}) {
  const next = VALID_PAGES.has(page) ? page : 'keys';
  state.activePage = next;
  document.querySelectorAll('.admin-nav-tab[data-page]').forEach((btn) => {
    const active = btn.dataset.page === next;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.admin-page[data-page-view]').forEach((view) => {
    view.classList.toggle('hidden', view.dataset.pageView !== next);
  });
  if (updateHash && window.location.hash !== `#${next}`) {
    history.replaceState(null, '', `#${next}`);
  }
}

function renderOverviewStats() {
  const totalKeys = state.keys.length;
  const activeKeys = state.keys.filter((k) => k.status === 'active').length;
  const keyTotalReqs = state.keys.reduce((sum, k) => sum + Number(k.requestCount ?? 0), 0);
  const totalReqs = Math.max(keyTotalReqs, state.liveTotal, state.liveRequests.length);
  const totalSpent = state.keys.reduce((sum, k) => sum + Number(k.usedMicros ?? 0), 0);

  if (dom.ovActiveKeys) dom.ovActiveKeys.textContent = `${formatInteger(activeKeys)} / ${formatInteger(totalKeys)}`;
  if (dom.ovUsers) dom.ovUsers.textContent = formatInteger(state.users.length) ?? '0';
  if (dom.ovRequests) dom.ovRequests.textContent = formatInteger(totalReqs) ?? '0';
  if (dom.ovSpent) dom.ovSpent.textContent = formatMicrosToUsd(totalSpent) ?? '$0.00';

  if (dom.navCountKeys) dom.navCountKeys.textContent = formatInteger(totalKeys) ?? '0';
  if (dom.navCountLive) dom.navCountLive.textContent = formatInteger(totalReqs) ?? '0';
  if (dom.navCountUsers) dom.navCountUsers.textContent = formatInteger(state.users.length) ?? '0';
  if (dom.navCountGiftcodes) dom.navCountGiftcodes.textContent = formatInteger(state.giftcodes.length) ?? '0';
  if (dom.navCountModels) dom.navCountModels.textContent = formatInteger(state.models.length) ?? '0';
}

function populateHistoryModelSelects() {
  for (const selectEl of [dom.detailModelFilter, dom.liveModelFilter]) {
    if (!selectEl) continue;
    const prev = selectEl.value || 'all';
    selectEl.innerHTML = [
      '<option value="all">Tất cả model</option>',
      ...state.models.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.id)}</option>`),
    ].join('');
    if ([...selectEl.options].some((o) => o.value === prev)) {
      selectEl.value = prev;
    }
  }
}

function renderAdminAnalytics() {
  const data = state.analytics;
  if (!data || !dom.admChartBox) return;
  const s = data.summary ?? {};
  if (dom.admAnToday) dom.admAnToday.textContent = formatMicrosToUsd(s.todaySpentMicros ?? 0) ?? '$0.00';
  if (dom.admAnPeriod) dom.admAnPeriod.textContent = formatMicrosToUsd(s.periodSpentMicros ?? 0) ?? '$0.00';
  if (dom.admAnSaved) dom.admAnSaved.textContent = formatMicrosToUsd(s.periodSavedMicros ?? 0) ?? '$0.00';
  if (dom.admAnTopup) dom.admAnTopup.textContent = formatMicrosToUsd(s.periodTopupMicros ?? 0) ?? '$0.00';
  dom.admChartBox.innerHTML = renderDailySpendChartSvg(data.daily);

  const topModels = Array.isArray(data.topModels) ? data.topModels : [];
  if (topModels.length === 0) {
    dom.admTopModelsEmpty?.classList.remove('hidden');
    dom.admTopModelsWrap?.classList.add('hidden');
    if (dom.admTopModelsTbody) dom.admTopModelsTbody.innerHTML = '';
  } else {
    dom.admTopModelsEmpty?.classList.add('hidden');
    dom.admTopModelsWrap?.classList.remove('hidden');
    if (dom.admTopModelsTbody) {
      dom.admTopModelsTbody.innerHTML = topModels
        .map(
          (m) => `
        <tr>
          <td class="mono"><strong>${escapeHtml(m.model)}</strong></td>
          <td class="num">${escapeHtml(formatInteger(m.requests))}</td>
          <td class="num" style="color:#7c3aed; font-weight:700">${escapeHtml(formatMicrosToUsd(m.savedMicros) ?? '$0.00')}</td>
          <td class="num"><strong>${escapeHtml(formatMicrosToUsd(m.spentMicros) ?? '$0.00')}</strong></td>
        </tr>
      `,
        )
        .join('');
    }
  }

  const topUsers = Array.isArray(data.topUsers) ? data.topUsers : [];
  if (topUsers.length === 0) {
    dom.admTopUsersEmpty?.classList.remove('hidden');
    dom.admTopUsersWrap?.classList.add('hidden');
    if (dom.admTopUsersTbody) dom.admTopUsersTbody.innerHTML = '';
  } else {
    dom.admTopUsersEmpty?.classList.add('hidden');
    dom.admTopUsersWrap?.classList.remove('hidden');
    if (dom.admTopUsersTbody) {
      dom.admTopUsersTbody.innerHTML = topUsers
        .map(
          (u) => `
        <tr>
          <td class="mono"><strong>@${escapeHtml(u.username)}</strong></td>
          <td class="num">${escapeHtml(formatInteger(u.requests))}</td>
          <td class="num">${escapeHtml(formatMicrosToUsd(u.remainingMicros) ?? '$0.00')}</td>
          <td class="num"><strong>${escapeHtml(formatMicrosToUsd(u.spentMicros) ?? '$0.00')}</strong></td>
        </tr>
      `,
        )
        .join('');
    }
  }
}

function renderBackupsTable() {
  if (!dom.backupsTbody) return;
  if (dom.backupsPolicyNote) {
    dom.backupsPolicyNote.textContent = state.backupsMeta.enabled
      ? `Tự động sao lưu mỗi ${state.backupsMeta.intervalHours} giờ (lưu tối đa ${state.backupsMeta.retentionCount} bản gần nhất) bằng SQLite VACUUM INTO.`
      : 'Chưa cấu hình thư mục sao lưu cố định trên máy chủ.';
  }
  if (state.backups.length === 0) {
    dom.backupsEmpty?.classList.remove('hidden');
    dom.backupsTableWrap?.classList.add('hidden');
    dom.backupsTbody.innerHTML = '';
    return;
  }
  dom.backupsEmpty?.classList.add('hidden');
  dom.backupsTableWrap?.classList.remove('hidden');
  dom.backupsTbody.innerHTML = state.backups
    .map(
      (b) => `
    <tr>
      <td class="mono"><strong>${escapeHtml(b.filename)}</strong></td>
      <td class="num">${escapeHtml(formatBytes(b.sizeBytes))}</td>
      <td class="num">${renderNullableValue(formatVnDateTime(b.createdAt))}</td>
      <td>
        <div class="row-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-backup-download="${escapeHtml(b.filename)}">Tải về .sqlite</button>
          <button type="button" class="btn btn-danger-outline btn-sm" data-backup-delete="${escapeHtml(b.filename)}">Xóa</button>
        </div>
      </td>
    </tr>
  `,
    )
    .join('');
}

function renderGiftcodesTable() {
  if (!dom.giftcodesTbody) return;
  if (state.giftcodes.length === 0) {
    dom.giftcodesEmpty?.classList.remove('hidden');
    dom.giftcodesTableWrap?.classList.add('hidden');
    dom.giftcodesTbody.innerHTML = '';
    return;
  }
  dom.giftcodesEmpty?.classList.add('hidden');
  dom.giftcodesTableWrap?.classList.remove('hidden');
  dom.giftcodesTbody.innerHTML = state.giftcodes
    .map((g) => {
      const meta = getGiftcodeStatusMeta(g.status);
      const expiresHtml = g.expiresAt === null
        ? '<span>Không giới hạn</span>'
        : renderNullableValue(formatVnDateTime(g.expiresAt));
      return `
      <tr>
        <td>
          <div class="key-prefix-row">
            <strong class="mono">${escapeHtml(g.code)}</strong>
            <button type="button" class="btn-copy-inline" data-copy-gc="${escapeHtml(g.code)}">Sao chép</button>
          </div>
        </td>
        <td class="num"><strong style="color:#047857">${escapeHtml(formatMicrosToUsd(g.amountMicros) ?? '$0.00')}</strong></td>
        <td><span class="badge badge-${meta.tone}">${escapeHtml(meta.label)}</span></td>
        <td class="num">${escapeHtml(formatInteger(g.usedCount))} / ${escapeHtml(formatInteger(g.maxUses))}</td>
        <td class="num">${expiresHtml}</td>
        <td>${escapeHtml(g.note ?? '—')}</td>
        <td>
          ${
            g.enabled
              ? `<button type="button" class="btn btn-danger-outline btn-sm" data-gc-toggle="${escapeHtml(g.id)}" data-gc-next="false">Tắt mã</button>`
              : `<button type="button" class="btn btn-primary btn-sm" data-gc-toggle="${escapeHtml(g.id)}" data-gc-next="true">Mở lại</button>`
          }
        </td>
      </tr>
    `;
    })
    .join('');
}

function renderLedgerTable() {
  if (!dom.ledgerTbody) return;
  const total = Math.max(state.transactions.length, state.transactionsTotal);
  if (dom.ledgerCount) dom.ledgerCount.textContent = `${formatInteger(total) ?? '0'} giao dịch`;
  if (state.transactions.length === 0) {
    dom.ledgerEmpty?.classList.remove('hidden');
    dom.ledgerTableWrap?.classList.add('hidden');
    dom.ledgerTbody.innerHTML = '';
    return;
  }
  dom.ledgerEmpty?.classList.add('hidden');
  dom.ledgerTableWrap?.classList.remove('hidden');
  dom.ledgerTbody.innerHTML = state.transactions
    .map((tx) => {
      const meta = getTransactionTypeMeta(tx.type);
      const pos = tx.deltaMicros >= 0;
      const sign = pos ? '+' : '';
      return `
      <tr>
        <td class="num">${renderNullableValue(formatVnDateTime(tx.createdAt))}</td>
        <td class="mono"><strong>@${escapeHtml(tx.username ?? 'unknown')}</strong></td>
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

function hasActiveFilter(filters) {
  return Boolean(
    filters.fromDate
    || filters.toDate
    || (filters.model && filters.model !== 'all')
    || (filters.status && filters.status !== 'all')
    || (filters.q && filters.q.trim()),
  );
}

function renderModelsTable() {
  const query = (dom.modelsSearch?.value ?? '').trim().toLowerCase();
  const filtered = query
    ? state.models.filter((m) => m.id.toLowerCase().includes(query))
    : state.models;
  dom.modelsCount.textContent = query
    ? `${filtered.length} / ${state.models.length} model`
    : `${state.models.length} model`;
  dom.modelsTbody.innerHTML = filtered
    .map(
      (model) => {
        const cachedRate = model.cachedInputMicrosPerMillion ?? Math.round((model.inputMicrosPerMillion ?? 0) * 0.25);
        return `
      <tr>
        <td class="mono"><strong>${escapeHtml(model.id)}</strong></td>
        <td class="num">${escapeHtml(formatMicrosToUsd(model.inputMicrosPerMillion) ?? '—')}</td>
        <td class="num"><strong style="color: #059669">${escapeHtml(formatMicrosToUsd(cachedRate) ?? '—')}</strong></td>
        <td class="num">${escapeHtml(formatMicrosToUsd(model.outputMicrosPerMillion) ?? '—')}</td>
        <td class="num">${escapeHtml(formatInteger(model.maxInputTokens) ?? '—')}</td>
        <td class="num">${escapeHtml(formatInteger(model.maxOutputTokens) ?? '—')}</td>
        <td class="mono">${escapeHtml(model.chatOutputLimitField ?? 'max_tokens')}</td>
      </tr>
    `;
      },
    )
    .join('');
}

function renderModelsAccessHtml(models) {
  if (models === null) {
    return '<span class="badge badge-info">Tất cả model được cấu hình</span>';
  }
  if (Array.isArray(models) && models.length === 0) {
    return '<span class="badge badge-warning">Không cấp quyền model nào</span>';
  }
  return `<div class="model-chips">${models
    .map((id) => `<span class="model-chip">${escapeHtml(id)}</span>`)
    .join('')}</div>`;
}

function renderKeysTable() {
  const query = (dom.keysSearch?.value ?? '').trim().toLowerCase();
  const statusFilter = dom.keysStatusFilter?.value ?? 'all';
  const filtered = state.keys.filter((key) => {
    if (statusFilter !== 'all' && key.status !== statusFilter) return false;
    if (!query) return true;
    const hay = `${key.name ?? ''} ${key.keyPrefix ?? ''} ${key.username ?? ''} ${key.id ?? ''}`.toLowerCase();
    return hay.includes(query);
  });

  if (filtered.length === 0) {
    dom.keysEmpty.classList.remove('hidden');
    dom.keysTableWrap.classList.add('hidden');
    dom.keysTbody.innerHTML = '';
    return;
  }

  dom.keysEmpty.classList.add('hidden');
  dom.keysTableWrap.classList.remove('hidden');

  dom.keysTbody.innerHTML = filtered
    .map((key) => {
      const statusMeta = getKeyStatusMeta(key.status);
      const selected = state.selectedKey && state.selectedKey.id === key.id;
      const expiresHtml =
        key.expiresAt === null
          ? '<span>Không đặt hạn dùng</span>'
          : renderNullableValue(formatVnDateTime(key.expiresAt));
      const ownerBadge = key.username
        ? ` <span class="badge badge-neutral mono">@${escapeHtml(key.username)}</span>`
        : '';
      const copyBtn = key.canCopy
        ? `<button type="button" class="btn-copy-inline" data-action="copy" data-id="${escapeHtml(key.id)}" title="Sao chép khóa đầy đủ">Sao chép</button>`
        : '';
      const ownerDisabled = Boolean(key.sharedWallet && key.accountEnabled === false);
      const isKeyEnabled = Boolean(key.keyEnabled ?? key.enabled);
      const statusHtml = ownerDisabled
        ? `<span class="badge badge-danger">Tài khoản bị khóa</span><span class="sub-line">Mở lại ở tab Tài khoản</span>`
        : `<span class="badge badge-${statusMeta.tone}">${escapeHtml(statusMeta.label)}</span>`;
      const toggleBtnHtml = ownerDisabled
        ? `<button type="button" class="btn btn-secondary btn-sm" data-action="open-owner" data-id="${escapeHtml(key.id)}" title="Tài khoản chủ sở hữu đang bị vô hiệu hóa">Mở khóa TK</button>`
        : isKeyEnabled
          ? `<button type="button" class="btn btn-danger-outline btn-sm" data-action="disable" data-id="${escapeHtml(key.id)}">Vô hiệu hóa</button>`
          : `<button type="button" class="btn btn-primary btn-sm" data-action="enable" data-id="${escapeHtml(key.id)}">Bật lại</button>`;
      return `
        <tr class="${selected ? 'selected-row' : ''}" data-key-id="${escapeHtml(key.id)}">
          <td>
            <div><strong>${escapeHtml(key.name)}</strong>${ownerBadge}</div>
            <div class="key-prefix-row">
              <span class="mono" style="color: var(--ink-secondary)">${escapeHtml(key.keyPrefix)}•••</span>
              ${copyBtn}
            </div>
          </td>
          <td>${statusHtml}</td>
          <td class="num">
            <div>Hạn mức: <strong>${escapeHtml(formatMicrosToUsd(key.quotaMicros))}</strong></div>
            <span class="sub-line">
              Đã dùng: ${escapeHtml(formatMicrosToUsd(key.usedMicros))} ·
              Giữ chỗ: ${escapeHtml(formatMicrosToUsd(key.reservedMicros))} ·
              Còn lại: <strong>${escapeHtml(formatMicrosToUsd(key.remainingMicros))}</strong>
            </span>
          </td>
          <td class="num"><strong>${escapeHtml(formatInteger(key.requestCount) ?? '0')}</strong></td>
          <td class="num">${expiresHtml}</td>
          <td>${escapeHtml(formatModelsSummary(key.models))}</td>
          <td>
            <div class="row-actions">
              <button type="button" class="btn btn-secondary btn-sm" data-action="view" data-id="${escapeHtml(key.id)}">Chi tiết</button>
              <button type="button" class="btn btn-secondary btn-sm" data-action="edit" data-id="${escapeHtml(key.id)}">Sửa</button>
              ${toggleBtnHtml}
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

function renderRequestRow(item, { showKey = false, flashSet = null } = {}) {
  const statusMeta = getRequestStatusMeta(item.status);
  const created = formatVnDateTime(item.createdAt);
  const finished = formatVnDateTime(item.finishedAt);
  const httpStatusHtml =
    item.httpStatus === null || item.httpStatus === undefined
      ? renderNullableValue(null, 'Chưa có mã HTTP')
      : `<span class="mono">HTTP ${escapeHtml(item.httpStatus)}</span>`;
  const inputTokens = formatInteger(item.inputTokens);
  const outputTokens = formatInteger(item.outputTokens);
  const cachedTokens = item.cachedTokens > 0 ? formatInteger(item.cachedTokens) : null;
  const inputCost = formatMicrosToUsd(item.inputCostMicros);
  const outputCost = formatMicrosToUsd(item.outputCostMicros);
  const charged = formatMicrosToUsd(item.chargedMicros);
  const capped = isChargeCappedByReservation(item);
  const flashClass = flashSet && flashSet.has(item.id) ? 'row-new' : '';
  const keyCol = showKey
    ? `<td>
        <button type="button" class="key-link-btn" data-open-key-id="${escapeHtml(item.keyId)}">${escapeHtml(item.keyName ?? 'Không rõ')}</button>
        <span class="sub-line mono">${escapeHtml(item.keyPrefix ?? '')}•••${item.username ? ` · @${escapeHtml(item.username)}` : ''}</span>
      </td>`
    : '';

  return `
    <tr class="${flashClass}">
      <td class="num">
        <div>${renderNullableValue(created)}</div>
        <span class="sub-line">Xong: ${renderNullableValue(finished)}</span>
      </td>
      ${keyCol}
      <td>
        <div class="mono">${escapeHtml(item.model)}</div>
        <span class="sub-line mono">${escapeHtml(item.endpoint)}</span>
      </td>
      <td>
        <div class="badge-stack">
          <span class="badge badge-${statusMeta.tone}">${escapeHtml(statusMeta.label)}</span>
          ${item.estimated ? '<span class="badge badge-warning">Ước tính</span>' : ''}
        </div>
        <span class="sub-line">${httpStatusHtml}</span>
      </td>
      <td class="num">
        <div>${renderNullableValue(inputCost)}</div>
        <span class="sub-line">${inputTokens !== null ? `${escapeHtml(inputTokens)} token` : renderNullableValue(null)}</span>
        ${cachedTokens ? `<span class="sub-line" style="color: #059669; font-weight: 700">Cache: ${escapeHtml(cachedTokens)} tok (-75%)</span>` : ''}
      </td>
      <td class="num">
        <div>${renderNullableValue(outputCost)}</div>
        <span class="sub-line">${outputTokens !== null ? `${escapeHtml(outputTokens)} token` : renderNullableValue(null)}</span>
      </td>
      <td class="num">
        <strong>${renderNullableValue(charged)}</strong>
        ${
          capped
            ? '<div class="cap-note">Tổng chi phí đầu vào + đầu ra khác khoản đã trừ do số tiền trừ có thể bị giới hạn bởi khoản giữ chỗ.</div>'
            : ''
        }
      </td>
    </tr>
  `;
}

function renderSelectedDetail() {
  const key = state.selectedKey;
  if (!key) {
    dom.detailSection.classList.add('hidden');
    return;
  }
  dom.detailSection.classList.remove('hidden');
  dom.detailHeading.textContent = `Chi tiết khóa: ${key.name}${key.username ? ` (@${key.username})` : ''}`;
  dom.detailPrefix.textContent = `${key.keyPrefix}••• (ID: ${key.id})`;

  const statusMeta = getKeyStatusMeta(key.status);
  const ownerDisabled = Boolean(key.sharedWallet && key.accountEnabled === false);
  const isKeyEnabled = Boolean(key.keyEnabled ?? key.enabled);
  dom.detailStatusBadge.textContent = ownerDisabled ? 'Tài khoản bị khóa' : statusMeta.label;
  dom.detailStatusBadge.className = `badge badge-${ownerDisabled ? 'danger' : statusMeta.tone}`;

  if (dom.detailCopyKeyBtn) {
    dom.detailCopyKeyBtn.classList.toggle('hidden', !key.canCopy);
  }

  if (ownerDisabled) {
    dom.detailToggleEnabledBtn.textContent = `Mở khóa @${key.username ?? 'tài khoản'}`;
    dom.detailToggleEnabledBtn.className = 'btn btn-secondary btn-sm';
  } else {
    dom.detailToggleEnabledBtn.textContent = isKeyEnabled ? 'Vô hiệu hóa khóa' : 'Bật lại khóa';
    dom.detailToggleEnabledBtn.className = isKeyEnabled
      ? 'btn btn-danger-outline btn-sm'
      : 'btn btn-primary btn-sm';
  }

  dom.detailQuota.textContent = formatMicrosToUsd(key.quotaMicros) ?? 'Chưa có dữ liệu';
  dom.detailUsed.textContent = formatMicrosToUsd(key.usedMicros) ?? 'Chưa có dữ liệu';
  dom.detailReserved.textContent = formatMicrosToUsd(key.reservedMicros) ?? 'Chưa có dữ liệu';
  dom.detailRemaining.textContent = formatMicrosToUsd(key.remainingMicros) ?? 'Chưa có dữ liệu';

  dom.detailRequests.textContent = formatInteger(key.requestCount) ?? '0';
  dom.detailCreated.innerHTML = renderNullableValue(formatVnDateTime(key.createdAt));
  dom.detailExpires.innerHTML =
    key.expiresAt === null
      ? '<span>Không đặt hạn dùng</span>'
      : renderNullableValue(formatVnDateTime(key.expiresAt));
  dom.detailModels.innerHTML = renderModelsAccessHtml(key.models);

  const historyTotal = hasActiveFilter(state.detailFilters)
    ? Math.max(state.selectedHistory.length, state.selectedHistoryTotal)
    : Math.max(state.selectedHistory.length, state.selectedHistoryTotal, Number(key.requestCount ?? 0));
  dom.detailHistoryCount.textContent = formatLoadedCount(state.selectedHistory.length, historyTotal);
  if (state.selectedHistory.length === 0) {
    dom.detailHistoryEmpty.classList.remove('hidden');
    dom.detailHistoryTableWrap.classList.add('hidden');
    dom.detailHistoryTbody.innerHTML = '';
  } else {
    dom.detailHistoryEmpty.classList.add('hidden');
    dom.detailHistoryTableWrap.classList.remove('hidden');
    dom.detailHistoryTbody.innerHTML = state.selectedHistory
      .map((item) => renderRequestRow(item, { showKey: false, flashSet: state.detailFlashIds }))
      .join('');
  }

  if (state.selectedNextCursor !== null) {
    dom.detailLoadMoreWrap.classList.remove('hidden');
    dom.detailLoadMoreBtn.disabled = state.loadingMoreHistory;
    dom.detailLoadMoreBtn.textContent = state.loadingMoreHistory ? 'Đang tải thêm...' : 'Tải thêm';
  } else {
    dom.detailLoadMoreWrap.classList.add('hidden');
  }
}

function renderLiveRequests() {
  if (!dom.liveRequestsTbody) return;
  const filtered = state.liveRequests;
  const isFiltered = hasActiveFilter(state.liveFilters);
  const keyTotalReqs = state.keys.reduce((sum, k) => sum + Number(k.requestCount ?? 0), 0);
  const totalReqs = isFiltered
    ? Math.max(state.liveTotal, filtered.length)
    : Math.max(keyTotalReqs, state.liveTotal, filtered.length);
  dom.liveRequestsCount.textContent = formatLoadedCount(filtered.length, totalReqs);
  if (filtered.length === 0) {
    dom.liveRequestsEmpty.classList.remove('hidden');
    dom.liveRequestsTableWrap.classList.add('hidden');
    dom.liveRequestsTbody.innerHTML = '';
  } else {
    dom.liveRequestsEmpty.classList.add('hidden');
    dom.liveRequestsTableWrap.classList.remove('hidden');
    dom.liveRequestsTbody.innerHTML = filtered
      .map((item) => renderRequestRow(item, { showKey: true, flashSet: state.liveFlashIds }))
      .join('');
  }

  if (state.liveNextCursor !== null) {
    dom.liveLoadMoreWrap.classList.remove('hidden');
    dom.liveLoadMoreBtn.disabled = state.loadingMoreLive;
    dom.liveLoadMoreBtn.textContent = state.loadingMoreLive ? 'Đang tải thêm...' : 'Tải thêm';
  } else {
    dom.liveLoadMoreWrap.classList.add('hidden');
  }
}

async function copyAdminKeySecret(keyId, triggerBtn) {
  if (!keyId) return;
  const originalText = triggerBtn ? triggerBtn.textContent : '';
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.textContent = 'Đang lấy...';
  }
  try {
    const data = await adminFetch(`/admin/v1/keys/${encodeURIComponent(keyId)}/secret`);
    if (!data?.key) throw new Error('Không lấy được khóa.');
    await navigator.clipboard.writeText(data.key);
    if (triggerBtn) {
      triggerBtn.textContent = 'Đã chép ✓';
      setTimeout(() => {
        triggerBtn.textContent = originalText;
      }, 1500);
    }
    announce('Đã sao chép khóa API vào clipboard.');
  } catch (error) {
    if (error?.name !== 'AbortError' && state.authenticated) {
      setGlobalFeedback(error.message ?? 'Không thể sao chép khóa này.', 'warning');
    }
    if (triggerBtn) triggerBtn.textContent = originalText;
  } finally {
    if (triggerBtn) triggerBtn.disabled = false;
  }
}

function renderUsersTable() {
  const query = (dom.usersSearch?.value ?? '').trim().toLowerCase();
  const filtered = query
    ? state.users.filter((u) => `${u.username ?? ''} ${u.email ?? ''}`.toLowerCase().includes(query))
    : state.users;

  dom.usersCount.textContent = query
    ? `${filtered.length} / ${state.users.length} tài khoản`
    : `${state.users.length} tài khoản`;
  if (filtered.length === 0) {
    dom.usersEmpty.classList.remove('hidden');
    dom.usersTableWrap.classList.add('hidden');
    dom.usersTbody.innerHTML = '';
    return;
  }
  dom.usersEmpty.classList.add('hidden');
  dom.usersTableWrap.classList.remove('hidden');
  dom.usersTbody.innerHTML = filtered
    .map((u) => {
      const remaining = u.remainingMicros ?? Math.max(0, u.quotaMicros - u.usedMicros - u.reservedMicros);
      return `
      <tr>
        <td>
          <strong>@${escapeHtml(u.username)}</strong>
          <span class="sub-line mono">${escapeHtml(u.email)}</span>
        </td>
        <td>
          <span class="badge badge-${u.enabled ? 'success' : 'danger'}">
            ${u.enabled ? 'Đang hoạt động' : 'Đã vô hiệu hóa'}
          </span>
        </td>
        <td class="num">
          <div>Hạn mức: <strong>${escapeHtml(formatMicrosToUsd(u.quotaMicros))}</strong></div>
          <span class="sub-line">
            Đã dùng: ${escapeHtml(formatMicrosToUsd(u.usedMicros))} ·
            Còn lại: <strong>${escapeHtml(formatMicrosToUsd(remaining))}</strong>
          </span>
        </td>
        <td class="num">
          <div>${escapeHtml(formatInteger(u.keyCount))}/${escapeHtml(formatInteger(u.maxKeys ?? 5))} khóa</div>
          <span class="sub-line">${escapeHtml(formatInteger(u.requestCount ?? 0))} request</span>
        </td>
        <td class="num">${renderNullableValue(formatVnDateTime(u.createdAt))}</td>
        <td>
          <button type="button" class="btn btn-secondary btn-sm" data-edit-user="${escapeHtml(u.id)}">Nạp / Sửa ví</button>
        </td>
      </tr>
    `;
    })
    .join('');
}

async function loadAdminAnalytics(days = state.analyticsDays) {
  state.analyticsDays = days;
  document.querySelectorAll('.days-pill[data-admin-days]').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.adminDays) === days);
  });
  try {
    state.analytics = await adminFetch(`/admin/v1/analytics?days=${encodeURIComponent(days)}`);
    renderAdminAnalytics();
  } catch {
    // Non-fatal
  }
}

async function loadBackups() {
  try {
    const res = await adminFetch('/admin/v1/backups');
    state.backupsMeta = {
      enabled: Boolean(res?.enabled),
      intervalHours: Number(res?.intervalHours ?? 24),
      retentionCount: Number(res?.retentionCount ?? 14),
    };
    state.backups = Array.isArray(res?.items) ? res.items : [];
    renderBackupsTable();
  } catch {
    // Non-fatal
  }
}

async function reloadLiveRequests() {
  const qs = buildRequestFilterParams({ limit: PAGE_LIMIT, ...state.liveFilters });
  const liveRes = await adminFetch(`/admin/v1/requests?${qs}`);
  state.liveRequests = Array.isArray(liveRes?.items) ? liveRes.items : [];
  state.liveTotal = Number.isSafeInteger(liveRes?.total) ? liveRes.total : state.liveRequests.length;
  state.liveNextCursor = liveRes?.nextCursor ?? null;
  renderLiveRequests();
}

async function loadOverview({ keepSelected = true } = {}) {
  state.generation += 1;
  const currentGen = state.generation;
  abortInFlight();
  const controller = new AbortController();
  state.controller = controller;
  const liveQs = buildRequestFilterParams({ limit: PAGE_LIMIT, ...state.liveFilters });

  const [modelsRes, keysRes, usersRes, liveRes, analyticsRes, giftcodesRes, ledgerRes, backupsRes] = await Promise.all([
    adminFetch('/admin/v1/models', { signal: controller.signal }),
    adminFetch('/admin/v1/keys', { signal: controller.signal }),
    adminFetch('/admin/v1/users', { signal: controller.signal }).catch(() => ({ items: [] })),
    adminFetch(`/admin/v1/requests?${liveQs}`, { signal: controller.signal }).catch(() => ({ items: [], nextCursor: null })),
    adminFetch(`/admin/v1/analytics?days=${encodeURIComponent(state.analyticsDays)}`, { signal: controller.signal }).catch(() => null),
    adminFetch('/admin/v1/giftcodes', { signal: controller.signal }).catch(() => ({ items: [] })),
    adminFetch('/admin/v1/transactions?limit=50', { signal: controller.signal }).catch(() => ({ items: [], total: 0 })),
    adminFetch('/admin/v1/backups', { signal: controller.signal }).catch(() => ({ enabled: false, items: [] })),
  ]);
  if (currentGen !== state.generation) return;

  state.models = Array.isArray(modelsRes?.items) ? modelsRes.items : [];
  state.keys = Array.isArray(keysRes?.items) ? keysRes.items : [];
  state.users = Array.isArray(usersRes?.items) ? usersRes.items : [];
  state.liveRequests = Array.isArray(liveRes?.items) ? liveRes.items : [];
  state.liveTotal = Number.isSafeInteger(liveRes?.total) ? liveRes.total : state.liveRequests.length;
  state.liveNextCursor = liveRes?.nextCursor ?? null;
  if (analyticsRes) state.analytics = analyticsRes;
  state.giftcodes = Array.isArray(giftcodesRes?.items) ? giftcodesRes.items : [];
  state.transactions = Array.isArray(ledgerRes?.items) ? ledgerRes.items : [];
  state.transactionsTotal = Number.isSafeInteger(ledgerRes?.total) ? ledgerRes.total : state.transactions.length;
  state.backupsMeta = {
    enabled: Boolean(backupsRes?.enabled),
    intervalHours: Number(backupsRes?.intervalHours ?? 24),
    retentionCount: Number(backupsRes?.retentionCount ?? 14),
  };
  state.backups = Array.isArray(backupsRes?.items) ? backupsRes.items : [];

  populateHistoryModelSelects();
  renderOverviewStats();
  renderModelsTable();
  renderKeysTable();
  renderUsersTable();
  renderLiveRequests();
  renderAdminAnalytics();
  renderBackupsTable();
  renderGiftcodesTable();
  renderLedgerTable();

  if (keepSelected && state.selectedKey) {
    const stillExists = state.keys.some((item) => item.id === state.selectedKey.id);
    if (stillExists) {
      await openKeyDetail(state.selectedKey.id);
    } else {
      state.selectedKey = null;
      state.selectedHistory = [];
      state.selectedHistoryTotal = 0;
      state.selectedNextCursor = null;
      renderSelectedDetail();
    }
  }
}

async function loadMoreLiveRequests() {
  if (state.liveNextCursor === null || state.loadingMoreLive) return;
  const currentGen = state.generation;
  const cursor = state.liveNextCursor;
  state.loadingMoreLive = true;
  dom.liveRequestsError.classList.add('hidden');
  renderLiveRequests();

  try {
    const liveQs = buildRequestFilterParams({ limit: PAGE_LIMIT, before: cursor, ...state.liveFilters });
    const page = await adminFetch(`/admin/v1/requests?${liveQs}`);
    if (currentGen !== state.generation) return;
    const incoming = Array.isArray(page?.items) ? page.items : [];
    state.liveRequests = appendRequestPage(state.liveRequests, incoming);
    if (Number.isSafeInteger(page?.total)) state.liveTotal = page.total;
    state.liveNextCursor = page?.nextCursor ?? null;
  } catch (error) {
    if (error?.name === 'AbortError' || !state.authenticated) return;
    dom.liveRequestsError.textContent = error.message ?? 'Không thể tải thêm lịch sử request.';
    dom.liveRequestsError.classList.remove('hidden');
  } finally {
    if (currentGen === state.generation) {
      state.loadingMoreLive = false;
      renderOverviewStats();
      renderLiveRequests();
    }
  }
}

async function openKeyDetail(keyId) {
  const currentGen = state.generation;
  dom.detailHistoryError.classList.add('hidden');

  try {
    const detailQs = buildRequestFilterParams({ limit: PAGE_LIMIT, ...state.detailFilters });
    const [detail, history] = await Promise.all([
      adminFetch(`/admin/v1/keys/${encodeURIComponent(keyId)}`),
      adminFetch(`/admin/v1/keys/${encodeURIComponent(keyId)}/requests?${detailQs}`),
    ]);
    if (currentGen !== state.generation) return;
    state.selectedKey = detail;
    state.selectedHistory = Array.isArray(history?.items) ? history.items : [];
    state.selectedHistoryTotal = Number.isSafeInteger(history?.total) ? history.total : state.selectedHistory.length;
    state.selectedNextCursor = history?.nextCursor ?? null;
    renderKeysTable();
    renderSelectedDetail();
  } catch (error) {
    if (error?.name === 'AbortError' || !state.authenticated) return;
    setGlobalFeedback(error.message ?? 'Không thể tải chi tiết khóa.', 'danger');
  }
}

async function loadMoreDetailHistory() {
  if (!state.selectedKey || state.selectedNextCursor === null || state.loadingMoreHistory) return;
  const currentGen = state.generation;
  const keyId = state.selectedKey.id;
  const cursor = state.selectedNextCursor;
  state.loadingMoreHistory = true;
  dom.detailHistoryError.classList.add('hidden');
  renderSelectedDetail();

  try {
    const detailQs = buildRequestFilterParams({ limit: PAGE_LIMIT, before: cursor, ...state.detailFilters });
    const page = await adminFetch(
      `/admin/v1/keys/${encodeURIComponent(keyId)}/requests?${detailQs}`,
    );
    if (currentGen !== state.generation || state.selectedKey?.id !== keyId) return;
    const incoming = Array.isArray(page?.items) ? page.items : [];
    state.selectedHistory = appendRequestPage(state.selectedHistory, incoming);
    if (Number.isSafeInteger(page?.total)) state.selectedHistoryTotal = page.total;
    state.selectedNextCursor = page?.nextCursor ?? null;
  } catch (error) {
    if (error?.name === 'AbortError' || !state.authenticated) return;
    dom.detailHistoryError.textContent = error.message ?? 'Không thể tải thêm lịch sử yêu cầu.';
    dom.detailHistoryError.classList.remove('hidden');
  } finally {
    if (currentGen === state.generation) {
      state.loadingMoreHistory = false;
      renderSelectedDetail();
    }
  }
}

function getSelectedModelScope() {
  const checked = dom.keyModalForm.querySelector('input[name="modelScope"]:checked');
  return checked ? checked.value : 'all';
}

function setModelScope(scope) {
  const radio = dom.keyModalForm.querySelector(`input[name="modelScope"][value="${scope}"]`);
  if (radio) radio.checked = true;
  dom.keyModelChecklist.classList.toggle('hidden', scope !== 'custom');
}

function populateModelChecklist(selectedIds) {
  const selectedSet = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  if (state.models.length === 0) {
    dom.keyModelChecklist.innerHTML = '<p class="field-hint">Chưa có model nào được cấu hình.</p>';
    return;
  }
  dom.keyModelChecklist.innerHTML = state.models
    .map(
      (model) => `
      <label class="checkbox-row">
        <input type="checkbox" name="allowedModels" value="${escapeHtml(model.id)}" ${selectedSet.has(model.id) ? 'checked' : ''} />
        <span class="mono">${escapeHtml(model.id)}</span>
      </label>
    `,
    )
    .join('');
}

function showKeyModalError(message) {
  if (!message) {
    dom.keyModalError.classList.add('hidden');
    dom.keyModalError.textContent = '';
    return;
  }
  dom.keyModalError.textContent = message;
  dom.keyModalError.classList.remove('hidden');
}

function openCreateKeyModal() {
  state.modalMode = 'create';
  state.editingKey = null;
  dom.keyModalTitle.textContent = 'Tạo khóa API mới';
  dom.keyModalSubmit.textContent = 'Tạo khóa';
  dom.keyNameInput.value = '';
  dom.keyQuotaInput.disabled = false;
  dom.keyQuotaInput.value = '5';
  dom.keyQuotaHint.textContent = '1 USD = 1.000.000 micros. Nhập chính xác tới 0.000001 USD.';
  dom.keyNoExpiry.checked = true;
  dom.keyExpiryInput.value = '';
  dom.keyExpiryInputWrap.classList.add('hidden');
  populateModelChecklist([]);
  setModelScope('all');
  dom.keyEnabledField.classList.add('hidden');
  showKeyModalError('');
  dom.keyModal.showModal();
  dom.keyNameInput.focus();
}

function openEditKeyModal(key) {
  state.modalMode = 'edit';
  state.editingKey = key;
  dom.keyModalTitle.textContent = `Chỉnh sửa khóa: ${key.name}`;
  dom.keyModalSubmit.textContent = 'Lưu thay đổi';
  dom.keyNameInput.value = key.name;
  dom.keyQuotaInput.value = formatMicrosInputValue(key.quotaMicros);
  if (key.sharedWallet) {
    dom.keyQuotaInput.disabled = true;
    dom.keyQuotaHint.textContent = `Khóa dùng chung ví tài khoản${key.username ? ` @${key.username}` : ''}. Để nạp hoặc đổi hạn mức USD, hãy vào tab Tài khoản → Sửa ví.`;
  } else {
    dom.keyQuotaInput.disabled = false;
    const floorMicros = key.usedMicros + key.reservedMicros;
    dom.keyQuotaHint.textContent = `Tối thiểu hiện tại (đã dùng + đang giữ chỗ): ${formatMicrosToUsd(floorMicros)}.`;
  }

  if (key.expiresAt === null) {
    dom.keyNoExpiry.checked = true;
    dom.keyExpiryInput.value = '';
    dom.keyExpiryInputWrap.classList.add('hidden');
  } else {
    dom.keyNoExpiry.checked = false;
    dom.keyExpiryInput.value = isoUtcToVnInput(key.expiresAt);
    dom.keyExpiryInputWrap.classList.remove('hidden');
  }

  populateModelChecklist(key.models);
  setModelScope(key.models === null ? 'all' : 'custom');
  dom.keyEnabledField.classList.remove('hidden');
  dom.keyEnabledInput.checked = Boolean(key.keyEnabled ?? key.enabled);
  showKeyModalError('');
  dom.keyModal.showModal();
  dom.keyNameInput.focus();
}

function sameModels(a, b) {
  if (a === null && b === null) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, idx) => value === sortedB[idx]);
}

async function handleKeyModalSubmit(event) {
  event.preventDefault();
  showKeyModalError('');

  const trimmedName = dom.keyNameInput.value.trim();
  if (!trimmedName || trimmedName.length > 100) {
    showKeyModalError('Tên khóa phải dài từ 1 đến 100 ký tự.');
    dom.keyNameInput.focus();
    return;
  }

  const isEditingSharedWallet = state.modalMode === 'edit' && Boolean(state.editingKey?.sharedWallet);
  let parsedQuota = null;
  if (!isEditingSharedWallet) {
    parsedQuota = parseUsdToMicros(dom.keyQuotaInput.value);
    if (!parsedQuota.ok) {
      showKeyModalError(parsedQuota.error);
      dom.keyQuotaInput.focus();
      return;
    }
  }

  let expiresAt = null;
  if (!dom.keyNoExpiry.checked) {
    if (!dom.keyExpiryInput.value.trim()) {
      showKeyModalError('Vui lòng chọn thời điểm hết hạn (Giờ Việt Nam) hoặc tích "Không đặt hạn dùng".');
      dom.keyExpiryInput.focus();
      return;
    }
    const parsedExpiry = vnInputToIsoUtc(dom.keyExpiryInput.value);
    if (!parsedExpiry.ok) {
      showKeyModalError(parsedExpiry.error);
      dom.keyExpiryInput.focus();
      return;
    }
    expiresAt = parsedExpiry.value;
  }

  const scope = getSelectedModelScope();
  const models =
    scope === 'all'
      ? null
      : [...dom.keyModelChecklist.querySelectorAll('input[name="allowedModels"]:checked')].map((el) => el.value);

  dom.keyModalSubmit.disabled = true;
  try {
    if (state.modalMode === 'create') {
      const created = await adminFetch('/admin/v1/keys', {
        method: 'POST',
        body: {
          name: trimmedName,
          quotaMicros: parsedQuota.micros,
          expiresAt,
          models,
        },
      });
      closeDialogSafe(dom.keyModal);
      state.oneTimeRevealedKey = created.key;
      dom.revealKeyName.textContent = `${created.name} (${created.keyPrefix}•••)`;
      dom.revealKeyValue.textContent = created.key;
      dom.copyFeedback.textContent = '';
      dom.revealModal.showModal();
      setGlobalFeedback(`Đã tạo khóa "${created.name}".`, 'success');
      await loadOverview({ keepSelected: true });
    } else if (state.editingKey) {
      const orig = state.editingKey;
      const patch = {};
      if (trimmedName !== orig.name) patch.name = trimmedName;
      if (!isEditingSharedWallet && parsedQuota.micros !== orig.quotaMicros) patch.quotaMicros = parsedQuota.micros;
      if (expiresAt !== orig.expiresAt) patch.expiresAt = expiresAt;
      if (!sameModels(models, orig.models)) patch.models = models;
      const enabledVal = dom.keyEnabledInput.checked;
      const origKeyEnabled = Boolean(orig.keyEnabled ?? orig.enabled);
      if (enabledVal !== origKeyEnabled) patch.enabled = enabledVal;

      if (Object.keys(patch).length === 0) {
        closeDialogSafe(dom.keyModal);
        setGlobalFeedback('Không có thay đổi nào cần lưu.', 'warning');
        return;
      }

      await adminFetch(`/admin/v1/keys/${encodeURIComponent(orig.id)}`, {
        method: 'PATCH',
        body: patch,
      });
      closeDialogSafe(dom.keyModal);
      setGlobalFeedback(`Đã cập nhật khóa "${trimmedName}".`, 'success');
      await loadOverview({ keepSelected: true });
    }
  } catch (error) {
    if (error?.name === 'AbortError' || !state.authenticated) return;
    if (error.code === 'quota_below_usage' && state.editingKey) {
      const minUsd = formatMicrosToUsd(state.editingKey.usedMicros + state.editingKey.reservedMicros);
      showKeyModalError(`${error.message} Mức tối thiểu hiện tại là ${minUsd}.`);
    } else {
      showKeyModalError(error.message ?? 'Không thể lưu thay đổi khóa.');
    }
  } finally {
    dom.keyModalSubmit.disabled = false;
  }
}

function openDisableModal(key) {
  state.pendingDisableKey = key;
  dom.disableModalMessage.textContent = `Bạn có chắc muốn vô hiệu hóa khóa "${key.name}" (${key.keyPrefix}•••)?`;
  dom.disableModalError.classList.add('hidden');
  dom.disableModalError.textContent = '';
  dom.disableModal.showModal();
  dom.disableModalCancel.focus();
}

async function confirmDisableKey() {
  const key = state.pendingDisableKey;
  if (!key) return;
  dom.disableModalConfirm.disabled = true;
  dom.disableModalError.classList.add('hidden');
  try {
    await adminFetch(`/admin/v1/keys/${encodeURIComponent(key.id)}`, { method: 'DELETE' });
    state.pendingDisableKey = null;
    closeDialogSafe(dom.disableModal);
    setGlobalFeedback(`Đã vô hiệu hóa khóa "${key.name}". Lịch sử sử dụng vẫn được giữ nguyên.`, 'success');
    await loadOverview({ keepSelected: true });
  } catch (error) {
    if (error?.name === 'AbortError' || !state.authenticated) return;
    dom.disableModalError.textContent = error.message ?? 'Không thể vô hiệu hóa khóa.';
    dom.disableModalError.classList.remove('hidden');
  } finally {
    dom.disableModalConfirm.disabled = false;
  }
}

async function enableKey(key) {
  try {
    await adminFetch(`/admin/v1/keys/${encodeURIComponent(key.id)}`, {
      method: 'PATCH',
      body: { enabled: true },
    });
    setGlobalFeedback(`Đã bật lại khóa "${key.name}".`, 'success');
    await loadOverview({ keepSelected: true });
  } catch (error) {
    if (error?.name === 'AbortError' || !state.authenticated) return;
    setGlobalFeedback(error.message ?? 'Không thể bật lại khóa.', 'danger');
  }
}

function showAuthenticatedWorkspace() {
  state.authenticated = true;
  dom.adminTokenInput.value = '';
  if (dom.adminPasswordInput) dom.adminPasswordInput.value = '';
  dom.authSection.classList.add('hidden');
  dom.workspace.classList.remove('hidden');
  dom.logoutBtn.classList.remove('hidden');
  announce('Đăng nhập quản trị thành công.');
}

// Event bindings
if (dom.toggleAdminPassword) {
  dom.toggleAdminPassword.addEventListener('click', () => {
    const showing = dom.adminPasswordInput.type === 'text';
    dom.adminPasswordInput.type = showing ? 'password' : 'text';
    dom.toggleAdminPassword.textContent = showing ? 'Hiện mật khẩu' : 'Ẩn mật khẩu';
    dom.toggleAdminPassword.setAttribute('aria-pressed', String(!showing));
  });
}

if (dom.passwordAuthForm) {
  dom.passwordAuthForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setAuthError('');
    const username = dom.adminUsernameInput.value.trim();
    const password = dom.adminPasswordInput.value;
    if (!username || !password) {
      setAuthError('Vui lòng nhập đầy đủ tên tài khoản và mật khẩu quản trị.');
      return;
    }
    resetTokenMasking();
    state.adminToken = '';
    dom.passwordAuthSubmit.disabled = true;
    try {
      await adminFetch('/admin/v1/login', {
        method: 'POST',
        body: { username, password },
      });
      await loadOverview({ keepSelected: false });
      showAuthenticatedWorkspace();
    } catch (error) {
      if (error?.name !== 'AbortError') {
        state.authenticated = false;
        setAuthError(error.message ?? 'Đăng nhập quản trị thất bại.');
      }
    } finally {
      dom.passwordAuthSubmit.disabled = false;
    }
  });
}

dom.toggleAdminToken.addEventListener('click', () => {
  const showing = dom.adminTokenInput.type === 'text';
  dom.adminTokenInput.type = showing ? 'password' : 'text';
  dom.toggleAdminToken.textContent = showing ? 'Hiện mã' : 'Ẩn mã';
  dom.toggleAdminToken.setAttribute('aria-pressed', String(!showing));
});

dom.adminTokenInput.addEventListener('input', () => {
  if (dom.adminTokenInput.type === 'text') resetTokenMasking();
});

dom.authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setAuthError('');
  const token = dom.adminTokenInput.value.trim();
  if (!token) {
    setAuthError('Vui lòng nhập mã quản trị ADMIN_TOKEN.');
    dom.adminTokenInput.focus();
    return;
  }
  resetTokenMasking();
  state.adminToken = token;
  dom.authSubmitBtn.disabled = true;
  try {
    await loadOverview({ keepSelected: false });
    showAuthenticatedWorkspace();
  } catch (error) {
    if (error?.name !== 'AbortError') {
      state.adminToken = '';
      state.authenticated = false;
      setAuthError(error.message ?? 'Không thể xác thực quản trị viên.');
    }
  } finally {
    dom.authSubmitBtn.disabled = false;
  }
});

dom.logoutBtn.addEventListener('click', () => logout('', { notifyServer: true }));

dom.refreshAllBtn.addEventListener('click', async () => {
  setGlobalFeedback('');
  try {
    await loadOverview({ keepSelected: true });
    announce('Đã làm mới danh sách khóa và model.');
  } catch (error) {
    if (error?.name !== 'AbortError' && state.authenticated) {
      setGlobalFeedback(error.message ?? 'Không thể làm mới dữ liệu.', 'danger');
    }
  }
});

dom.openCreateKeyBtn.addEventListener('click', openCreateKeyModal);

function jumpToOwnerAccount(key) {
  setActivePage('users');
  if (dom.usersSearch && key?.username) {
    dom.usersSearch.value = key.username;
    renderUsersTable();
  }
  setGlobalFeedback(
    `Tài khoản @${key?.username ?? ''} đang bị vô hiệu hóa — hãy bấm "Nạp / Sửa ví" để bật lại tài khoản.`,
    'warning',
  );
}

dom.keysTbody.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const key = state.keys.find((item) => item.id === id);
  if (!key) return;
  if (btn.dataset.action === 'copy') copyAdminKeySecret(id, btn);
  else if (btn.dataset.action === 'view') openKeyDetail(id);
  else if (btn.dataset.action === 'edit') openEditKeyModal(key);
  else if (btn.dataset.action === 'open-owner') jumpToOwnerAccount(key);
  else if (btn.dataset.action === 'disable') openDisableModal(key);
  else if (btn.dataset.action === 'enable') enableKey(key);
});

if (dom.detailCopyKeyBtn) {
  dom.detailCopyKeyBtn.addEventListener('click', () => {
    if (state.selectedKey) copyAdminKeySecret(state.selectedKey.id, dom.detailCopyKeyBtn);
  });
}

if (dom.liveRequestsTbody) {
  dom.liveRequestsTbody.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-open-key-id]');
    if (!btn) return;
    const keyId = btn.dataset.openKeyId;
    if (keyId) {
      setActivePage('keys');
      openKeyDetail(keyId).then(() => {
        dom.detailSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  });
}

if (dom.liveLoadMoreBtn) {
  dom.liveLoadMoreBtn.addEventListener('click', loadMoreLiveRequests);
}

dom.detailEditBtn.addEventListener('click', () => {
  if (state.selectedKey) openEditKeyModal(state.selectedKey);
});

dom.detailToggleEnabledBtn.addEventListener('click', () => {
  if (!state.selectedKey) return;
  if (state.selectedKey.sharedWallet && state.selectedKey.accountEnabled === false) {
    jumpToOwnerAccount(state.selectedKey);
    return;
  }
  if (state.selectedKey.keyEnabled ?? state.selectedKey.enabled) openDisableModal(state.selectedKey);
  else enableKey(state.selectedKey);
});

dom.detailCloseBtn.addEventListener('click', () => {
  state.selectedKey = null;
  state.selectedHistory = [];
  state.selectedHistoryTotal = 0;
  state.selectedNextCursor = null;
  renderKeysTable();
  renderSelectedDetail();
});

dom.detailLoadMoreBtn.addEventListener('click', loadMoreDetailHistory);

dom.keyNoExpiry.addEventListener('change', () => {
  dom.keyExpiryInputWrap.classList.toggle('hidden', dom.keyNoExpiry.checked);
});

dom.keyModalForm.addEventListener('change', (event) => {
  if (event.target.name === 'modelScope') {
    dom.keyModelChecklist.classList.toggle('hidden', event.target.value !== 'custom');
  }
});

dom.keyModalForm.addEventListener('submit', handleKeyModalSubmit);
dom.keyModalCancel.addEventListener('click', () => closeDialogSafe(dom.keyModal));
dom.keyModalCloseX.addEventListener('click', () => closeDialogSafe(dom.keyModal));

dom.copyRevealedKeyBtn.addEventListener('click', async () => {
  if (!state.oneTimeRevealedKey) return;
  try {
    await navigator.clipboard.writeText(state.oneTimeRevealedKey);
    dom.copyFeedback.textContent = 'Đã sao chép khóa vào clipboard.';
  } catch {
    dom.copyFeedback.textContent = 'Trình duyệt chặn tự sao chép — hãy chọn đoạn khóa trong khung đen và bấm Ctrl+C.';
  }
});

dom.closeRevealModalBtn.addEventListener('click', () => {
  wipeOneTimeReveal();
  closeDialogSafe(dom.revealModal);
});

dom.revealModal.addEventListener('close', wipeOneTimeReveal);

dom.disableModalCancel.addEventListener('click', () => {
  state.pendingDisableKey = null;
  closeDialogSafe(dom.disableModal);
});

dom.disableModalConfirm.addEventListener('click', confirmDisableKey);

dom.usersTbody.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-edit-user]');
  if (!btn) return;
  const user = state.users.find((u) => u.id === btn.dataset.editUser);
  if (!user) return;
  state.editingUser = user;
  dom.userModalTitle.textContent = `Cập nhật ví tài khoản @${user.username}`;
  dom.userQuotaInput.value = formatMicrosInputValue(user.quotaMicros);
  const minSpent = user.usedMicros + user.reservedMicros;
  const rem = user.remainingMicros ?? Math.max(0, user.quotaMicros - minSpent);
  dom.userQuotaHint.textContent = `Đã dùng + giữ chỗ: ${formatMicrosToUsd(minSpent)} · Còn lại: ${formatMicrosToUsd(rem)}. Bấm +$1/+$5/+$10 để cộng nhanh.`;
  if (dom.userNoteInput) dom.userNoteInput.value = '';
  if (dom.userResetPwInput) dom.userResetPwInput.value = '';
  dom.userEnabledInput.checked = Boolean(user.enabled);
  dom.userModalError.classList.add('hidden');
  dom.userModalError.textContent = '';
  dom.userModal.showModal();
  dom.userQuotaInput.focus();
});

if (dom.userGenPwBtn && dom.userResetPwInput) {
  dom.userGenPwBtn.addEventListener('click', () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#';
    const bytes = new Uint8Array(14);
    crypto.getRandomValues(bytes);
    let generated = '';
    for (let i = 0; i < bytes.length; i += 1) {
      generated += alphabet[bytes[i] % alphabet.length];
    }
    dom.userResetPwInput.value = generated;
  });
}

if (dom.userResetPwBtn && dom.userResetPwInput) {
  dom.userResetPwBtn.addEventListener('click', async () => {
    if (!state.editingUser) return;
    dom.userModalError.classList.add('hidden');
    const newPassword = dom.userResetPwInput.value;
    if (newPassword.length < 8 || newPassword.length > 128) {
      dom.userModalError.textContent = 'Mật khẩu mới phải dài từ 8 đến 128 ký tự (bấm "Tự sinh" để tạo nhanh).';
      dom.userModalError.classList.remove('hidden');
      dom.userResetPwInput.focus();
      return;
    }
    dom.userResetPwBtn.disabled = true;
    try {
      await adminFetch(`/admin/v1/users/${encodeURIComponent(state.editingUser.id)}/reset-password`, {
        method: 'POST',
        body: { newPassword },
      });
      let copied = '';
      try {
        await navigator.clipboard.writeText(newPassword);
        copied = ' Đã sao chép mật khẩu mới vào clipboard.';
      } catch {
        copied = '';
      }
      setGlobalFeedback(`Đã đặt lại mật khẩu cho @${state.editingUser.username} và đăng xuất mọi phiên cũ.${copied}`, 'success');
      dom.userResetPwInput.value = '';
    } catch (error) {
      if (error?.name === 'AbortError' || !state.authenticated) return;
      dom.userModalError.textContent = error.message ?? 'Không thể đặt lại mật khẩu.';
      dom.userModalError.classList.remove('hidden');
    } finally {
      dom.userResetPwBtn.disabled = false;
    }
  });
}

dom.userModal.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-add-usd]');
  if (!btn) return;
  const deltaMicros = Number(btn.dataset.addUsd) * 1_000_000;
  const parsed = parseUsdToMicros(dom.userQuotaInput.value);
  const currentMicros = parsed.ok ? parsed.micros : (state.editingUser?.quotaMicros ?? 0);
  dom.userQuotaInput.value = formatMicrosInputValue(currentMicros + deltaMicros);
});

dom.userModalForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.editingUser) return;
  dom.userModalError.classList.add('hidden');
  const parsed = parseUsdToMicros(dom.userQuotaInput.value);
  if (!parsed.ok) {
    dom.userModalError.textContent = parsed.error;
    dom.userModalError.classList.remove('hidden');
    return;
  }
  dom.userModalSubmit.disabled = true;
  try {
    const note = dom.userNoteInput?.value?.trim() || null;
    await adminFetch(`/admin/v1/users/${encodeURIComponent(state.editingUser.id)}`, {
      method: 'PATCH',
      body: { quotaMicros: parsed.micros, enabled: dom.userEnabledInput.checked, ...(note ? { note } : {}) },
    });
    const username = state.editingUser.username;
    state.editingUser = null;
    closeDialogSafe(dom.userModal);
    setGlobalFeedback(`Đã cập nhật tài khoản @${username}.`, 'success');
    await loadOverview({ keepSelected: true });
  } catch (error) {
    if (error?.name === 'AbortError' || !state.authenticated) return;
    dom.userModalError.textContent = error.message ?? 'Không thể cập nhật tài khoản.';
    dom.userModalError.classList.remove('hidden');
  } finally {
    dom.userModalSubmit.disabled = false;
  }
});

dom.userModalCancel.addEventListener('click', () => closeDialogSafe(dom.userModal));
dom.userModalCloseX.addEventListener('click', () => closeDialogSafe(dom.userModal));

function updateAdminLiveUi() {
  if (!dom.adminLiveToggle) return;
  dom.adminLiveToggle.setAttribute('aria-pressed', String(state.liveEnabled));
  dom.adminLiveToggle.innerHTML = state.liveEnabled
    ? '<span class="live-dot-pulse" aria-hidden="true"></span><span>Trực tiếp (3s)</span>'
    : '<span class="live-dot-paused" aria-hidden="true"></span><span>Tạm dừng</span>';
}

async function silentPollAdmin() {
  if (!state.authenticated || !state.liveEnabled || state.pollInFlight || document.hidden) return;
  if (dom.keyModal.open || dom.userModal.open || dom.disableModal.open || dom.revealModal.open || dom.giftcodeModal?.open) return;

  const currentGen = state.generation;
  const selectedId = state.selectedKey?.id ?? null;
  const pollLive = !state.loadingMoreLive;
  const pollDetailHist = Boolean(selectedId) && !state.loadingMoreHistory;
  const liveQs = buildRequestFilterParams({ limit: PAGE_LIMIT, ...state.liveFilters });
  const detailQs = buildRequestFilterParams({ limit: PAGE_LIMIT, ...state.detailFilters });
  state.pollInFlight = true;
  try {
    const [keysRes, usersRes, liveRes, detailRes, detailHistRes] = await Promise.all([
      adminFetch('/admin/v1/keys'),
      adminFetch('/admin/v1/users').catch(() => null),
      pollLive ? adminFetch(`/admin/v1/requests?${liveQs}`).catch(() => null) : Promise.resolve(null),
      selectedId ? adminFetch(`/admin/v1/keys/${encodeURIComponent(selectedId)}`).catch(() => null) : Promise.resolve(null),
      pollDetailHist
        ? adminFetch(`/admin/v1/keys/${encodeURIComponent(selectedId)}/requests?${detailQs}`).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (currentGen !== state.generation || !state.authenticated) return;

    if (Array.isArray(keysRes?.items)) {
      state.keys = keysRes.items;
      renderKeysTable();
    }
    if (Array.isArray(usersRes?.items)) {
      state.users = usersRes.items;
      renderUsersTable();
    }
    if (pollLive && !state.loadingMoreLive && Array.isArray(liveRes?.items)) {
      const prevTotal = state.liveTotal;
      const nextTotal = Number.isSafeInteger(liveRes.total) ? liveRes.total : prevTotal;
      const { merged, nextCursor, changed } = mergeRequestPages(state.liveRequests, liveRes.items, {
        pageLimit: PAGE_LIMIT,
        incomingCursor: liveRes.nextCursor ?? null,
        currentCursor: state.liveNextCursor,
      });
      const updated =
        changed.size > 0
        || merged.length !== state.liveRequests.length
        || nextCursor !== state.liveNextCursor
        || nextTotal !== prevTotal;
      if (updated) {
        state.liveRequests = merged;
        state.liveTotal = nextTotal;
        state.liveNextCursor = nextCursor;
        state.liveFlashIds = changed;
        renderLiveRequests();
        clearTimeout(state.liveFlashTimer);
        state.liveFlashTimer = setTimeout(() => {
          state.liveFlashIds.clear();
        }, 1700);
      }
    }
    renderOverviewStats();

    if (selectedId && state.selectedKey?.id === selectedId && detailRes) {
      state.selectedKey = detailRes;
      if (pollDetailHist && !state.loadingMoreHistory && Array.isArray(detailHistRes?.items)) {
        const { merged, nextCursor, changed } = mergeRequestPages(state.selectedHistory, detailHistRes.items, {
          pageLimit: PAGE_LIMIT,
          incomingCursor: detailHistRes.nextCursor ?? null,
          currentCursor: state.selectedNextCursor,
        });
        state.selectedHistory = merged;
        if (Number.isSafeInteger(detailHistRes.total)) state.selectedHistoryTotal = detailHistRes.total;
        state.selectedNextCursor = nextCursor;
        state.detailFlashIds = changed;
        clearTimeout(state.detailFlashTimer);
        state.detailFlashTimer = setTimeout(() => {
          state.detailFlashIds.clear();
        }, 1700);
      }
      renderSelectedDetail();
    }
  } catch {
    // Ignore transient background errors
  } finally {
    state.pollInFlight = false;
  }
}

if (dom.adminLiveToggle) {
  dom.adminLiveToggle.addEventListener('click', () => {
    state.liveEnabled = !state.liveEnabled;
    updateAdminLiveUi();
    if (state.liveEnabled) silentPollAdmin();
  });
}

document.querySelectorAll('.admin-nav-tab[data-page]').forEach((tab) => {
  tab.addEventListener('click', () => setActivePage(tab.dataset.page));
});

window.addEventListener('hashchange', () => {
  setActivePage(pageFromHash(), { updateHash: false });
});

if (dom.keysSearch) dom.keysSearch.addEventListener('input', renderKeysTable);
if (dom.keysStatusFilter) dom.keysStatusFilter.addEventListener('change', renderKeysTable);
if (dom.usersSearch) dom.usersSearch.addEventListener('input', renderUsersTable);
if (dom.modelsSearch) dom.modelsSearch.addEventListener('input', renderModelsTable);

if (dom.detailFilterForm) {
  dom.detailFilterForm.addEventListener('submit', (event) => {
    event.preventDefault();
    state.detailFilters = {
      fromDate: dom.detailFromDate?.value ?? '',
      toDate: dom.detailToDate?.value ?? '',
      model: dom.detailModelFilter?.value ?? 'all',
      status: dom.detailStatusFilter?.value ?? 'all',
    };
    if (state.selectedKey) openKeyDetail(state.selectedKey.id);
  });
}

if (dom.detailFilterReset) {
  dom.detailFilterReset.addEventListener('click', () => {
    if (dom.detailFromDate) dom.detailFromDate.value = '';
    if (dom.detailToDate) dom.detailToDate.value = '';
    if (dom.detailModelFilter) dom.detailModelFilter.value = 'all';
    if (dom.detailStatusFilter) dom.detailStatusFilter.value = 'all';
    state.detailFilters = { fromDate: '', toDate: '', model: 'all', status: 'all' };
    if (state.selectedKey) openKeyDetail(state.selectedKey.id);
  });
}

if (dom.detailExportCsvBtn) {
  dom.detailExportCsvBtn.addEventListener('click', async () => {
    if (!state.selectedKey) return;
    dom.detailExportCsvBtn.disabled = true;
    try {
      const qs = buildRequestFilterParams(state.detailFilters);
      await adminDownloadFile(
        `/admin/v1/keys/${encodeURIComponent(state.selectedKey.id)}/requests.csv${qs ? `?${qs}` : ''}`,
        `tiencoder-${state.selectedKey.keyPrefix}-requests.csv`,
      );
    } catch (error) {
      if (state.authenticated) setGlobalFeedback(error.message ?? 'Không thể xuất file CSV.', 'danger');
    } finally {
      dom.detailExportCsvBtn.disabled = false;
    }
  });
}

if (dom.liveFilterForm) {
  dom.liveFilterForm.addEventListener('submit', (event) => {
    event.preventDefault();
    state.liveFilters = {
      fromDate: dom.liveFromDate?.value ?? '',
      toDate: dom.liveToDate?.value ?? '',
      model: dom.liveModelFilter?.value ?? 'all',
      status: dom.liveStatusFilter?.value ?? 'all',
      q: dom.liveSearch?.value?.trim() ?? '',
    };
    reloadLiveRequests().catch((err) => {
      if (state.authenticated) setGlobalFeedback(err.message ?? 'Không thể lọc lịch sử.', 'danger');
    });
  });
}

if (dom.liveFilterReset) {
  dom.liveFilterReset.addEventListener('click', () => {
    if (dom.liveSearch) dom.liveSearch.value = '';
    if (dom.liveFromDate) dom.liveFromDate.value = '';
    if (dom.liveToDate) dom.liveToDate.value = '';
    if (dom.liveModelFilter) dom.liveModelFilter.value = 'all';
    if (dom.liveStatusFilter) dom.liveStatusFilter.value = 'all';
    state.liveFilters = { fromDate: '', toDate: '', model: 'all', status: 'all', q: '' };
    reloadLiveRequests().catch(() => {});
  });
}

if (dom.liveExportCsvBtn) {
  dom.liveExportCsvBtn.addEventListener('click', async () => {
    dom.liveExportCsvBtn.disabled = true;
    try {
      const qs = buildRequestFilterParams(state.liveFilters);
      await adminDownloadFile(
        `/admin/v1/requests.csv${qs ? `?${qs}` : ''}`,
        'tiencoder-all-requests.csv',
      );
    } catch (error) {
      if (state.authenticated) setGlobalFeedback(error.message ?? 'Không thể xuất file CSV.', 'danger');
    } finally {
      dom.liveExportCsvBtn.disabled = false;
    }
  });
}

document.querySelectorAll('.days-pill[data-admin-days]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const days = Number(btn.dataset.adminDays) || 14;
    loadAdminAnalytics(days);
  });
});

if (dom.createBackupBtn) {
  dom.createBackupBtn.addEventListener('click', async () => {
    dom.createBackupBtn.disabled = true;
    try {
      const created = await adminFetch('/admin/v1/backups', { method: 'POST' });
      setGlobalFeedback(`Đã tạo bản sao lưu SQLite: ${created.filename} (${formatBytes(created.sizeBytes)}).`, 'success');
      await loadBackups();
    } catch (error) {
      if (state.authenticated) setGlobalFeedback(error.message ?? 'Không thể tạo bản sao lưu.', 'danger');
    } finally {
      dom.createBackupBtn.disabled = false;
    }
  });
}

if (dom.backupsTbody) {
  dom.backupsTbody.addEventListener('click', async (event) => {
    const dlBtn = event.target.closest('button[data-backup-download]');
    if (dlBtn) {
      const filename = dlBtn.dataset.backupDownload;
      dlBtn.disabled = true;
      try {
        await adminDownloadFile(`/admin/v1/backups/${encodeURIComponent(filename)}`, filename);
      } catch (error) {
        if (state.authenticated) setGlobalFeedback(error.message ?? 'Không thể tải tệp sao lưu.', 'danger');
      } finally {
        dlBtn.disabled = false;
      }
      return;
    }
    const delBtn = event.target.closest('button[data-backup-delete]');
    if (delBtn) {
      const filename = delBtn.dataset.backupDelete;
      delBtn.disabled = true;
      try {
        await adminFetch(`/admin/v1/backups/${encodeURIComponent(filename)}`, { method: 'DELETE' });
        setGlobalFeedback(`Đã xóa bản sao lưu ${filename}.`, 'success');
        await loadBackups();
      } catch (error) {
        if (state.authenticated) setGlobalFeedback(error.message ?? 'Không thể xóa bản sao lưu.', 'danger');
      } finally {
        delBtn.disabled = false;
      }
    }
  });
}

if (dom.openGiftcodeBtn && dom.giftcodeModal) {
  dom.openGiftcodeBtn.addEventListener('click', () => {
    dom.gcCodeInput.value = '';
    dom.gcAmountInput.value = '5';
    dom.gcMaxUsesInput.value = '1';
    dom.gcNoExpiry.checked = true;
    dom.gcExpiryInput.value = '';
    dom.gcExpiryWrap.classList.add('hidden');
    dom.gcNoteInput.value = '';
    dom.giftcodeModalError.classList.add('hidden');
    dom.giftcodeModal.showModal();
    dom.gcCodeInput.focus();
  });
  dom.gcNoExpiry.addEventListener('change', () => {
    dom.gcExpiryWrap.classList.toggle('hidden', dom.gcNoExpiry.checked);
  });
  dom.giftcodeModal.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-gc-usd]');
    if (btn) dom.gcAmountInput.value = btn.dataset.gcUsd;
  });
  dom.giftcodeModalCancel.addEventListener('click', () => closeDialogSafe(dom.giftcodeModal));
  dom.giftcodeModalCloseX.addEventListener('click', () => closeDialogSafe(dom.giftcodeModal));
  dom.giftcodeModalForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    dom.giftcodeModalError.classList.add('hidden');
    const parsedAmt = parseUsdToMicros(dom.gcAmountInput.value);
    if (!parsedAmt.ok || parsedAmt.micros < 1) {
      dom.giftcodeModalError.textContent = parsedAmt.ok ? 'Giá trị mã nạp phải lớn hơn $0.' : parsedAmt.error;
      dom.giftcodeModalError.classList.remove('hidden');
      return;
    }
    const maxUses = Number(dom.gcMaxUsesInput.value);
    if (!Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > 100_000) {
      dom.giftcodeModalError.textContent = 'Số lượt dùng tối đa phải là số nguyên từ 1 đến 100.000.';
      dom.giftcodeModalError.classList.remove('hidden');
      return;
    }
    let expiresAt = null;
    if (!dom.gcNoExpiry.checked) {
      const parsedExp = vnInputToIsoUtc(dom.gcExpiryInput.value);
      if (!parsedExp.ok || !parsedExp.value) {
        dom.giftcodeModalError.textContent = parsedExp.ok ? 'Vui lòng chọn thời điểm hết hạn.' : parsedExp.error;
        dom.giftcodeModalError.classList.remove('hidden');
        return;
      }
      expiresAt = parsedExp.value;
    }
    dom.giftcodeModalSubmit.disabled = true;
    try {
      const created = await adminFetch('/admin/v1/giftcodes', {
        method: 'POST',
        body: {
          code: dom.gcCodeInput.value.trim(),
          amountMicros: parsedAmt.micros,
          maxUses,
          expiresAt,
          note: dom.gcNoteInput.value.trim() || null,
        },
      });
      closeDialogSafe(dom.giftcodeModal);
      let copied = '';
      try {
        await navigator.clipboard.writeText(created.code);
        copied = ' (đã sao chép mã)';
      } catch {
        copied = '';
      }
      setGlobalFeedback(`Đã tạo mã Giftcode ${created.code} trị giá ${formatMicrosToUsd(created.amountMicros)}${copied}.`, 'success');
      await loadOverview({ keepSelected: true });
    } catch (error) {
      if (state.authenticated) {
        dom.giftcodeModalError.textContent = error.message ?? 'Không thể tạo mã Giftcode.';
        dom.giftcodeModalError.classList.remove('hidden');
      }
    } finally {
      dom.giftcodeModalSubmit.disabled = false;
    }
  });
}

if (dom.giftcodesTbody) {
  dom.giftcodesTbody.addEventListener('click', async (event) => {
    const copyBtn = event.target.closest('button[data-copy-gc]');
    if (copyBtn) {
      const code = copyBtn.dataset.copyGc;
      try {
        await navigator.clipboard.writeText(code);
        copyBtn.textContent = 'Đã chép ✓';
        setTimeout(() => {
          copyBtn.textContent = 'Sao chép';
        }, 1500);
      } catch {
        copyBtn.textContent = 'Ctrl+C';
      }
      return;
    }
    const toggleBtn = event.target.closest('button[data-gc-toggle]');
    if (toggleBtn) {
      const id = toggleBtn.dataset.gcToggle;
      const nextEnabled = toggleBtn.dataset.gcNext === 'true';
      toggleBtn.disabled = true;
      try {
        await adminFetch(`/admin/v1/giftcodes/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: { enabled: nextEnabled },
        });
        setGlobalFeedback(nextEnabled ? 'Đã mở lại mã Giftcode.' : 'Đã tắt mã Giftcode.', 'success');
        await loadOverview({ keepSelected: true });
      } catch (error) {
        if (state.authenticated) setGlobalFeedback(error.message ?? 'Không thể cập nhật mã Giftcode.', 'danger');
      } finally {
        toggleBtn.disabled = false;
      }
    }
  });
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.liveEnabled && state.authenticated) silentPollAdmin();
});

setActivePage(pageFromHash(), { updateHash: false });
updateAdminLiveUi();
state.pollTimer = setInterval(silentPollAdmin, LIVE_INTERVAL_MS);

// Resume active admin cookie session automatically if already signed in
loadOverview({ keepSelected: false })
  .then(() => showAuthenticatedWorkspace())
  .catch(() => {
    // Stay on login screen
  })
  .finally(() => {
    dismissSplash();
  });
