import {
  appendRequestPage,
  escapeHtml,
  formatInteger,
  formatLoadedCount,
  formatMicrosToUsd,
  formatVnDateTime,
  getKeyStatusMeta,
  getRequestStatusMeta,
  isChargeCappedByReservation,
  mergeRequestPages,
  renderNullableValue,
  translateApiError,
} from '/usage/assets/format.js';

const PAGE_LIMIT = 50;

const dom = {
  form: document.getElementById('key-form'),
  keyInput: document.getElementById('api-key-input'),
  toggleBtn: document.getElementById('toggle-key-visibility'),
  submitBtn: document.getElementById('submit-key-btn'),
  refreshBtn: document.getElementById('refresh-btn'),
  clearBtn: document.getElementById('clear-btn'),
  liveStatus: document.getElementById('live-status'),
  loadingBanner: document.getElementById('loading-banner'),
  loadingText: document.getElementById('loading-text'),
  errorBanner: document.getElementById('error-banner'),
  errorTitle: document.getElementById('error-title'),
  errorMessage: document.getElementById('error-message'),
  retryBtn: document.getElementById('retry-btn'),
  emptyKeySection: document.getElementById('empty-key-section'),
  summarySection: document.getElementById('summary-section'),
  summaryHeading: document.getElementById('summary-heading'),
  keyPrefix: document.getElementById('key-prefix'),
  keyStatusBadge: document.getElementById('key-status-badge'),
  keyStatusNotice: document.getElementById('key-status-notice'),
  keyStatusNoticeText: document.getElementById('key-status-notice-text'),
  kpiQuota: document.getElementById('kpi-quota'),
  kpiUsed: document.getElementById('kpi-used'),
  kpiReserved: document.getElementById('kpi-reserved'),
  kpiRemaining: document.getElementById('kpi-remaining'),
  progressPercent: document.getElementById('progress-percent'),
  usageProgressbar: document.getElementById('usage-progressbar'),
  progressUsed: document.getElementById('progress-used'),
  progressReserved: document.getElementById('progress-reserved'),
  metaRequests: document.getElementById('meta-requests'),
  metaCreated: document.getElementById('meta-created'),
  metaExpires: document.getElementById('meta-expires'),
  metaModels: document.getElementById('meta-models'),
  historySection: document.getElementById('history-section'),
  historyCount: document.getElementById('history-count'),
  historyError: document.getElementById('history-error'),
  historyErrorMessage: document.getElementById('history-error-message'),
  retryHistoryBtn: document.getElementById('retry-history-btn'),
  historyEmpty: document.getElementById('history-empty'),
  historyTableWrap: document.getElementById('history-table-wrap'),
  historyTbody: document.getElementById('history-tbody'),
  historyMobileList: document.getElementById('history-mobile-list'),
  loadMoreWrap: document.getElementById('load-more-wrap'),
  loadMoreBtn: document.getElementById('load-more-btn'),
  availableModelsSection: document.getElementById('available-models-section'),
  availableModelsCount: document.getElementById('available-models-count'),
  availableModelsChips: document.getElementById('available-models-chips'),
  navLogin: document.getElementById('usage-nav-login'),
  navUser: document.getElementById('usage-nav-user'),
  navLogout: document.getElementById('usage-nav-logout'),
  liveToggleBtn: document.getElementById('usage-live-toggle'),
  accountKeysPanel: document.getElementById('account-keys-panel'),
  accountKeysPills: document.getElementById('account-keys-pills'),
  accountKeysEmpty: document.getElementById('account-keys-empty'),
  manualKeyDivider: document.getElementById('manual-key-divider'),
};

const LIVE_INTERVAL_MS = 3000;

// Credentials live strictly in tab memory — never written to storage, cookies, or URL.
const state = {
  mode: null, // 'account' | 'key' | null
  activeKey: '',
  activeKeyId: '',
  accountKeys: [],
  generation: 0,
  controller: null,
  summary: null,
  items: [],
  historyTotal: 0,
  nextCursor: null,
  loading: false,
  loadingMore: false,
  lastHistoryCursorAttempt: null,
  publicModelIds: [],
  liveEnabled: true,
  pollTimer: null,
  pollInFlight: false,
  flashIds: new Set(),
  flashTimer: null,
};

