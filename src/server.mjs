import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.mjs';
import { createStore } from './store.mjs';
import { proxyInference } from './upstream.mjs';

const CHAT = '/v1/chat/completions';
const RESPONSES = '/v1/responses';
const KEY_ROUTE = /^\/admin\/v1\/keys\/([\da-f-]{36})(\/requests|\/secret)?$/;
const ADMIN_USER_ROUTE = /^\/admin\/v1\/users\/([\da-f-]{36})$/;
const CONSOLE_KEY_ROUTE = /^\/api\/console\/keys\/([\da-f-]{36})(\/requests|\/secret)?$/;
const KEY_FIELDS = new Set(['name', 'quotaMicros', 'expiresAt', 'models', 'enabled']);
const USER_KEY_FIELDS = new Set(['name', 'expiresAt', 'models', 'enabled']);
const USER_PATCH_FIELDS = new Set(['quotaMicros', 'enabled']);
const SESSION_COOKIE = 'tc_session';
const ADMIN_SESSION_COOKIE = 'tc_admin_session';
const ADMIN_SESSION_TTL_MS = 24 * 3_600_000;
const STORE_ERROR_STATUS = {
  quota_below_usage: 409,
  quota_below_allocated: 409,
  user_quota_exceeded: 409,
  max_keys_reached: 409,
  username_taken: 409,
  email_taken: 409,
  account_disabled: 403,
};

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function bearer(req) {
  return /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? '';
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      const raw = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return '';
      }
    }
  }
  return '';
}

function isSecureRequest(req) {
  return String(req.headers['x-forwarded-proto'] ?? '').toLowerCase() === 'https';
}

