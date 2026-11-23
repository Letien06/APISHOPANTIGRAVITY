import {
  appendRequestPage,
  escapeHtml,
  formatInteger,
  formatLoadedCount,
  formatMicrosInputValue,
  formatMicrosToUsd,
  formatModelsSummary,
  formatVnDateTime,
  getKeyStatusMeta,
  getRequestStatusMeta,
  isChargeCappedByReservation,
  isoUtcToVnInput,
  mergeRequestPages,
  parseUsdToMicros,
  renderNullableValue,
  translateApiError,
  vnInputToIsoUtc,
} from '/assets/format.js';

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
};

const state = {
  user: null,
  keys: [],
  models: [],
  selectedKey: null,
  history: [],
  historyTotal: 0,
  nextCursor: null,
  loadingMore: false,
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
  dom.keysLimitNote.textContent = `Đang dùng ${u.keyCount}/${u.maxKeys} khóa · Tất cả khóa dùng chung số dư ví ${formatMicrosToUsd(remainingMicros)}`;
  dom.openCreateBtn.disabled = u.keyCount >= u.maxKeys;
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
  const total = Math.max(state.history.length, state.historyTotal, Number(state.selectedKey.requestCount ?? 0));
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
  if (dom.keyModal.open || dom.revealModal.open || dom.disableModal.open) return;
  state.pollInFlight = true;
  try {
    const selectedId = state.selectedKey?.id ?? null;
    const pollHistory = Boolean(selectedId) && !state.loadingMore;
    const [keysData, latestPage] = await Promise.all([
      apiFetch('/api/console/keys'),
      pollHistory
        ? apiFetch(`/api/console/keys/${encodeURIComponent(selectedId)}/requests?limit=${PAGE_LIMIT}`)
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

async function loadAll() {
  const [keysData, modelsData] = await Promise.all([
    apiFetch('/api/console/keys'),
    apiFetch('/api/public/models'),
  ]);
  state.user = keysData.user;
  state.keys = Array.isArray(keysData.items) ? keysData.items : [];
  state.models = Array.isArray(modelsData.items) ? modelsData.items : [];
  if (state.selectedKey) {
    state.selectedKey = state.keys.find((k) => k.id === state.selectedKey.id) ?? null;
  }
  renderAccount();
  renderModels();
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
  const page = await apiFetch(`/api/console/keys/${encodeURIComponent(key.id)}/requests?limit=${PAGE_LIMIT}`);
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
    const page = await apiFetch(
      `/api/console/keys/${encodeURIComponent(keyId)}/requests?limit=${PAGE_LIMIT}&before=${encodeURIComponent(cursor)}`,
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

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.liveEnabled) silentPollConsole();
});

updateLiveToggleUi();
loadAll()
  .then(() => startConsoleLivePolling())
  .catch((err) => {
    if (!err?.redirected) {
      dom.loading.classList.add('hidden');
      dom.body.classList.remove('hidden');
      setFeedback(err.message ?? 'Không thể tải Console.', 'danger');
    }
  });