function announce(message) {
  dom.liveStatus.textContent = message;
}

function resetKeyMasking() {
  dom.keyInput.type = 'password';
  dom.toggleBtn.textContent = 'Hiện khóa';
  dom.toggleBtn.setAttribute('aria-pressed', 'false');
}

function abortInFlight() {
  if (state.controller) {
    state.controller.abort();
    state.controller = null;
  }
}

function hasActiveTarget() {
  return Boolean((state.mode === 'key' && state.activeKey) || (state.mode === 'account' && state.activeKeyId));
}

function updateActionButtons() {
  const hasInput = Boolean(dom.keyInput.value.trim());
  const hasActive = hasActiveTarget();
  dom.submitBtn.disabled = state.loading;
  dom.refreshBtn.disabled = !hasActive || state.loading || state.loadingMore;
  dom.clearBtn.disabled = !hasInput && !hasActive && !state.summary;
  dom.loadMoreBtn.disabled = state.loading || state.loadingMore || state.nextCursor === null;
}

function setLoading(isLoading, text = 'Đang tải thông tin mức sử dụng...') {
  state.loading = isLoading;
  dom.loadingText.textContent = text;
  dom.loadingBanner.classList.toggle('hidden', !isLoading);
  dom.summarySection.setAttribute('aria-busy', String(isLoading));
  dom.historySection.setAttribute('aria-busy', String(isLoading));
  updateActionButtons();
}

function showError(message, title = 'Không thể tải dữ liệu') {
  dom.errorTitle.textContent = title;
  dom.errorMessage.textContent = message;
  dom.errorBanner.classList.remove('hidden');
  announce(message);
}

function clearError() {
  dom.errorBanner.classList.add('hidden');
  dom.errorMessage.textContent = '';
}

function showHistoryError(message) {
  dom.historyErrorMessage.textContent = message;
  dom.historyError.classList.remove('hidden');
  announce(message);
}

function clearHistoryError() {
  dom.historyError.classList.add('hidden');
  dom.historyErrorMessage.textContent = '';
}

function resetDataView() {
  state.summary = null;
  state.items = [];
  state.historyTotal = 0;
  state.nextCursor = null;
  state.loadingMore = false;
  state.lastHistoryCursorAttempt = null;
  clearTimeout(state.flashTimer);
  state.flashIds.clear();
  dom.summarySection.classList.add('hidden');
  dom.historySection.classList.add('hidden');
  dom.historyTbody.innerHTML = '';
  dom.historyMobileList.innerHTML = '';
  dom.loadMoreWrap.classList.add('hidden');
  clearHistoryError();
}

function clearSession({ clearInput = true } = {}) {
  state.generation += 1;
  abortInFlight();
  state.mode = null;
  state.activeKey = '';
  state.activeKeyId = '';
  renderAccountKeyPills();
  setLoading(false);
  clearError();
  resetDataView();
  if (clearInput) {
    dom.keyInput.value = '';
  }
  resetKeyMasking();
  dom.emptyKeySection.classList.remove('hidden');
  updateActionButtons();
  announce('Đã xóa khóa và dữ liệu hiển thị khỏi phiên hiện tại.');
}

async function fetchAccountJson(url, signal) {
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw {
      network: true,
      message: 'Không thể kết nối tới máy chủ tra cứu. Kiểm tra mạng và thử lại.',
    };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const translated = translateApiError(payload, response.status);
    throw { httpStatus: response.status, ...translated };
  }
  return payload;
}

