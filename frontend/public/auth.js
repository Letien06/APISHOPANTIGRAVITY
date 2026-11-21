import { formatMicrosToUsd, translateApiError } from '/assets/format.js';

const dom = {
  leftEyebrow: document.getElementById('left-eyebrow'),
  leftHeading: document.getElementById('left-heading'),
  previewHolder: document.getElementById('preview-holder'),
  previewStamp: document.getElementById('preview-stamp'),
  tabSignin: document.getElementById('tab-signin'),
  tabSignup: document.getElementById('tab-signup'),
  authAlert: document.getElementById('auth-alert'),
  signinForm: document.getElementById('signin-form'),
  signinIdentifier: document.getElementById('signin-identifier'),
  signinPassword: document.getElementById('signin-password'),
  signinSubmit: document.getElementById('signin-submit'),
  signupForm: document.getElementById('signup-form'),
  signupUsername: document.getElementById('signup-username'),
  signupEmail: document.getElementById('signup-email'),
  signupPassword: document.getElementById('signup-password'),
  signupInvite: document.getElementById('signup-invite'),
  toggleInviteBtn: document.getElementById('toggle-invite-btn'),
  inviteInputBox: document.getElementById('invite-input-box'),
  signupQuotaNote: document.getElementById('signup-quota-note'),
  signupSubmit: document.getElementById('signup-submit'),
  strengthLabel: document.getElementById('strength-label'),
  strengthBars: [
    document.getElementById('sb-1'),
    document.getElementById('sb-2'),
    document.getElementById('sb-3'),
    document.getElementById('sb-4'),
  ],
};

let mode = window.location.pathname === '/sign-in' ? 'signin' : 'signup';

function showAlert(message) {
  if (!message) {
    dom.authAlert.classList.add('hidden');
    dom.authAlert.textContent = '';
    return;
  }
  dom.authAlert.textContent = message;
  dom.authAlert.classList.remove('hidden');
}

function setMode(nextMode, pushHistory = true) {
  mode = nextMode;
  showAlert('');
  const isSignin = mode === 'signin';

  dom.tabSignin.classList.toggle('active', isSignin);
  dom.tabSignin.setAttribute('aria-selected', String(isSignin));
  dom.tabSignup.classList.toggle('active', !isSignin);
  dom.tabSignup.setAttribute('aria-selected', String(!isSignin));

  dom.signinForm.classList.toggle('hidden', !isSignin);
  dom.signupForm.classList.toggle('hidden', isSignin);

  if (isSignin) {
    dom.leftEyebrow.textContent = 'PASSPORT CHECK-IN · /V1';
    dom.leftHeading.innerHTML = 'Chào mừng trở lại,<br /><span class="mint-text">gateway đã sẵn sàng.</span>';
    dom.previewStamp.className = 'stamp stamp-blue';
    dom.previewStamp.style.cssText = 'right: 12px; bottom: 12px; width: 70px; height: 70px';
    dom.previewStamp.innerHTML = '<span>READY TO</span><span>CONNECT</span>';
    if (pushHistory && window.location.pathname !== '/sign-in') {
      window.history.replaceState(null, '', '/sign-in');
    }
  } else {
    dom.leftEyebrow.textContent = 'NEW PASSPORT ISSUING · FREE';
    dom.leftHeading.innerHTML = 'Nhận ngay<br /><span class="mint-text">hộ chiếu API của bạn.</span>';
    dom.previewStamp.className = 'stamp';
    dom.previewStamp.style.cssText = 'right: 12px; bottom: 12px; width: 70px; height: 70px';
    dom.previewStamp.innerHTML = '<span>NEW PASS</span><span>PENDING</span>';
    if (pushHistory && window.location.pathname !== '/sign-up') {
      window.history.replaceState(null, '', '/sign-up');
    }
  }
  updatePreviewHolder();
}

function updatePreviewHolder() {
  const val =
    mode === 'signin'
      ? dom.signinIdentifier.value.trim()
      : dom.signupEmail.value.trim() || dom.signupUsername.value.trim();
  dom.previewHolder.textContent = val || 'ban_cua_toi@tiencoder.tech';
}

