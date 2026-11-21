import {
  escapeHtml,
  formatInteger,
  formatMicrosInputValue,
  formatMicrosToUsd,
  formatModelsSummary,
  formatVnDateTime,
  getKeyStatusMeta,
  getRequestStatusMeta,
  isChargeCappedByReservation,
  isoUtcToVnInput,
  parseUsdToMicros,
  renderNullableValue,
  translateApiError,
  vnInputToIsoUtc,
} from '/admin/assets/format.js';

const PAGE_LIMIT = 25;

const dom = {
  liveStatus: document.getElementById('live-status'),
  logoutBtn: document.getElementById('logout-btn'),
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
  editingUser: null,
  selectedKey: null,
  selectedHistory: [],
  selectedNextCursor: null,
  loadingMoreHistory: false,
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
  state.selectedNextCursor = null;
  state.editingKey = null;
  state.pendingDisableKey = null;
  wipeOneTimeReveal();
  closeDialogSafe(dom.keyModal);
  closeDialogSafe(dom.revealModal);
  closeDialogSafe(dom.disableModal);
  closeDialogSafe(dom.userModal);

  dom.adminTokenInput.value = '';
  if (dom.adminPasswordInput) dom.adminPasswordInput.value = '';
  resetTokenMasking();
  dom.keysTbody.innerHTML = '';
  dom.usersTbody.innerHTML = '';
  dom.modelsTbody.innerHTML = '';
  dom.detailHistoryTbody.innerHTML = '';
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

function renderModelsTable() {
  dom.modelsCount.textContent = `${state.models.length} model`;
  dom.modelsTbody.innerHTML = state.models
    .map(
      (model) => `
      <tr>
        <td class="mono"><strong>${escapeHtml(model.id)}</strong></td>
        <td class="num">${escapeHtml(formatMicrosToUsd(model.inputMicrosPerMillion) ?? '—')}</td>
        <td class="num">${escapeHtml(formatMicrosToUsd(model.outputMicrosPerMillion) ?? '—')}</td>
        <td class="num">${escapeHtml(formatInteger(model.maxInputTokens) ?? '—')}</td>
        <td class="num">${escapeHtml(formatInteger(model.maxOutputTokens) ?? '—')}</td>
        <td class="mono">${escapeHtml(model.chatOutputLimitField ?? 'max_tokens')}</td>
      </tr>
    `,
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
      const statusMeta = getKeyStatusMeta(key.status);
      const selected = state.selectedKey && state.selectedKey.id === key.id;
      const expiresHtml =
        key.expiresAt === null
          ? '<span>Không đặt hạn dùng</span>'
          : renderNullableValue(formatVnDateTime(key.expiresAt));
      return `
        <tr class="${selected ? 'selected-row' : ''}" data-key-id="${escapeHtml(key.id)}">
          <td>
            <strong>${escapeHtml(key.name)}</strong>
            <span class="sub-line mono">${escapeHtml(key.keyPrefix)}•••</span>
          </td>
          <td><span class="badge badge-${statusMeta.tone}">${escapeHtml(statusMeta.label)}</span></td>
          <td class="num">
            <div>Hạn mức: <strong>${escapeHtml(formatMicrosToUsd(key.quotaMicros))}</strong></div>
            <span class="sub-line">
              Đã dùng: ${escapeHtml(formatMicrosToUsd(key.usedMicros))} ·
              Giữ chỗ: ${escapeHtml(formatMicrosToUsd(key.reservedMicros))} ·
              Còn lại: <strong>${escapeHtml(formatMicrosToUsd(key.remainingMicros))}</strong>
            </span>
          </td>
          <td class="num">${escapeHtml(formatInteger(key.requestCount) ?? '0')}</td>
          <td class="num">${expiresHtml}</td>
          <td>${escapeHtml(formatModelsSummary(key.models))}</td>
          <td>
            <div class="row-actions">
              <button type="button" class="btn btn-secondary btn-sm" data-action="view" data-id="${escapeHtml(key.id)}">Chi tiết</button>
              <button type="button" class="btn btn-secondary btn-sm" data-action="edit" data-id="${escapeHtml(key.id)}">Sửa</button>
              ${
                key.enabled
                  ? `<button type="button" class="btn btn-danger-outline btn-sm" data-action="disable" data-id="${escapeHtml(key.id)}">Vô hiệu hóa</button>`
                  : `<button type="button" class="btn btn-primary btn-sm" data-action="enable" data-id="${escapeHtml(key.id)}">Bật lại</button>`
              }
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

function renderRequestRow(item) {
  const statusMeta = getRequestStatusMeta(item.status);
  const created = formatVnDateTime(item.createdAt);
  const finished = formatVnDateTime(item.finishedAt);
  const httpStatusHtml =
    item.httpStatus === null || item.httpStatus === undefined
      ? renderNullableValue(null, 'Chưa có mã HTTP')
      : `<span class="mono">HTTP ${escapeHtml(item.httpStatus)}</span>`;
  const inputTokens = formatInteger(item.inputTokens);
  const outputTokens = formatInteger(item.outputTokens);
  const inputCost = formatMicrosToUsd(item.inputCostMicros);
  const outputCost = formatMicrosToUsd(item.outputCostMicros);
  const charged = formatMicrosToUsd(item.chargedMicros);
  const capped = isChargeCappedByReservation(item);

  return `
    <tr>
      <td class="num">
        <div>${renderNullableValue(created)}</div>
        <span class="sub-line">Xong: ${renderNullableValue(finished)}</span>
      </td>
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
  dom.detailHeading.textContent = `Chi tiết khóa: ${key.name}`;
  dom.detailPrefix.textContent = `${key.keyPrefix}••• (ID: ${key.id})`;

  const statusMeta = getKeyStatusMeta(key.status);
  dom.detailStatusBadge.textContent = statusMeta.label;
  dom.detailStatusBadge.className = `badge badge-${statusMeta.tone}`;

  dom.detailToggleEnabledBtn.textContent = key.enabled ? 'Vô hiệu hóa khóa' : 'Bật lại khóa';
  dom.detailToggleEnabledBtn.className = key.enabled
    ? 'btn btn-danger-outline btn-sm'
    : 'btn btn-primary btn-sm';

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

  dom.detailHistoryCount.textContent = `${state.selectedHistory.length} mục`;
  if (state.selectedHistory.length === 0) {
    dom.detailHistoryEmpty.classList.remove('hidden');
    dom.detailHistoryTableWrap.classList.add('hidden');
    dom.detailHistoryTbody.innerHTML = '';
  } else {
    dom.detailHistoryEmpty.classList.add('hidden');
    dom.detailHistoryTableWrap.classList.remove('hidden');
    dom.detailHistoryTbody.innerHTML = state.selectedHistory.map(renderRequestRow).join('');
  }

  if (state.selectedNextCursor !== null) {
    dom.detailLoadMoreWrap.classList.remove('hidden');
    dom.detailLoadMoreBtn.disabled = state.loadingMoreHistory;
    dom.detailLoadMoreBtn.textContent = state.loadingMoreHistory ? 'Đang tải thêm...' : 'Tải thêm';
  } else {
    dom.detailLoadMoreWrap.classList.add('hidden');
  }
}

function renderUsersTable() {
  dom.usersCount.textContent = `${state.users.length} tài khoản`;
  if (state.users.length === 0) {
    dom.usersEmpty.classList.remove('hidden');
    dom.usersTableWrap.classList.add('hidden');
    dom.usersTbody.innerHTML = '';
    return;
  }
  dom.usersEmpty.classList.add('hidden');
  dom.usersTableWrap.classList.remove('hidden');
  dom.usersTbody.innerHTML = state.users
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

async function loadOverview({ keepSelected = true } = {}) {
  state.generation += 1;
  const currentGen = state.generation;
  abortInFlight();
  const controller = new AbortController();
  state.controller = controller;

  const [modelsRes, keysRes, usersRes] = await Promise.all([
    adminFetch('/admin/v1/models', { signal: controller.signal }),
    adminFetch('/admin/v1/keys', { signal: controller.signal }),
    adminFetch('/admin/v1/users', { signal: controller.signal }).catch(() => ({ items: [] })),
  ]);
  if (currentGen !== state.generation) return;

  state.models = Array.isArray(modelsRes?.items) ? modelsRes.items : [];
  state.keys = Array.isArray(keysRes?.items) ? keysRes.items : [];
  state.users = Array.isArray(usersRes?.items) ? usersRes.items : [];
  renderModelsTable();
  renderKeysTable();
  renderUsersTable();

  if (keepSelected && state.selectedKey) {
    const stillExists = state.keys.some((item) => item.id === state.selectedKey.id);
    if (stillExists) {
      await openKeyDetail(state.selectedKey.id);
    } else {
      state.selectedKey = null;
      state.selectedHistory = [];
      state.selectedNextCursor = null;
      renderSelectedDetail();
    }
  }
}

async function openKeyDetail(keyId) {
  const currentGen = state.generation;
  dom.detailHistoryError.classList.add('hidden');

  try {
    const [detail, history] = await Promise.all([
      adminFetch(`/admin/v1/keys/${encodeURIComponent(keyId)}`),
      adminFetch(`/admin/v1/keys/${encodeURIComponent(keyId)}/requests?limit=${PAGE_LIMIT}`),
    ]);
    if (currentGen !== state.generation) return;
    state.selectedKey = detail;
    state.selectedHistory = Array.isArray(history?.items) ? history.items : [];
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
    const page = await adminFetch(
      `/admin/v1/keys/${encodeURIComponent(keyId)}/requests?limit=${PAGE_LIMIT}&before=${encodeURIComponent(cursor)}`,
    );
    if (currentGen !== state.generation || state.selectedKey?.id !== keyId) return;
    const incoming = Array.isArray(page?.items) ? page.items : [];
    state.selectedHistory = [...state.selectedHistory, ...incoming];
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
  const floorMicros = key.usedMicros + key.reservedMicros;
  dom.keyQuotaHint.textContent = `Tối thiểu hiện tại (đã dùng + đang giữ chỗ): ${formatMicrosToUsd(floorMicros)}.`;

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
  dom.keyEnabledInput.checked = Boolean(key.enabled);
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

  const parsedQuota = parseUsdToMicros(dom.keyQuotaInput.value);
  if (!parsedQuota.ok) {
    showKeyModalError(parsedQuota.error);
    dom.keyQuotaInput.focus();
    return;
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
      if (parsedQuota.micros !== orig.quotaMicros) patch.quotaMicros = parsedQuota.micros;
      if (expiresAt !== orig.expiresAt) patch.expiresAt = expiresAt;
      if (!sameModels(models, orig.models)) patch.models = models;
      const enabledVal = dom.keyEnabledInput.checked;
      if (enabledVal !== orig.enabled) patch.enabled = enabledVal;

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

dom.keysTbody.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const key = state.keys.find((item) => item.id === id);
  if (!key) return;
  if (btn.dataset.action === 'view') openKeyDetail(id);
  else if (btn.dataset.action === 'edit') openEditKeyModal(key);
  else if (btn.dataset.action === 'disable') openDisableModal(key);
  else if (btn.dataset.action === 'enable') enableKey(key);
});

dom.detailEditBtn.addEventListener('click', () => {
  if (state.selectedKey) openEditKeyModal(state.selectedKey);
});

dom.detailToggleEnabledBtn.addEventListener('click', () => {
  if (!state.selectedKey) return;
  if (state.selectedKey.enabled) openDisableModal(state.selectedKey);
  else enableKey(state.selectedKey);
});

dom.detailCloseBtn.addEventListener('click', () => {
  state.selectedKey = null;
  state.selectedHistory = [];
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
  dom.userEnabledInput.checked = Boolean(user.enabled);
  dom.userModalError.classList.add('hidden');
  dom.userModalError.textContent = '';
  dom.userModal.showModal();
  dom.userQuotaInput.focus();
});

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
    await adminFetch(`/admin/v1/users/${encodeURIComponent(state.editingUser.id)}`, {
      method: 'PATCH',
      body: { quotaMicros: parsed.micros, enabled: dom.userEnabledInput.checked },
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

// Resume active admin cookie session automatically if already signed in
loadOverview({ keepSelected: false })
  .then(() => showAuthenticatedWorkspace())
  .catch(() => {
    // Stay on login screen
  });
