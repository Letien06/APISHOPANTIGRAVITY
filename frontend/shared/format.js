const MICROS_PER_USD = 1_000_000;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

const vnDateTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export const KEY_STATUS_META = {
  active: { label: 'Đang hoạt động', tone: 'success' },
  disabled: { label: 'Đã vô hiệu hóa', tone: 'danger' },
  expired: { label: 'Đã hết hạn', tone: 'warning' },
  exhausted: { label: 'Hết hạn mức', tone: 'warning' },
};

export const REQUEST_STATUS_META = {
  pending: { label: 'Đang xử lý', tone: 'info' },
  success: { label: 'Thành công', tone: 'success' },
  upstream_error: { label: 'Lỗi từ dịch vụ xử lý', tone: 'danger' },
  transport_error: { label: 'Lỗi kết nối hoặc truyền dữ liệu', tone: 'danger' },
  usage_missing: { label: 'Thiếu dữ liệu sử dụng', tone: 'warning' },
};

export const ERROR_MESSAGES = {
  invalid_key: 'Khóa API không hợp lệ hoặc không tồn tại. Vui lòng kiểm tra lại.',
  key_disabled: 'Khóa API này đã bị vô hiệu hóa nên không thể tra cứu hoặc gọi API.',
  key_expired: 'Khóa API này đã hết hạn sử dụng.',
  quota_exceeded: 'Hạn mức còn lại không đủ để thực hiện yêu cầu.',
  model_forbidden: 'Khóa API này không được cấp quyền sử dụng model đã chọn.',
  admin_required: 'Mã quản trị không hợp lệ hoặc đã hết phiên. Vui lòng nhập lại.',
  quota_below_usage: 'Hạn mức mới không được thấp hơn tổng số đã dùng và đang giữ chỗ.',
  quota_below_allocated: 'Hạn mức tài khoản không được thấp hơn tổng hạn mức đã phân bổ cho các khóa.',
  user_quota_exceeded: 'Hạn mức khóa vượt quá số dư chưa phân bổ của tài khoản.',
  max_keys_reached: 'Bạn đã đạt giới hạn số lượng khóa hoạt động tối đa. Hãy tắt bớt khóa cũ trước khi tạo hoặc bật khóa mới.',
  csrf_rejected: 'Yêu cầu bị từ chối do nguồn gốc không hợp lệ (bảo vệ CSRF). Hãy tải lại trang và thử lại.',
  username_taken: 'Tên đăng nhập này đã có người sử dụng. Hãy chọn tên khác.',
  email_taken: 'Email này đã được đăng ký tài khoản.',
  invalid_credentials: 'Tên đăng nhập/email hoặc mật khẩu không đúng.',
  account_disabled: 'Tài khoản này đã bị vô hiệu hóa bởi quản trị viên.',
  session_required: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  invalid_invite_code: 'Mã mời không hợp lệ hoặc bị thiếu.',
  rate_limited: 'Quá nhiều lượt thử xác thực. Vui lòng chờ vài phút rồi thử lại.',
  invalid_request: 'Dữ liệu gửi lên không hợp lệ. Vui lòng kiểm tra lại các trường nhập.',
  not_found: 'Không tìm thấy tài nguyên hoặc khóa yêu cầu.',
  unsupported_media_type: 'Định dạng yêu cầu không được hỗ trợ.',
  body_too_large: 'Dữ liệu gửi lên vượt quá kích thước cho phép.',
  internal_error: 'Máy chủ gặp lỗi nội bộ. Vui lòng thử lại sau.',
};

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatMicrosToUsd(micros) {
  if (micros === null || micros === undefined) return null;
  if (!Number.isSafeInteger(micros)) return null;
  const negative = micros < 0;
  const abs = Math.abs(micros);
  const whole = Math.floor(abs / MICROS_PER_USD);
  const fracRaw = String(abs % MICROS_PER_USD).padStart(6, '0');
  const trimmed = fracRaw.replace(/0+$/, '');
  const frac = trimmed.length <= 2 ? fracRaw.slice(0, 2) : trimmed;
  const wholeFormatted = whole.toLocaleString('en-US');
  return `${negative ? '-' : ''}$${wholeFormatted}.${frac}`;
}