function updatePasswordStrength() {
  const pw = dom.signupPassword.value;
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score += 1;
  if (pw.length > 0 && score === 0) score = 1;

  const labels = ['Chưa nhập', 'Yếu', 'Trung bình', 'Tốt', 'Rất mạnh'];
  dom.strengthLabel.textContent = labels[score];
  dom.strengthBars.forEach((bar, idx) => {
    bar.className = idx < score ? `strength-bar s${score}` : 'strength-bar';
  });
}

async function submitAuth(url, body, submitBtn) {
  showAlert('');
  submitBtn.disabled = true;
  try {
    const res = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    if (!res.ok) {
      const translated = translateApiError(payload, res.status);
      showAlert(translated.message);
      return;
    }
    window.location.href = '/console';
  } catch {
    showAlert('Không thể kết nối tới máy chủ xác thực. Vui lòng thử lại.');
  } finally {
    submitBtn.disabled = false;
  }
}

document.querySelectorAll('[data-toggle-for]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.toggleFor);
    if (!input) return;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    btn.textContent = showing ? 'Hiện mật khẩu' : 'Ẩn mật khẩu';
    btn.setAttribute('aria-pressed', String(!showing));
  });
});

dom.tabSignin.addEventListener('click', () => setMode('signin'));
dom.tabSignup.addEventListener('click', () => setMode('signup'));

dom.signinIdentifier.addEventListener('input', updatePreviewHolder);
dom.signupUsername.addEventListener('input', updatePreviewHolder);
dom.signupEmail.addEventListener('input', updatePreviewHolder);
dom.signupPassword.addEventListener('input', updatePasswordStrength);

dom.toggleInviteBtn.addEventListener('click', () => {
  dom.inviteInputBox.classList.toggle('hidden');
});

dom.signinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const identifier = dom.signinIdentifier.value.trim();
  const password = dom.signinPassword.value;
  if (!identifier || !password) {
    showAlert('Vui lòng nhập đầy đủ tên đăng nhập/email và mật khẩu.');
    return;
  }
  submitAuth('/api/auth/login', { identifier, password }, dom.signinSubmit);
});

dom.signupForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const username = dom.signupUsername.value.trim();
  const email = dom.signupEmail.value.trim();
  const password = dom.signupPassword.value;
  const inviteCode = dom.signupInvite.value.trim();
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(username)) {
    showAlert('Tên đăng nhập phải dài 3–32 ký tự (chữ cái, số, dấu gạch dưới hoặc gạch ngang).');
    dom.signupUsername.focus();
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showAlert('Vui lòng nhập địa chỉ email hợp lệ.');
    dom.signupEmail.focus();
    return;
  }
  if (password.length < 8 || password.length > 128) {
    showAlert('Mật khẩu phải dài từ 8 đến 128 ký tự.');
    dom.signupPassword.focus();
    return;
  }
  const body = { username, email, password };
  if (inviteCode) body.inviteCode = inviteCode;
  submitAuth('/api/auth/register', body, dom.signupSubmit);
});

async function initAuthPage() {
  setMode(mode, false);
  // Check if already logged in
  try {
    const meRes = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
    if (meRes.ok) {
      window.location.href = '/console';
      return;
    }
  } catch {
    // Stay on auth page
  }

  // Load public signup metadata (invite required & starter quota)
  try {
    const cfgRes = await fetch('/api/public/models', { cache: 'no-store' });
    if (cfgRes.ok) {
      const cfg = await cfgRes.json();
      if (cfg.inviteRequired) {
        dom.inviteInputBox.classList.remove('hidden');
        dom.toggleInviteBtn.classList.add('hidden');
      }
      if (Number.isSafeInteger(cfg.defaultUserQuotaMicros)) {
        dom.signupQuotaNote.textContent =
          `Tài khoản mới được cấp sẵn hạn mức khởi đầu ${formatMicrosToUsd(cfg.defaultUserQuotaMicros)} (tối đa ${cfg.maxKeysPerUser ?? 5} khóa API).`;
      }
    }
  } catch {
    // Non-fatal
  }
}

initAuthPage();