function sessionCookieHeader(req, token, maxAgeSeconds, cookieName = SESSION_COOKIE) {
  const parts = [
    `${cookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

function hash(value) {
  return createHash('sha256').update(value).digest();
}

function badInput(message) {
  return new HttpError(400, 'invalid_request', message);
}

async function readObject(req, maxBytes) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    req.resume();
    throw new HttpError(415, 'unsupported_media_type', 'Send a JSON request body.');
  }
  const tooLarge = () => new HttpError(413, 'body_too_large', 'Request body is too large.');
  if (Number(req.headers['content-length']) > maxBytes) {
    req.resume();
    throw tooLarge();
  }
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      req.resume();
      throw tooLarge();
    }
    chunks.push(chunk);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw badInput('Expected a valid JSON object.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw badInput('Expected a valid JSON object.');
  }
  return value;
}

function normalizeExpiry(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) {
    throw badInput('expiresAt must be an ISO UTC date or null.');
  }
  const date = new Date(value);
  const normalized = value.length === 20 ? value.replace(/Z$/, '.000Z') : value;
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== normalized) {
    throw badInput('expiresAt is not a valid date.');
  }
  return normalized;
}

function keyInput(body, models, creating) {
  const entries = Object.keys(body);
  if (entries.length === 0 || entries.some((field) => !KEY_FIELDS.has(field))) {
    throw badInput('Supply supported key fields.');
  }
  const patch = {};
  if (creating || Object.hasOwn(body, 'name')) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) {
      throw badInput('name must be between 1 and 100 characters.');
    }
    patch.name = body.name.trim();
  }
  if (creating || Object.hasOwn(body, 'quotaMicros')) {
    if (!Number.isSafeInteger(body.quotaMicros) || body.quotaMicros < 0) {
      throw badInput('quotaMicros must be a nonnegative safe integer.');
    }
    patch.quotaMicros = body.quotaMicros;
  }
  if (creating || Object.hasOwn(body, 'expiresAt')) {
    patch.expiresAt = normalizeExpiry(Object.hasOwn(body, 'expiresAt') ? body.expiresAt : null);
  }
  if (creating || Object.hasOwn(body, 'models')) {
    const allowed = Object.hasOwn(body, 'models') ? body.models : null;
    if (allowed !== null && (!Array.isArray(allowed) || allowed.some((model) => !models.has(model)))) {
      throw badInput('models must be null or an array of configured model IDs.');
    }
    patch.models = allowed === null ? null : [...new Set(allowed)];
  }
  if (Object.hasOwn(body, 'enabled')) {
    if (creating || typeof body.enabled !== 'boolean') {
      throw badInput('enabled is a boolean field for updating an existing key.');
    }
    patch.enabled = body.enabled;
  }
  return patch;
}

function userKeyInput(body, models, creating) {
  const entries = Object.keys(body);
  if (entries.length === 0 || entries.some((field) => !USER_KEY_FIELDS.has(field))) {
    throw badInput('Supply supported key fields.');
  }
  const patch = {};
  if (creating || Object.hasOwn(body, 'name')) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) {
      throw badInput('name must be between 1 and 100 characters.');
    }
    patch.name = body.name.trim();
  }
  if (creating || Object.hasOwn(body, 'expiresAt')) {
    patch.expiresAt = normalizeExpiry(Object.hasOwn(body, 'expiresAt') ? body.expiresAt : null);
  }
  if (creating || Object.hasOwn(body, 'models')) {
    const allowed = Object.hasOwn(body, 'models') ? body.models : null;
    if (allowed !== null && (!Array.isArray(allowed) || allowed.some((model) => !models.has(model)))) {
      throw badInput('models must be null or an array of configured model IDs.');
    }
    patch.models = allowed === null ? null : [...new Set(allowed)];
  }
  if (Object.hasOwn(body, 'enabled')) {
    if (creating || typeof body.enabled !== 'boolean') {
      throw badInput('enabled is a boolean field for updating an existing key.');
    }
    patch.enabled = body.enabled;
  }
  return patch;
}

function userPatchInput(body) {
  const entries = Object.keys(body);
  if (entries.length === 0 || entries.some((field) => !USER_PATCH_FIELDS.has(field))) {
    throw badInput('Supply supported user fields.');
  }
  const patch = {};
  if (Object.hasOwn(body, 'quotaMicros')) {
    if (!Number.isSafeInteger(body.quotaMicros) || body.quotaMicros < 0) {
      throw badInput('quotaMicros must be a nonnegative safe integer.');
    }
    patch.quotaMicros = body.quotaMicros;
  }
  if (Object.hasOwn(body, 'enabled')) {
    if (typeof body.enabled !== 'boolean') {
      throw badInput('enabled must be a boolean.');
    }
    patch.enabled = body.enabled;
  }
  return patch;
}

function keyStatus(key) {
  if (!key.enabled) return 'disabled';
  if (key.expiresAt !== null && Date.parse(key.expiresAt) <= Date.now()) return 'expired';
  if (key.remainingMicros === 0) return 'exhausted';
  return 'active';
}

function withStatus(key) {
  return { ...key, status: keyStatus(key) };
}

function page(searchParams) {
  const result = {};
  for (const field of ['limit', 'before']) {
    if (!searchParams.has(field)) continue;
    const raw = searchParams.get(field);
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || (field === 'limit' && value > 100)) {
      throw badInput(field === 'limit' ? 'limit must be between 1 and 100.' : 'before must be a positive cursor.');
    }
    result[field] = value;
  }
  return result;
}

function costMicros(tokens, rate) {
  const cost = (BigInt(tokens) * BigInt(rate) + 999_999n) / 1_000_000n;
  return cost <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cost) : null;
}

function inputCostWithCacheMicros(inputTokens, cachedTokens, inputRate, cachedRate) {
  const safeCached = Math.min(Math.max(0, cachedTokens ?? 0), inputTokens);
  const uncached = inputTokens - safeCached;
  const weighted = BigInt(uncached) * BigInt(inputRate) + BigInt(safeCached) * BigInt(cachedRate);
  const cost = (weighted + 999_999n) / 1_000_000n;
  return cost <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cost) : null;
}

function inferenceBudget(body, endpoint, model) {
  if (Object.hasOwn(body, 'stream') && typeof body.stream !== 'boolean') {
    throw badInput('stream must be a boolean.');
  }
  const fields = endpoint === CHAT ? ['max_tokens', 'max_completion_tokens'] : ['max_output_tokens'];
  const present = fields.filter((field) => body[field] != null);
  if (present.length > 1) throw badInput('Use a single output token limit.');
  const field = present[0] ?? (endpoint === CHAT ? model.chatOutputLimitField ?? fields[0] : fields[0]);
  const outputTokens = body[field] ?? model.maxOutputTokens;
  if (!Number.isSafeInteger(outputTokens) || outputTokens < 1 || outputTokens > model.maxOutputTokens) {
    throw badInput(`${field} must be between 1 and ${model.maxOutputTokens} for this model.`);
  }
  const choices = endpoint === CHAT ? body.n ?? 1 : 1;
  if (!Number.isSafeInteger(choices) || choices < 1 || choices > 10) {
    throw badInput('n must be an integer between 1 and 10.');
  }
  for (const limit of fields) delete body[limit];
  body[field] = outputTokens;
  return {
    inputReservedMicros: costMicros(model.maxInputTokens, model.inputMicrosPerMillion),
    outputReservedMicros: costMicros(outputTokens * choices, model.outputMicrosPerMillion),
  };
}

function accounting(observation, model, budget) {
  const { inputTokens, outputTokens } = observation;
  if (inputTokens !== null && outputTokens !== null) {
    const cachedTokens = Number.isSafeInteger(observation.cachedTokens) && observation.cachedTokens > 0
      ? Math.min(observation.cachedTokens, inputTokens)
      : 0;
    const cachedRate = model.cachedInputMicrosPerMillion ?? Math.round(model.inputMicrosPerMillion * 0.25);
    const inputCostMicros = inputCostWithCacheMicros(inputTokens, cachedTokens, model.inputMicrosPerMillion, cachedRate);
    const outputCostMicros = costMicros(outputTokens, model.outputMicrosPerMillion);
    if (inputCostMicros !== null && outputCostMicros !== null && Number.isSafeInteger(inputCostMicros + outputCostMicros)) {
      return { ...observation, cachedTokens, inputCostMicros, outputCostMicros, estimated: false };
    }
  }
  const estimated = observation.status !== 'upstream_error';
  return {
    ...observation,
    status: observation.status === 'success' ? 'usage_missing' : observation.status,
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    inputCostMicros: estimated ? budget.inputReservedMicros : 0,
    outputCostMicros: estimated ? budget.outputReservedMicros : 0,
    estimated,
  };
}

function keyError(code) {
  switch (code) {
    case 'key_expired': return new HttpError(401, code, 'This API key expired.');
    case 'key_disabled': return new HttpError(401, code, 'This API key is disabled.');
    case 'model_forbidden': return new HttpError(403, code, 'This key cannot call the requested model.');
    case 'quota_exceeded': return new HttpError(429, code, 'Remaining quota does not cover this request.');
    default: return new HttpError(401, 'invalid_key', 'Supply a valid gateway API key.');
  }
}

function createAuthRateLimiter({ windowMs = 5 * 60_000, maxAttempts = 25 } = {}) {
  const buckets = new Map();
  return function check(req) {
    const forwarded = String(req.headers['cf-connecting-ip'] ?? req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    const key = forwarded || req.socket.remoteAddress || 'local';
    const now = Date.now();
    if (buckets.size > 500) {
      for (const [k, item] of buckets) {
        if (item.resetAt <= now) buckets.delete(k);
      }
    }
    const entry = buckets.get(key);
    if (!entry || entry.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    entry.count += 1;
    if (entry.count > maxAttempts) {
      throw new HttpError(429, 'rate_limited', 'Quá nhiều lượt thử xác thực. Vui lòng chờ vài phút rồi thử lại.');
    }
  };
}

export function createGateway({ config, store }) {
  const adminHash = hash(config.adminToken);
  const adminUsernameHash = hash((config.adminUsername ?? 'admin').toLowerCase());
  const adminPasswordHash = config.adminPassword ? hash(config.adminPassword) : null;
  const adminSessions = new Map();
  const notFound = () => new HttpError(404, 'not_found', 'Route or resource not found.');
  const running = new Set();
  const checkAuthRate = createAuthRateLimiter();
  const checkAdminLoginRate = createAuthRateLimiter({ windowMs: 5 * 60_000, maxAttempts: 15 });
  const defaultUserQuotaMicros = config.defaultUserQuotaMicros ?? 1_000_000;
  const maxKeysPerUser = config.maxKeysPerUser ?? 5;
  const sessionTtlMs = config.sessionTtlMs ?? 7 * 24 * 3_600_000;
  const inviteCode = config.inviteCode ?? null;

  function authenticate(req, readOnly) {
    const key = store.findKey(bearer(req));
    if (!key) throw keyError('invalid_key');
    if (!key.enabled) throw keyError('key_disabled');
    if (!readOnly && keyStatus(key) === 'expired') throw keyError('key_expired');
    return key;
  }

  function authenticateSession(req) {
    const token = readCookie(req, SESSION_COOKIE) || bearer(req);
    const user = store.findSessionUser(token);
    if (!user) throw new HttpError(401, 'session_required', 'Vui lòng đăng nhập để tiếp tục.');
    return { user, token };
  }

  function formatUserProfile(user) {
    return { ...user, maxKeys: maxKeysPerUser };
  }

  async function authRoutes(req, res, url) {
    if (url.pathname === '/api/auth/me' && req.method === 'GET') {
      const { user } = authenticateSession(req);
      return json(res, 200, { user: formatUserProfile(user) });
    }

    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      const token = readCookie(req, SESSION_COOKIE) || bearer(req);
      if (token) store.deleteSession(token);
      res.setHeader('set-cookie', sessionCookieHeader(req, '', 0));
      res.writeHead(204);
      return res.end();
    }

    if (url.pathname === '/api/auth/register' && req.method === 'POST') {
      checkAuthRate(req);
      const body = await readObject(req, config.maxBodyBytes);
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const providedInvite = typeof body.inviteCode === 'string' ? body.inviteCode.trim() : '';

      if (!/^[A-Za-z0-9_-]{3,32}$/.test(username)) {
        throw badInput('Tên đăng nhập phải dài 3–32 ký tự và chỉ gồm chữ cái, số, dấu gạch dưới hoặc gạch ngang.');
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
        throw badInput('Địa chỉ email không hợp lệ.');
      }
      if (password.length < 8 || password.length > 128) {
        throw badInput('Mật khẩu phải dài từ 8 đến 128 ký tự.');
      }
      if (inviteCode !== null) {
        const expected = hash(inviteCode);
        const actual = hash(providedInvite);
        if (!providedInvite || !timingSafeEqual(expected, actual)) {
          throw new HttpError(403, 'invalid_invite_code', 'Mã mời không hợp lệ hoặc bị thiếu.');
        }
      }

      const user = store.createUser({
        username,
        email,
        password,
        quotaMicros: defaultUserQuotaMicros,
      });
      const token = store.createSession(user.id, sessionTtlMs);
      res.setHeader('set-cookie', sessionCookieHeader(req, token, Math.floor(sessionTtlMs / 1000)));
      return json(res, 201, { user: formatUserProfile(user) });
    }

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      checkAuthRate(req);
      const body = await readObject(req, config.maxBodyBytes);
      const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      if (!identifier || !password) {
        throw badInput('Vui lòng nhập tên đăng nhập/email và mật khẩu.');
      }
      const result = store.authenticateUser({ identifier, password });
      if (result.error === 'account_disabled') {
        throw new HttpError(403, 'account_disabled', 'Tài khoản này đã bị vô hiệu hóa.');
      }
      if (result.error || !result.user) {
        throw new HttpError(401, 'invalid_credentials', 'Tên đăng nhập/email hoặc mật khẩu không đúng.');
      }
      const token = store.createSession(result.user.id, sessionTtlMs);
      res.setHeader('set-cookie', sessionCookieHeader(req, token, Math.floor(sessionTtlMs / 1000)));
      return json(res, 200, { user: formatUserProfile(result.user) });
    }

    throw notFound();
  }

  async function consoleRoutes(req, res, url) {
    const { user } = authenticateSession(req);

    if (url.pathname === '/api/console/keys') {
      if (req.method === 'GET') {
        return json(res, 200, {
          user: formatUserProfile(user),
          items: store.listUserKeys(user.id).map(withStatus),
        });
      }
      if (req.method === 'POST') {
        const body = await readObject(req, config.maxBodyBytes);
        const input = userKeyInput(body, config.models, true);
        const created = store.createUserKey(user.id, input, maxKeysPerUser);
        return json(res, 201, withStatus(created));
      }
    }

    const [, id, sub] = CONSOLE_KEY_ROUTE.exec(url.pathname) ?? [];
    if (!id) throw notFound();

    if (req.method === 'GET') {
      const key = store.getUserKey(user.id, id);
      if (!key) throw notFound();
      if (sub === '/requests') return json(res, 200, store.listRequests(id, page(url.searchParams)));
      if (sub === '/secret') {
        const secret = store.revealUserKeySecret(user.id, id);
        if (!secret) throw new HttpError(404, 'secret_unavailable', 'Khóa cũ không lưu bản mã hóa để sao chép lại.');
        return json(res, 200, { key: secret });
      }
      return json(res, 200, withStatus(key));
    }
    if (sub) throw notFound();

    if (req.method === 'PATCH') {
      const body = await readObject(req, config.maxBodyBytes);
      const updated = store.updateUserKey(user.id, id, userKeyInput(body, config.models, false));
      if (!updated) throw notFound();
      return json(res, 200, withStatus(updated));
    }
    if (req.method === 'DELETE') {
      if (!store.disableUserKey(user.id, id)) throw notFound();
      res.writeHead(204);
      return res.end();
    }
    throw notFound();
  }

  function hasValidAdminSession(req) {
    const token = readCookie(req, ADMIN_SESSION_COOKIE);
    if (!token || !token.startsWith('adm_')) return false;
    const key = createHash('sha256').update(token).digest('hex');
    const expiresAt = adminSessions.get(key);
    if (!expiresAt) return false;
    if (expiresAt <= Date.now()) {
      adminSessions.delete(key);
      return false;
    }
    return true;
  }

  async function admin(req, res, url) {
    if (url.pathname === '/admin/v1/login' && req.method === 'POST') {
      checkAdminLoginRate(req);
      if (!adminPasswordHash) {
        throw new HttpError(403, 'admin_password_not_configured', 'Chưa cấu hình ADMIN_PASSWORD trên máy chủ. Hãy đăng nhập bằng ADMIN_TOKEN.');
      }
      const body = await readObject(req, config.maxBodyBytes);
      const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const userOk = Boolean(username) && timingSafeEqual(adminUsernameHash, hash(username));
      const passOk = Boolean(password) && timingSafeEqual(adminPasswordHash, hash(password));
      if (!userOk || !passOk) {
        throw new HttpError(401, 'invalid_credentials', 'Tên tài khoản hoặc mật khẩu quản trị không đúng.');
      }
      const now = Date.now();
      for (const [k, exp] of adminSessions) {
        if (exp <= now) adminSessions.delete(k);
      }
      const sessToken = `adm_${randomBytes(32).toString('base64url')}`;
      adminSessions.set(createHash('sha256').update(sessToken).digest('hex'), now + ADMIN_SESSION_TTL_MS);
      res.setHeader('set-cookie', sessionCookieHeader(req, sessToken, Math.floor(ADMIN_SESSION_TTL_MS / 1000), ADMIN_SESSION_COOKIE));
      return json(res, 200, { ok: true, username: config.adminUsername ?? 'admin' });
    }

    if (url.pathname === '/admin/v1/logout' && req.method === 'POST') {
      const token = readCookie(req, ADMIN_SESSION_COOKIE);
      if (token && token.startsWith('adm_')) {
        adminSessions.delete(createHash('sha256').update(token).digest('hex'));
      }
      res.setHeader('set-cookie', sessionCookieHeader(req, '', 0, ADMIN_SESSION_COOKIE));
      res.writeHead(204);
      return res.end();
    }

    const tokenOk = timingSafeEqual(adminHash, hash(bearer(req)));
    if (!tokenOk && !hasValidAdminSession(req)) {
      throw new HttpError(401, 'admin_required', 'Supply a valid administrator credential.');
    }
    if (url.pathname === '/admin/v1/models' && req.method === 'GET') {
      return json(res, 200, { items: [...config.models.values()] });
    }
    if (url.pathname === '/admin/v1/users' && req.method === 'GET') {
      return json(res, 200, { items: store.listUsers().map(formatUserProfile) });
    }
    const [, userId] = ADMIN_USER_ROUTE.exec(url.pathname) ?? [];
    if (userId) {
      if (req.method === 'GET') {
        const found = store.getUser(userId);
        if (!found) throw notFound();
        return json(res, 200, formatUserProfile(found));
      }
      if (req.method === 'PATCH') {
        const body = await readObject(req, config.maxBodyBytes);
        const updated = store.updateUser(userId, userPatchInput(body));
        if (!updated) throw notFound();
        return json(res, 200, formatUserProfile(updated));
      }
      throw notFound();
    }
    if (url.pathname === '/admin/v1/requests' && req.method === 'GET') {
      return json(res, 200, store.listAllRequests(page(url.searchParams)));
    }
    if (url.pathname === '/admin/v1/keys') {
      if (req.method === 'GET') return json(res, 200, { items: store.listKeys().map(withStatus) });
      if (req.method === 'POST') {
        const body = await readObject(req, config.maxBodyBytes);
        return json(res, 201, withStatus(store.createKey(keyInput(body, config.models, true))));
      }
    }
    const [, id, sub] = KEY_ROUTE.exec(url.pathname) ?? [];
    if (!id) throw notFound();
    if (req.method === 'GET') {
      const key = store.getKey(id);
      if (!key) throw notFound();
      if (sub === '/requests') return json(res, 200, store.listRequests(id, page(url.searchParams)));
      if (sub === '/secret') {
        const secret = store.revealKeySecret(id);
        if (!secret) throw new HttpError(404, 'secret_unavailable', 'Khóa cũ không lưu bản mã hóa để sao chép lại.');
        return json(res, 200, { key: secret });
      }
      return json(res, 200, withStatus(key));
    }
    if (sub) throw notFound();
    if (req.method === 'PATCH') {
      const body = await readObject(req, config.maxBodyBytes);
      const updated = store.updateKey(id, keyInput(body, config.models, false));
      if (!updated) throw notFound();
      return json(res, 200, withStatus(updated));
    }
    if (req.method === 'DELETE') {
      if (!store.updateKey(id, { enabled: false })) throw notFound();
      res.writeHead(204);
      return res.end();
    }
    throw notFound();
  }

  async function inference(req, res, key, endpoint, requestId) {
    const body = await readObject(req, config.maxBodyBytes);
    const model = config.models.get(body.model);
    if (!model) throw new HttpError(404, 'model_not_found', 'Use a model ID listed at /v1/models.');
    if (key.models !== null && !key.models.includes(body.model)) throw keyError('model_forbidden');
    const budget = inferenceBudget(body, endpoint, model);
    if (res.destroyed) return;
    const job = store.reserve({
      keyId: key.id, model: model.id, endpoint, ...budget,
      leaseExpiresAt: Date.now() + config.upstreamTimeoutMs + 60_000,
    });
    if (job.error) throw keyError(job.error);

    let observation;
    try {
      observation = await proxyInference({
        res, requestId, endpoint, body, url: new URL(endpoint, config.routerOrigin),
        key: config.routerApiKey, signal: AbortSignal.timeout(config.upstreamTimeoutMs),
      });
    } catch (error) {
      observation = { httpStatus: null, status: 'transport_error', inputTokens: null, outputTokens: null };
      throw error;
    } finally {
      store.settle(job.id, accounting(observation, model, budget));
    }
    if (!res.writableEnded && !res.destroyed) res.end();
  }

  async function handleRequest(req, res) {
    const requestId = randomUUID();
    res.setHeader('x-request-id', requestId);
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');

    try {
      const url = new URL(req.url, 'http://localhost');
      const { pathname } = url;
      if (pathname === '/healthz' && req.method === 'GET') return json(res, 200, { status: 'ok' });
      if (pathname === '/api/public/models' && req.method === 'GET') {
        return json(res, 200, {
          inviteRequired: inviteCode !== null,
          defaultUserQuotaMicros,
          maxKeysPerUser,
          items: [...config.models.values()],
        });
      }
      if (pathname.startsWith('/admin/v1/')) return await admin(req, res, url);
      if (pathname.startsWith('/api/auth/')) return await authRoutes(req, res, url);
      if (pathname.startsWith('/api/console/')) return await consoleRoutes(req, res, url);

      if (req.method === 'GET' && ['/api/usage', '/api/usage/requests'].includes(pathname)) {
        const key = authenticate(req, true);
        const result = pathname === '/api/usage' ? withStatus(key) : store.listRequests(key.id, page(url.searchParams));
        return json(res, 200, result);
      }

      if (req.method === 'GET' && pathname === '/v1/models') {
        const key = authenticate(req, false);
        const allowed = [...config.models.keys()].filter((model) => key.models === null || key.models.includes(model));
        return json(res, 200, {
          object: 'list', data: allowed.map((id) => ({ id, object: 'model', created: 0, owned_by: '9router' })),
        });
      }

      if (req.method === 'POST' && [CHAT, RESPONSES].includes(pathname)) {
        return await inference(req, res, authenticate(req, false), pathname, requestId);
      }
      throw notFound();
    } catch (error) {
      const mappedStatus = error instanceof HttpError
        ? error.status
        : STORE_ERROR_STATUS[error.code] ?? 500;
      if (mappedStatus === 500) console.error('Gateway request failed', { requestId, code: error.code ?? 'internal_error' });
      if (res.destroyed || res.writableEnded) return;
      if (res.headersSent) return res.destroy();
      json(res, mappedStatus, { error: {
        type: mappedStatus === 429 ? 'rate_limit_error' : mappedStatus >= 500 ? 'server_error' : 'invalid_request_error',
        code: mappedStatus === 500 ? 'internal_error' : error.code,
        message: mappedStatus === 500 ? 'Gateway internal error.' : error.message,
      } });
    }
  }

  const server = createServer((req, res) => {
    const operation = handleRequest(req, res);
    running.add(operation);
    const remove = () => running.delete(operation);
    operation.then(remove, remove);
  });
  server.waitForRequests = () => Promise.allSettled(running);
  return server;
}

function start() {
  const config = loadConfig();
  if (config.databasePath !== ':memory:') mkdirSync(dirname(config.databasePath), { recursive: true });
  const store = createStore(config.databasePath, { encryptionSecret: config.adminToken });
  const server = createGateway({ config, store });
  server.on('error', (error) => {
    console.error('Gateway listener failed', error.code);
    store.close();
    process.exitCode = 1;
  });
  server.listen(config.port, config.host, () => console.info(`Gateway listening on ${config.host}:${config.port}`));
  function shutdown() {
    server.close(async () => {
      await server.waitForRequests();
      store.close();
    });
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    start();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