export function formatMicrosInputValue(micros) {
  if (!Number.isSafeInteger(micros) || micros < 0) return '';
  const whole = Math.floor(micros / MICROS_PER_USD);
  const frac = String(micros % MICROS_PER_USD).padStart(6, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

export function parseUsdToMicros(rawInput) {
  if (typeof rawInput !== 'string') {
    return { ok: false, error: 'Vui lòng nhập hạn mức bằng USD.' };
  }
  const normalized = rawInput.trim().replaceAll(',', '.');
  if (!normalized) {
    return { ok: false, error: 'Vui lòng nhập hạn mức bằng USD.' };
  }
  if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) {
    return {
      ok: false,
      error: 'Hạn mức USD phải là số không âm với tối đa 6 chữ số thập phân (ví dụ: 5 hoặc 1.25).',
    };
  }
  const [wholePart, fracPart = ''] = normalized.split('.');
  const microsBig = BigInt(wholePart) * 1_000_000n + BigInt(fracPart.padEnd(6, '0'));
  if (microsBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { ok: false, error: 'Hạn mức quá lớn, vượt quá giới hạn an toàn.' };
  }
  return { ok: true, micros: Number(microsBig) };
}

export function formatInteger(value) {
  if (value === null || value === undefined) return null;
  return Number(value).toLocaleString('vi-VN');
}

export function formatVnDateTime(isoUtc) {
  if (!isoUtc) return null;
  const date = new Date(isoUtc);
  if (!Number.isFinite(date.getTime())) return null;
  return vnDateTimeFormatter.format(date);
}

export function isoUtcToVnInput(isoUtc) {
  if (!isoUtc) return '';
  const ms = Date.parse(isoUtc);
  if (!Number.isFinite(ms)) return '';
  const vn = new Date(ms + VN_OFFSET_MS);
  const y = String(vn.getUTCFullYear()).padStart(4, '0');
  const m = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const d = String(vn.getUTCDate()).padStart(2, '0');
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const mm = String(vn.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

export function vnInputToIsoUtc(vnLocalValue) {
  if (typeof vnLocalValue !== 'string' || !vnLocalValue.trim()) {
    return { ok: true, value: null };
  }
  const trimmed = vnLocalValue.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) {
    return { ok: false, error: 'Định dạng thời gian hết hạn không hợp lệ.' };
  }
  const [, ys, ms, ds, hs, mins, secs = '00'] = match;
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  const h = Number(hs);
  const min = Number(mins);
  const sec = Number(secs);
  const check = new Date(Date.UTC(y, m - 1, d, h, min, sec));
  if (
    check.getUTCFullYear() !== y
    || check.getUTCMonth() !== m - 1
    || check.getUTCDate() !== d
    || check.getUTCHours() !== h
    || check.getUTCMinutes() !== min
    || check.getUTCSeconds() !== sec
  ) {
    return { ok: false, error: 'Ngày giờ hết hạn không tồn tại.' };
  }
  const utcDate = new Date(check.getTime() - VN_OFFSET_MS);
  return { ok: true, value: utcDate.toISOString() };
}

export function formatModelsSummary(models) {
  if (models === null) return 'Tất cả model được cấu hình';
  if (Array.isArray(models) && models.length === 0) return 'Không cấp quyền model nào';
  return `${models.length} model được cấp quyền`;
}

export function getKeyStatusMeta(status) {
  return KEY_STATUS_META[status] ?? { label: status ?? 'Không xác định', tone: 'neutral' };
}

export function getRequestStatusMeta(status) {
  return REQUEST_STATUS_META[status] ?? { label: status ?? 'Không xác định', tone: 'neutral' };
}

export function translateApiError(payload, httpStatus) {
  const code = payload?.error?.code;
  if (code && ERROR_MESSAGES[code]) {
    return { code, message: ERROR_MESSAGES[code] };
  }
  if (httpStatus === 401) {
    return { code: code ?? 'unauthorized', message: 'Xác thực thất bại. Vui lòng kiểm tra lại khóa hoặc mã quản trị.' };
  }
  if (httpStatus === 403) {
    return { code: code ?? 'forbidden', message: 'Bạn không có quyền thực hiện thao tác này.' };
  }
  if (httpStatus === 404) {
    return { code: code ?? 'not_found', message: ERROR_MESSAGES.not_found };
  }
  if (httpStatus === 409) {
    return { code: code ?? 'conflict', message: payload?.error?.message ?? 'Xung đột dữ liệu khi cập nhật.' };
  }
  if (httpStatus === 429) {
    return { code: code ?? 'quota_exceeded', message: ERROR_MESSAGES.quota_exceeded };
  }
  if (httpStatus >= 500) {
    return { code: code ?? 'internal_error', message: ERROR_MESSAGES.internal_error };
  }
  return {
    code: code ?? 'unknown_error',
    message: payload?.error?.message || 'Đã xảy ra lỗi không xác định. Vui lòng thử lại.',
  };
}

export function isChargeCappedByReservation(item) {
  return (
    item.inputCostMicros !== null
    && item.outputCostMicros !== null
    && item.chargedMicros !== null
    && item.inputCostMicros + item.outputCostMicros !== item.chargedMicros
  );
}

export function renderNullableValue(formattedValue, emptyText = 'Chưa có dữ liệu') {
  if (formattedValue === null || formattedValue === undefined) {
    return `<span class="muted-null" aria-label="${escapeHtml(emptyText)}">${escapeHtml(emptyText)}</span>`;
  }
  return escapeHtml(formattedValue);
}

function hasRequestItemChanged(prev, next) {
  return (
    !prev
    || prev.status !== next.status
    || prev.chargedMicros !== next.chargedMicros
    || prev.finishedAt !== next.finishedAt
    || prev.httpStatus !== next.httpStatus
    || prev.inputTokens !== next.inputTokens
    || prev.outputTokens !== next.outputTokens
    || prev.cachedTokens !== next.cachedTokens
    || prev.estimated !== next.estimated
  );
}

export function mergeRequestPages(existing, incoming, { pageLimit = 50, incomingCursor = null, currentCursor = null } = {}) {
  const prevList = Array.isArray(existing) ? existing : [];
  const nextList = Array.isArray(incoming) ? incoming : [];
  const prevById = new Map(prevList.map((item) => [item.id, item]));
  const changed = new Set();

  for (const item of nextList) {
    if (hasRequestItemChanged(prevById.get(item.id), item)) {
      changed.add(item.id);
    }
  }

  if (nextList.length === 0) {
    return { merged: [], nextCursor: null, changed };
  }

  if (nextList.length < pageLimit) {
    const merged = [...nextList].sort((a, b) => b.id - a.id);
    return { merged, nextCursor: null, changed };
  }

  if (prevList.length === 0) {
    const merged = [...nextList].sort((a, b) => b.id - a.id);
    return { merged, nextCursor: incomingCursor ?? null, changed };
  }

  const hasOverlap = nextList.some((item) => prevById.has(item.id));
  if (!hasOverlap) {
    // >= pageLimit new requests arrived between polls; reset cleanly to avoid a silent middle gap.
    const merged = [...nextList].sort((a, b) => b.id - a.id);
    return { merged, nextCursor: incomingCursor ?? null, changed };
  }

  const incomingIds = new Set(nextList.map((item) => item.id));
  const olderTail = prevList.filter((item) => !incomingIds.has(item.id));
  const merged = [...nextList, ...olderTail].sort((a, b) => b.id - a.id);

  let nextCursor;
  if (olderTail.length > 0) {
    nextCursor = currentCursor !== null ? merged[merged.length - 1].id : null;
  } else {
    nextCursor = incomingCursor ?? null;
  }
  return { merged, nextCursor, changed };
}

export function appendRequestPage(existing, incoming) {
  const byId = new Map();
  for (const item of existing ?? []) byId.set(item.id, item);
  for (const item of incoming ?? []) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => b.id - a.id);
}

export function formatLoadedCount(loaded, total) {
  const safeLoaded = Number.isFinite(loaded) ? loaded : 0;
  const safeTotal = Number.isFinite(total) ? Math.max(safeLoaded, total) : safeLoaded;
  if (safeTotal > safeLoaded) {
    return `Đang hiện ${formatInteger(safeLoaded)} / ${formatInteger(safeTotal)} mục`;
  }
  return `${formatInteger(safeTotal)} mục`;
}

let splashDismissed = false;
let splashGuardInstalled = false;

export function dismissSplash() {
  if (splashDismissed || typeof document === 'undefined') return;
  splashDismissed = true;
  const el = document.getElementById('tc-splash');
  if (!el) return;
  el.classList.add('is-hidden');
  el.setAttribute('aria-hidden', 'true');
  setTimeout(() => {
    el.remove();
  }, 280);
}

export function initSplashGuard(maxWaitMs = 1800) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return dismissSplash;
  }
  if (!splashGuardInstalled) {
    splashGuardInstalled = true;
    // Guarantee splash can never stay stuck on slow networks, uncaught errors, or bfcache restores.
    setTimeout(dismissSplash, maxWaitMs);
    window.addEventListener('error', dismissSplash, { once: true });
    window.addEventListener('unhandledrejection', dismissSplash, { once: true });
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) dismissSplash();
    });
  }
  return dismissSplash;
}