function renderAccountKeyPills() {
  if (!dom.accountKeysPills || !dom.accountKeysEmpty) return;
  if (state.accountKeys.length === 0) {
    dom.accountKeysPills.innerHTML = '';
    dom.accountKeysEmpty.classList.remove('hidden');
    return;
  }
  dom.accountKeysEmpty.classList.add('hidden');
  dom.accountKeysPills.innerHTML = state.accountKeys
    .map((k) => {
      const isActive = state.mode === 'account' && state.activeKeyId === k.id;
      const dotClass = k.status === 'active' ? '' : k.status === 'disabled' ? 'off' : 'warn';
      return `
        <button
          type="button"
          class="account-key-pill${isActive ? ' active' : ''}"
          data-account-key-id="${escapeHtml(k.id)}"
          aria-pressed="${isActive ? 'true' : 'false'}"
        >
          <span class="pill-dot ${dotClass}" aria-hidden="true"></span>
          <span>${escapeHtml(k.name)}</span>
          <span class="pill-prefix">${escapeHtml(k.keyPrefix)}•••</span>
        </button>
      `;
    })
    .join('');
}

async function fetchJson(url, apiKey, signal) {
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw {
      network: true,
      message: 'Không thể kết nối tới máy chủ tra cứu. Kiểm tra mạng và thử lại.',
    };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const translated = translateApiError(payload, response.status);
    throw { httpStatus: response.status, ...translated };
  }
  return payload;
}

function renderCopyableModelChips(ids) {
  return `<div class="model-chips">${ids
    .map(
      (id) =>
        `<button type="button" class="model-chip" data-copy-model="${escapeHtml(id)}" title="Bấm để sao chép ID model" style="cursor: pointer">${escapeHtml(id)}</button>`,
    )
    .join('')}</div>`;
}

function renderModelsAccess(models) {
  if (models === null) {
    const chipsHtml = state.publicModelIds.length > 0 ? `<div style="margin-top: 8px">${renderCopyableModelChips(state.publicModelIds)}</div>` : '';
    return `<span class="badge badge-info">Tất cả model được cấu hình (${state.publicModelIds.length || 'toàn bộ'})</span>${chipsHtml}`;
  }
  if (Array.isArray(models) && models.length === 0) {
    return '<span class="badge badge-warning">Không cấp quyền model nào</span>';
  }
  return renderCopyableModelChips(models);
}

function renderSummary(summary) {
  dom.emptyKeySection.classList.add('hidden');
  dom.summarySection.classList.remove('hidden');

  dom.summaryHeading.textContent = summary.name;
  dom.keyPrefix.textContent = `${summary.keyPrefix}•••`;

  const statusMeta = getKeyStatusMeta(summary.status);
  dom.keyStatusBadge.textContent = statusMeta.label;
  dom.keyStatusBadge.className = `badge badge-${statusMeta.tone}`;

  if (summary.status === 'expired') {
    dom.keyStatusNoticeText.textContent =
      'Khóa này đã hết hạn dùng nên không thể gọi API suy luận mới, nhưng bạn vẫn xem được hạn mức và lịch sử sử dụng.';
    dom.keyStatusNotice.classList.remove('hidden');
  } else if (summary.status === 'exhausted') {
    dom.keyStatusNoticeText.textContent =
      'Khóa này đã dùng hết hạn mức được cấp. Liên hệ quản trị viên nếu cần gia hạn thêm hạn mức.';
    dom.keyStatusNotice.classList.remove('hidden');
  } else {
    dom.keyStatusNotice.classList.add('hidden');
  }

  dom.kpiQuota.textContent = formatMicrosToUsd(summary.quotaMicros) ?? 'Chưa có dữ liệu';
  dom.kpiUsed.textContent = formatMicrosToUsd(summary.usedMicros) ?? 'Chưa có dữ liệu';
  dom.kpiReserved.textContent = formatMicrosToUsd(summary.reservedMicros) ?? 'Chưa có dữ liệu';
  dom.kpiRemaining.textContent = formatMicrosToUsd(summary.remainingMicros) ?? 'Chưa có dữ liệu';

  const quota = summary.quotaMicros;
  const effectiveUsed = summary.sharedWallet
    ? (summary.accountUsedMicros ?? summary.usedMicros)
    : summary.usedMicros;
  const effectiveReserved = summary.sharedWallet
    ? (summary.accountReservedMicros ?? summary.reservedMicros)
    : summary.reservedMicros;
  let usedPct = 0;
  let reservedPct = 0;
  if (quota > 0) {
    usedPct = Math.min(100, (effectiveUsed / quota) * 100);
    reservedPct = Math.min(100 - usedPct, (effectiveReserved / quota) * 100);
  } else if (effectiveUsed > 0 || effectiveReserved > 0) {
    usedPct = 100;
  }
  const totalPct = Math.min(100, Math.round((usedPct + reservedPct) * 10) / 10);
  dom.progressUsed.style.width = `${usedPct}%`;
  dom.progressReserved.style.width = `${reservedPct}%`;
  dom.progressPercent.textContent = `${totalPct}%`;
  dom.usageProgressbar.setAttribute('aria-valuenow', String(Math.round(totalPct)));

  dom.metaRequests.textContent = formatInteger(summary.requestCount) ?? '0';
  dom.metaCreated.innerHTML = renderNullableValue(formatVnDateTime(summary.createdAt));
  dom.metaExpires.innerHTML =
    summary.expiresAt === null
      ? '<span>Không đặt hạn dùng</span>'
      : renderNullableValue(formatVnDateTime(summary.expiresAt));
  dom.metaModels.innerHTML = renderModelsAccess(summary.models);
}

function renderRequestRowDesktop(item) {
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

  return `
    <tr class="${state.flashIds.has(item.id) ? 'row-new' : ''}">
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

function renderRequestCardMobile(item) {
  const statusMeta = getRequestStatusMeta(item.status);
  const created = formatVnDateTime(item.createdAt);
  const finished = formatVnDateTime(item.finishedAt);
  const inputTokens = formatInteger(item.inputTokens);
  const outputTokens = formatInteger(item.outputTokens);
  const cachedTokens = item.cachedTokens > 0 ? formatInteger(item.cachedTokens) : null;
  const inputCost = formatMicrosToUsd(item.inputCostMicros);
  const outputCost = formatMicrosToUsd(item.outputCostMicros);
  const charged = formatMicrosToUsd(item.chargedMicros);
  const capped = isChargeCappedByReservation(item);

  return `
    <article class="req-card ${state.flashIds.has(item.id) ? 'row-new' : ''}">
      <div class="req-card-head">
        <div>
          <div class="mono"><strong>${escapeHtml(item.model)}</strong></div>
          <div class="sub-line num">${renderNullableValue(created)}</div>
        </div>
        <div class="badge-stack">
          <span class="badge badge-${statusMeta.tone}">${escapeHtml(statusMeta.label)}</span>
          ${item.estimated ? '<span class="badge badge-warning">Ước tính</span>' : ''}
        </div>
      </div>
      <div class="req-card-summary num">
        <div>
          <span class="sub-line">Tổng trừ vào hạn mức</span>
          <strong>${renderNullableValue(charged)}</strong>
        </div>
        <div>
          <span class="sub-line">Mã HTTP</span>
          <span>${item.httpStatus !== null && item.httpStatus !== undefined ? `HTTP ${escapeHtml(item.httpStatus)}` : renderNullableValue(null)}</span>
        </div>
      </div>
      ${
        capped
          ? '<div class="cap-note">Tổng chi phí đầu vào + đầu ra khác khoản đã trừ do số tiền trừ có thể bị giới hạn bởi khoản giữ chỗ.</div>'
          : ''
      }
      <details class="req-details">
        <summary>Chi tiết token, chi phí và endpoint</summary>
        <div class="req-details-body num">
          <div>Endpoint: <span class="mono">${escapeHtml(item.endpoint)}</span></div>
          <div>Hoàn tất (UTC+7): ${renderNullableValue(finished)}</div>
          <div>Đầu vào: ${renderNullableValue(inputCost)} (${inputTokens !== null ? `${escapeHtml(inputTokens)} token` : renderNullableValue(null)}${cachedTokens ? ` · Cache: ${escapeHtml(cachedTokens)} tok` : ''})</div>
          <div>Đầu ra: ${renderNullableValue(outputCost)} (${outputTokens !== null ? `${escapeHtml(outputTokens)} token` : renderNullableValue(null)})</div>
        </div>
      </details>
    </article>
  `;
}

function renderHistory() {
  dom.historySection.classList.remove('hidden');
  const total = Math.max(state.items.length, state.historyTotal, Number(state.summary?.requestCount ?? 0));
  dom.historyCount.textContent = formatLoadedCount(state.items.length, total);

  if (state.items.length === 0) {
    dom.historyEmpty.classList.remove('hidden');
    dom.historyTableWrap.classList.add('hidden');
    dom.historyMobileList.classList.add('hidden');
    dom.loadMoreWrap.classList.add('hidden');
    return;
  }

  dom.historyEmpty.classList.add('hidden');
  dom.historyTableWrap.classList.remove('hidden');
  dom.historyMobileList.classList.remove('hidden');

  dom.historyTbody.innerHTML = state.items.map(renderRequestRowDesktop).join('');
  dom.historyMobileList.innerHTML = state.items.map(renderRequestCardMobile).join('');

  if (state.nextCursor !== null) {
    dom.loadMoreWrap.classList.remove('hidden');
    dom.loadMoreBtn.disabled = state.loadingMore || state.loading;
    dom.loadMoreBtn.textContent = state.loadingMore ? 'Đang tải thêm...' : 'Tải thêm';
  } else {
    dom.loadMoreWrap.classList.add('hidden');
  }
}

async function loadAccountKey(keyId) {
  if (!keyId) return;
  const changed = state.mode !== 'account' || state.activeKeyId !== keyId;
  state.generation += 1;
  const currentGen = state.generation;
  abortInFlight();
  clearError();
  clearHistoryError();

  if (changed) {
    resetDataView();
  }

  state.mode = 'account';
  state.activeKeyId = keyId;
  state.activeKey = '';
  renderAccountKeyPills();

  const controller = new AbortController();
  state.controller = controller;
  setLoading(true, 'Đang tải hạn mức và lịch sử yêu cầu...');

  try {
    const [summary, history] = await Promise.all([
      fetchAccountJson(`/api/console/keys/${encodeURIComponent(keyId)}`, controller.signal),
      fetchAccountJson(`/api/console/keys/${encodeURIComponent(keyId)}/requests?limit=${PAGE_LIMIT}`, controller.signal),
    ]);
    if (currentGen !== state.generation) return;
    state.summary = summary;
    state.items = Array.isArray(history.items) ? history.items : [];
    state.historyTotal = Number.isSafeInteger(history.total) ? history.total : state.items.length;
    state.nextCursor = history.nextCursor ?? null;
    renderSummary(summary);
    renderHistory();
    announce(`Đã tải mức sử dụng cho khóa ${summary.name}.`);
  } catch (error) {
    if (error?.name === 'AbortError' || currentGen !== state.generation) return;
    resetDataView();
    dom.emptyKeySection.classList.add('hidden');
    showError(error.message ?? 'Không thể tải dữ liệu mức sử dụng.');
  } finally {
    if (currentGen === state.generation) {
      state.controller = null;
      setLoading(false);
    }
  }
}

async function loadUsage(apiKey) {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    showError('Vui lòng dán khóa API (bắt đầu bằng gw_) trước khi tra cứu.', 'Chưa nhập khóa');
    dom.keyInput.focus();
    return;
  }

  const keyChanged = state.mode !== 'key' || trimmed !== state.activeKey;
  state.generation += 1;
  const currentGen = state.generation;
  abortInFlight();
  clearError();
  clearHistoryError();

  if (keyChanged) {
    resetKeyMasking();
    resetDataView();
  }

  state.mode = 'key';
  state.activeKey = trimmed;
  state.activeKeyId = '';
  renderAccountKeyPills();

  const controller = new AbortController();
  state.controller = controller;
  setLoading(true, 'Đang tải hạn mức và lịch sử yêu cầu...');

  try {
    const [summary, history] = await Promise.all([
      fetchJson('/api/usage', trimmed, controller.signal),
      fetchJson(`/api/usage/requests?limit=${PAGE_LIMIT}`, trimmed, controller.signal),
    ]);
    if (currentGen !== state.generation) return;
    state.summary = summary;
    state.items = Array.isArray(history.items) ? history.items : [];
    state.historyTotal = Number.isSafeInteger(history.total) ? history.total : state.items.length;
    state.nextCursor = history.nextCursor ?? null;
    renderSummary(summary);
    renderHistory();
    announce(`Đã tải mức sử dụng cho khóa ${summary.name}.`);
  } catch (error) {
    if (error?.name === 'AbortError' || currentGen !== state.generation) return;
    resetDataView();
    dom.emptyKeySection.classList.add('hidden');
    showError(error.message ?? 'Không thể tải dữ liệu mức sử dụng.');
  } finally {
    if (currentGen === state.generation) {
      state.controller = null;
      setLoading(false);
    }
  }
}

async function loadMoreHistory() {
  if (!hasActiveTarget() || state.nextCursor === null || state.loading || state.loadingMore) return;
  const currentGen = state.generation;
  const cursor = state.nextCursor;
  state.lastHistoryCursorAttempt = cursor;
  state.loadingMore = true;
  clearHistoryError();
  renderHistory();
  updateActionButtons();

  const controller = new AbortController();
  state.controller = controller;

  try {
    const page =
      state.mode === 'account'
        ? await fetchAccountJson(
            `/api/console/keys/${encodeURIComponent(state.activeKeyId)}/requests?limit=${PAGE_LIMIT}&before=${encodeURIComponent(cursor)}`,
            controller.signal,
          )
        : await fetchJson(
            `/api/usage/requests?limit=${PAGE_LIMIT}&before=${encodeURIComponent(cursor)}`,
            state.activeKey,
            controller.signal,
          );
    if (currentGen !== state.generation) return;
    const incoming = Array.isArray(page.items) ? page.items : [];
    state.items = appendRequestPage(state.items, incoming);
    if (Number.isSafeInteger(page.total)) state.historyTotal = page.total;
    state.nextCursor = page.nextCursor ?? null;
    state.lastHistoryCursorAttempt = null;
    announce(`Đã tải thêm ${incoming.length} yêu cầu.`);
  } catch (error) {
    if (error?.name === 'AbortError' || currentGen !== state.generation) return;
    showHistoryError(error.message ?? 'Không thể tải thêm lịch sử.');
  } finally {
    if (currentGen === state.generation) {
      state.controller = null;
      state.loadingMore = false;
      renderHistory();
      updateActionButtons();
    }
  }
}

dom.toggleBtn.addEventListener('click', () => {
  const showing = dom.keyInput.type === 'text';
  dom.keyInput.type = showing ? 'password' : 'text';
  dom.toggleBtn.textContent = showing ? 'Hiện khóa' : 'Ẩn khóa';
  dom.toggleBtn.setAttribute('aria-pressed', String(!showing));
});

dom.keyInput.addEventListener('input', () => {
  // Always revert to masked when user changes key, and cancel stale in-flight data.
  if (dom.keyInput.type === 'text') {
    resetKeyMasking();
  }
  const current = dom.keyInput.value.trim();
  if (state.mode === 'key' && state.activeKey && current !== state.activeKey) {
    state.generation += 1;
    abortInFlight();
    state.mode = null;
    state.activeKey = '';
    setLoading(false);
    clearError();
    resetDataView();
    dom.emptyKeySection.classList.remove('hidden');
  }
  updateActionButtons();
});

dom.form.addEventListener('submit', (event) => {
  event.preventDefault();
  loadUsage(dom.keyInput.value);
});

dom.refreshBtn.addEventListener('click', () => {
  if (state.mode === 'account' && state.activeKeyId) {
    loadAccountKey(state.activeKeyId);
  } else if (state.mode === 'key' && state.activeKey) {
    loadUsage(state.activeKey);
  }
});

dom.clearBtn.addEventListener('click', () => {
  clearSession({ clearInput: true });
  dom.keyInput.focus();
});

dom.retryBtn.addEventListener('click', () => {
  if (state.mode === 'account' && state.activeKeyId) {
    loadAccountKey(state.activeKeyId);
    return;
  }
  const keyToRetry = state.activeKey || dom.keyInput.value;
  if (keyToRetry.trim()) {
    loadUsage(keyToRetry);
  }
});

dom.retryHistoryBtn.addEventListener('click', () => {
  if (state.lastHistoryCursorAttempt !== null) {
    loadMoreHistory();
  } else if (state.mode === 'account' && state.activeKeyId) {
    loadAccountKey(state.activeKeyId);
  } else if (state.mode === 'key' && state.activeKey) {
    loadUsage(state.activeKey);
  }
});

dom.loadMoreBtn.addEventListener('click', loadMoreHistory);

if (dom.accountKeysPills) {
  dom.accountKeysPills.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-account-key-id]');
    if (!btn) return;
    const keyId = btn.dataset.accountKeyId;
    if (keyId) {
      loadAccountKey(keyId);
    }
  });
}

document.addEventListener('click', async (event) => {
  const chip = event.target.closest('button[data-copy-model]');
  if (!chip) return;
  const id = chip.dataset.copyModel;
  try {
    await navigator.clipboard.writeText(id);
    chip.textContent = `${id} ✓`;
    setTimeout(() => {
      chip.textContent = id;
    }, 1400);
  } catch {
    // Ignore clipboard rejection
  }
});

async function loadPublicModelsCatalog() {
  try {
    const res = await fetch('/api/public/models', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const ids = Array.isArray(data?.items) ? data.items.map((m) => m.id).filter(Boolean) : [];
    if (ids.length === 0) return;
    state.publicModelIds = ids;
    if (dom.availableModelsSection && dom.availableModelsChips && dom.availableModelsCount) {
      dom.availableModelsCount.textContent = `${ids.length} model`;
      dom.availableModelsChips.innerHTML = ids
        .map(
          (id) =>
            `<button type="button" class="model-chip" data-copy-model="${escapeHtml(id)}" title="Bấm để sao chép ID model" style="cursor: pointer">${escapeHtml(id)}</button>`,
        )
        .join('');
      dom.availableModelsSection.classList.remove('hidden');
    }
    if (state.summary && state.summary.models === null) {
      dom.metaModels.innerHTML = renderModelsAccess(null);
    }
  } catch {
    // Non-fatal if endpoint not mounted on legacy proxy
  }
}

async function hydrateSessionHeader() {
  if (!dom.navLogin || !dom.navUser || !dom.navLogout) return;
  try {
    const res = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    if (!data?.user?.username) return;

    dom.navLogin.classList.add('hidden');
    dom.navUser.textContent = `@${data.user.username}`;
    dom.navUser.classList.remove('hidden');
    dom.navLogout.classList.remove('hidden');

    // Load user's own keys so logged-in users can pick a key in 1 click without pasting gw_...
    const keysRes = await fetch('/api/console/keys', { cache: 'no-store', credentials: 'same-origin' });
    if (!keysRes.ok) return;
    const keysData = await keysRes.json();
    state.accountKeys = Array.isArray(keysData?.items) ? keysData.items : [];
    renderAccountKeyPills();
    if (dom.accountKeysPanel) dom.accountKeysPanel.classList.remove('hidden');
    if (dom.manualKeyDivider) dom.manualKeyDivider.classList.remove('hidden');

    if (!hasActiveTarget() && !dom.keyInput.value.trim() && state.accountKeys.length > 0) {
      const preferred = state.accountKeys.find((k) => k.status === 'active') ?? state.accountKeys[0];
      loadAccountKey(preferred.id);
    }
  } catch {
    // Guest view
  }
}

if (dom.navLogout) {
  dom.navLogout.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store', credentials: 'same-origin' });
    } finally {
      dom.navUser.classList.add('hidden');
      dom.navLogout.classList.add('hidden');
      dom.navLogin.classList.remove('hidden');
      state.accountKeys = [];
      if (dom.accountKeysPanel) dom.accountKeysPanel.classList.add('hidden');
      if (dom.manualKeyDivider) dom.manualKeyDivider.classList.add('hidden');
      if (state.mode === 'account') {
        clearSession({ clearInput: false });
      }
    }
  });
}

function updateUsageLiveUi() {
  if (!dom.liveToggleBtn) return;
  dom.liveToggleBtn.setAttribute('aria-pressed', String(state.liveEnabled));
  dom.liveToggleBtn.innerHTML = state.liveEnabled
    ? '<span class="live-dot-pulse" aria-hidden="true"></span><span>Trực tiếp</span>'
    : '<span class="live-dot-paused" aria-hidden="true"></span><span>Tạm dừng</span>';
}

async function silentPollUsage() {
  if (!state.liveEnabled || !hasActiveTarget() || !state.summary || state.loading || state.loadingMore || state.pollInFlight || document.hidden) {
    return;
  }
  const currentGen = state.generation;
  const mode = state.mode;
  const apiKey = state.activeKey;
  const keyId = state.activeKeyId;
  state.pollInFlight = true;
  try {
    const [summary, history] =
      mode === 'account'
        ? await Promise.all([
            fetchAccountJson(`/api/console/keys/${encodeURIComponent(keyId)}`),
            fetchAccountJson(`/api/console/keys/${encodeURIComponent(keyId)}/requests?limit=${PAGE_LIMIT}`),
          ])
        : await Promise.all([
            fetchJson('/api/usage', apiKey),
            fetchJson(`/api/usage/requests?limit=${PAGE_LIMIT}`, apiKey),
          ]);
    if (currentGen !== state.generation) return;
    if (mode === 'account' && (state.mode !== 'account' || state.activeKeyId !== keyId)) return;
    if (mode === 'key' && (state.mode !== 'key' || state.activeKey !== apiKey)) return;

    const prevSummary = state.summary;
    state.summary = summary;
    const prevTotal = state.historyTotal;
    const nextTotal = Number.isSafeInteger(history.total) ? history.total : prevTotal;
    const { merged, nextCursor, changed } = mergeRequestPages(
      state.items,
      Array.isArray(history.items) ? history.items : [],
      {
        pageLimit: PAGE_LIMIT,
        incomingCursor: history.nextCursor ?? null,
        currentCursor: state.nextCursor,
      },
    );
    const summaryChanged =
      !prevSummary
      || prevSummary.usedMicros !== summary.usedMicros
      || prevSummary.reservedMicros !== summary.reservedMicros
      || prevSummary.accountUsedMicros !== summary.accountUsedMicros
      || prevSummary.accountReservedMicros !== summary.accountReservedMicros
      || prevSummary.remainingMicros !== summary.remainingMicros
      || prevSummary.quotaMicros !== summary.quotaMicros
      || prevSummary.requestCount !== summary.requestCount
      || prevSummary.status !== summary.status;
    if (summaryChanged) {
      renderSummary(summary);
      if (mode === 'account' && prevSummary?.status !== summary.status) {
        const idx = state.accountKeys.findIndex((k) => k.id === keyId);
        if (idx >= 0) {
          state.accountKeys[idx] = { ...state.accountKeys[idx], status: summary.status };
          renderAccountKeyPills();
        }
      }
    }
    const historyChanged =
      changed.size > 0
      || merged.length !== state.items.length
      || nextCursor !== state.nextCursor
      || nextTotal !== prevTotal;
    if (historyChanged) {
      state.items = merged;
      state.historyTotal = nextTotal;
      state.nextCursor = nextCursor;
      state.flashIds = changed;
      renderHistory();
      clearTimeout(state.flashTimer);
      state.flashTimer = setTimeout(() => {
        state.flashIds.clear();
      }, 1700);
    }
  } catch {
    // Ignore transient background errors
  } finally {
    state.pollInFlight = false;
  }
}

if (dom.liveToggleBtn) {
  dom.liveToggleBtn.addEventListener('click', () => {
    state.liveEnabled = !state.liveEnabled;
    updateUsageLiveUi();
    if (state.liveEnabled) silentPollUsage();
  });
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.liveEnabled) silentPollUsage();
});

state.pollTimer = setInterval(silentPollUsage, LIVE_INTERVAL_MS);

updateUsageLiveUi();
updateActionButtons();
loadPublicModelsCatalog();
hydrateSessionHeader();
