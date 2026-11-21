import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const KEY_ROUTE = /^\/admin\/v1\/keys\/([\da-f-]{36})(\/requests)?$/;
const KEY_FIELDS = new Set(['name', 'quotaMicros', 'expiresAt', 'models', 'enabled']);

// Fake development-only fixtures — never use in production.
export const MOCK_CREDENTIALS = {
  adminToken: 'mock_admin_demo_token_only_for_local_testing_0001',
  activeKey: 'gw_mock_active_demo_key_0001',
  expiredKey: 'gw_mock_expired_demo_key_0002',
  exhaustedKey: 'gw_mock_exhausted_demo_key_0003',
  disabledKey: 'gw_mock_disabled_demo_key_0004',
  emptyKey: 'gw_mock_empty_history_demo_key_0005',
};

const DEFAULT_MODELS = [
  {
    id: 'ag/gemini-3.8-flash',
    inputMicrosPerMillion: 300_000,
    outputMicrosPerMillion: 2_500_000,
    maxInputTokens: 32_768,
    maxOutputTokens: 4_096,
    chatOutputLimitField: 'max_tokens',
  },
  {
    id: 'ag/gemini-4-argon-medium',
    inputMicrosPerMillion: 1_250_000,
    outputMicrosPerMillion: 10_000_000,
    maxInputTokens: 65_536,
    maxOutputTokens: 8_192,
    chatOutputLimitField: 'max_tokens',
  },
  {
    id: 'ag/gemini-3.1-pro-high',
    inputMicrosPerMillion: 1_250_000,
    outputMicrosPerMillion: 10_000_000,
    maxInputTokens: 65_536,
    maxOutputTokens: 8_192,
    chatOutputLimitField: 'max_tokens',
  },
];

function computeStatus(key) {
  if (!key.enabled) return 'disabled';
  if (key.expiresAt !== null && Date.parse(key.expiresAt) <= Date.now()) return 'expired';
  if (Math.max(0, key.quotaMicros - key.usedMicros - key.reservedMicros) === 0) return 'exhausted';
  return 'active';
}

function summarize(key) {
  const remainingMicros = Math.max(0, key.quotaMicros - key.usedMicros - key.reservedMicros);
  return {
    id: key.id,
    name: key.name,
    keyPrefix: key.keyPrefix,
    enabled: key.enabled,
    expiresAt: key.expiresAt,
    models: key.models === null ? null : [...key.models],
    quotaMicros: key.quotaMicros,
    usedMicros: key.usedMicros,
    reservedMicros: key.reservedMicros,
    remainingMicros,
    requestCount: key.requestCount,
    createdAt: key.createdAt,
    status: computeStatus(key),
  };
}

function seedState() {
  const keys = new Map();
  const secretToId = new Map();
  const requestsByKey = new Map();
  const baseMs = Date.UTC(2026, 10, 21, 7, 30, 0);

  function addSeedKey(secret, record, requests) {
    keys.set(record.id, record);
    secretToId.set(secret, record.id);
    requestsByKey.set(record.id, requests);
  }

  // 1. Active key with 30 requests spanning multiple pages + all edge cases
  const activeId = '11111111-1111-4111-8111-111111111111';
  const activeRequests = [];
  let nextReqId = 1001;

  // Older normal requests so pagination (limit=25) has 2 pages
  for (let i = 0; i < 24; i += 1) {
    const created = new Date(baseMs - (35 - i) * 60_000).toISOString();
    const finished = new Date(baseMs - (35 - i) * 60_000 + 1_800).toISOString();
    const inputTokens = 400 + i * 25;
    const outputTokens = 180 + i * 10;
    const inputCostMicros = Math.ceil((inputTokens * 300_000) / 1_000_000);
    const outputCostMicros = Math.ceil((outputTokens * 2_500_000) / 1_000_000);
    activeRequests.push({
      id: nextReqId++,
      createdAt: created,
      finishedAt: finished,
      model: 'ag/gemini-3.8-flash',
      endpoint: i % 3 === 0 ? '/v1/responses' : '/v1/chat/completions',
      httpStatus: 200,
      status: 'success',
      inputTokens,
      outputTokens,
      inputCostMicros,
      outputCostMicros,
      chargedMicros: inputCostMicros + outputCostMicros,
      estimated: false,
    });
  }

  // Edge case: tiny 1 micro cost (must NOT look like $0.00)
  activeRequests.push({
    id: nextReqId++,
    createdAt: new Date(baseMs - 8 * 60_000).toISOString(),
    finishedAt: new Date(baseMs - 8 * 60_000 + 600).toISOString(),
    model: 'ag/gemini-3.8-flash',
    endpoint: '/v1/chat/completions',
    httpStatus: 200,
    status: 'success',
    inputTokens: 2,
    outputTokens: 0,
    inputCostMicros: 1,
    outputCostMicros: 0,
    chargedMicros: 1,
    estimated: false,
  });

  // Edge case: upstream_error with exact 0 cost
  activeRequests.push({
    id: nextReqId++,
    createdAt: new Date(baseMs - 6 * 60_000).toISOString(),
    finishedAt: new Date(baseMs - 6 * 60_000 + 900).toISOString(),
    model: 'ag/gemini-4-argon-medium',
    endpoint: '/v1/chat/completions',
    httpStatus: 502,
    status: 'upstream_error',
    inputTokens: null,
    outputTokens: null,
    inputCostMicros: 0,
    outputCostMicros: 0,
    chargedMicros: 0,
    estimated: false,
  });

  // Edge case: transport_error with estimated=true and null httpStatus/tokens
  activeRequests.push({
    id: nextReqId++,
    createdAt: new Date(baseMs - 5 * 60_000).toISOString(),
    finishedAt: new Date(baseMs - 5 * 60_000 + 12_000).toISOString(),
    model: 'ag/gemini-3.8-flash',
    endpoint: '/v1/responses',
    httpStatus: null,
    status: 'transport_error',
    inputTokens: null,
    outputTokens: null,
    inputCostMicros: 9_831,
    outputCostMicros: 10_240,
    chargedMicros: 20_071,
    estimated: true,
  });

  // Edge case: usage_missing with estimated=true
  activeRequests.push({
    id: nextReqId++,
    createdAt: new Date(baseMs - 4 * 60_000).toISOString(),
    finishedAt: new Date(baseMs - 4 * 60_000 + 2_100).toISOString(),
    model: 'ag/gemini-3.8-flash',
    endpoint: '/v1/chat/completions',
    httpStatus: 200,
    status: 'usage_missing',
    inputTokens: null,
    outputTokens: null,
    inputCostMicros: 9_831,
    outputCostMicros: 10_240,
    chargedMicros: 20_071,
    estimated: true,
  });

  // Edge case: observed cost > chargedMicros (capped by reservation)
  activeRequests.push({
    id: nextReqId++,
    createdAt: new Date(baseMs - 2 * 60_000).toISOString(),
    finishedAt: new Date(baseMs - 2 * 60_000 + 3_200).toISOString(),
    model: 'ag/gemini-4-argon-medium',
    endpoint: '/v1/chat/completions',
    httpStatus: 200,
    status: 'success',
    inputTokens: 18_500,
    outputTokens: 6_200,
    inputCostMicros: 55_500,
    outputCostMicros: 93_000,
    chargedMicros: 120_000,
    estimated: false,
  });

  // Edge case: pending request (all settled fields null)
  activeRequests.push({
    id: nextReqId++,
    createdAt: new Date(baseMs - 30_000).toISOString(),
    finishedAt: null,
    model: 'ag/gemini-3.8-flash',
    endpoint: '/v1/chat/completions',
    httpStatus: null,
    status: 'pending',
    inputTokens: null,
    outputTokens: null,
    inputCostMicros: null,
    outputCostMicros: null,
    chargedMicros: null,
    estimated: false,
  });

  // Newest first
  activeRequests.reverse();

  const settledSum = activeRequests.reduce((sum, item) => sum + (item.chargedMicros ?? 0), 0);
  addSeedKey(
    MOCK_CREDENTIALS.activeKey,
    {
      id: activeId,
      name: 'Nhóm Dev — Demo Active',
      keyPrefix: MOCK_CREDENTIALS.activeKey.slice(0, 11),
      enabled: true,
      expiresAt: '2026-12-31T16:59:00.000Z',
      models: ['ag/gemini-3.8-flash', 'ag/gemini-4-argon-medium'],
      quotaMicros: 5_000_000,
      usedMicros: settledSum,
      reservedMicros: 20_071,
      requestCount: activeRequests.length,
      createdAt: '2026-11-01T02:00:00.000Z',
    },
    activeRequests,
  );

  // 2. Expired key (still readable on /usage)
  addSeedKey(
    MOCK_CREDENTIALS.expiredKey,
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Khóa Hết Hạn Demo',
      keyPrefix: MOCK_CREDENTIALS.expiredKey.slice(0, 11),
      enabled: true,
      expiresAt: '2026-10-01T17:00:00.000Z',
      models: null,
      quotaMicros: 2_000_000,
      usedMicros: 450_000,
      reservedMicros: 0,
      requestCount: 1,
      createdAt: '2026-09-15T04:00:00.000Z',
    },
    [
      {
        id: 2001,
        createdAt: '2026-09-20T08:15:00.000Z',
        finishedAt: '2026-09-20T08:15:02.000Z',
        model: 'ag/gemini-3.8-flash',
        endpoint: '/v1/chat/completions',
        httpStatus: 200,
        status: 'success',
        inputTokens: 1_000,
        outputTokens: 500,
        inputCostMicros: 300,
        outputCostMicros: 1_250,
        chargedMicros: 1_550,
        estimated: false,
      },
    ],
  );

  // 3. Exhausted key (remainingMicros === 0, still readable on /usage)
  addSeedKey(
    MOCK_CREDENTIALS.exhaustedKey,
    {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Khóa Hết Hạn Mức Demo',
      keyPrefix: MOCK_CREDENTIALS.exhaustedKey.slice(0, 11),
      enabled: true,
      expiresAt: null,
      models: null,
      quotaMicros: 100_000,
      usedMicros: 100_000,
      reservedMicros: 0,
      requestCount: 1,
      createdAt: '2026-11-10T05:00:00.000Z',
    },
    [
      {
        id: 3001,
        createdAt: '2026-11-12T10:00:00.000Z',
        finishedAt: '2026-11-12T10:00:04.000Z',
        model: 'ag/gemini-3.1-pro-high',
        endpoint: '/v1/chat/completions',
        httpStatus: 200,
        status: 'success',
        inputTokens: 20_000,
        outputTokens: 7_500,
        inputCostMicros: 25_000,
        outputCostMicros: 75_000,
        chargedMicros: 100_000,
        estimated: false,
      },
    ],
  );

  // 4. Disabled key (rejected with 401 key_disabled on /usage)
  addSeedKey(
    MOCK_CREDENTIALS.disabledKey,
    {
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Khóa Đã Vô Hiệu Hóa Demo',
      keyPrefix: MOCK_CREDENTIALS.disabledKey.slice(0, 11),
      enabled: false,
      expiresAt: null,
      models: ['ag/gemini-3.8-flash'],
      quotaMicros: 1_000_000,
      usedMicros: 12_000,
      reservedMicros: 0,
      requestCount: 1,
      createdAt: '2026-11-11T03:00:00.000Z',
    },
    [
      {
        id: 4001,
        createdAt: '2026-11-11T04:00:00.000Z',
        finishedAt: '2026-11-11T04:00:01.000Z',
        model: 'ag/gemini-3.8-flash',
        endpoint: '/v1/chat/completions',
        httpStatus: 200,
        status: 'success',
        inputTokens: 4_000,
        outputTokens: 4_320,
        inputCostMicros: 1_200,
        outputCostMicros: 10_800,
        chargedMicros: 12_000,
        estimated: false,
      },
    ],
  );

  // 5. Empty history key + models: [] (no model permissions)
  addSeedKey(
    MOCK_CREDENTIALS.emptyKey,
    {
      id: '55555555-5555-4555-8555-555555555555',
      name: 'Khóa Chưa Có Lịch Sử Demo',
      keyPrefix: MOCK_CREDENTIALS.emptyKey.slice(0, 11),
      enabled: true,
      expiresAt: null,
      models: [],
      quotaMicros: 0,
      usedMicros: 0,
      reservedMicros: 0,
      requestCount: 0,
      createdAt: '2026-11-20T09:00:00.000Z',
    },
    [],
  );

  return { keys, secretToId, requestsByKey, models: DEFAULT_MODELS };
}

function json(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}

function errorJson(res, status, code, message) {
  return json(res, status, {
    error: {
      type: status === 429 ? 'rate_limit_error' : status >= 500 ? 'server_error' : 'invalid_request_error',
      code,
      message,
    },
  });
}

function bearer(req) {
  return /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? '';
}

async function readJsonBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    throw { status: 415, code: 'unsupported_media_type', message: 'Send a JSON request body.' };
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not object');
    }
    return parsed;
  } catch {
    throw { status: 400, code: 'invalid_request', message: 'Expected a valid JSON object.' };
  }
}

function parsePage(searchParams) {
  let limit = 50;
  let before = null;
  if (searchParams.has('limit')) {
    const raw = searchParams.get('limit');
    const num = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(num) || num < 1 || num > 100) {
      throw { status: 400, code: 'invalid_request', message: 'limit must be between 1 and 100.' };
    }
    limit = num;
  }
  if (searchParams.has('before')) {
    const raw = searchParams.get('before');
    const num = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(num) || num < 1) {
      throw { status: 400, code: 'invalid_request', message: 'before must be a positive cursor.' };
    }
    before = num;
  }
  return { limit, before };
}

function paginateRequests(all, { limit, before }) {
  const filtered = before === null ? all : all.filter((item) => item.id < before);
  const items = filtered.slice(0, limit);
  const nextCursor = filtered.length > limit ? items.at(-1).id : null;
  return { items, nextCursor };
}

function validateExpiry(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) {
    throw { status: 400, code: 'invalid_request', message: 'expiresAt must be an ISO UTC date or null.' };
  }
  const normalized = value.length === 20 ? value.replace(/Z$/, '.000Z') : value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== normalized) {
    throw { status: 400, code: 'invalid_request', message: 'expiresAt is not a valid date.' };
  }
  return normalized;
}

export function createMockGateway({ adminToken = MOCK_CREDENTIALS.adminToken } = {}) {
  const data = seedState();
  const modelIds = new Set(data.models.map((m) => m.id));

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const { pathname, searchParams } = url;

      if (pathname === '/healthz' && req.method === 'GET') {
        return json(res, 200, { status: 'ok' });
      }

      if (pathname.startsWith('/admin/v1/')) {
        if (bearer(req) !== adminToken) {
          return errorJson(res, 401, 'admin_required', 'Supply a valid administrator credential.');
        }

        if (pathname === '/admin/v1/models' && req.method === 'GET') {
          return json(res, 200, { items: data.models });
        }

        if (pathname === '/admin/v1/keys') {
          if (req.method === 'GET') {
            const list = [...data.keys.values()]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
              .map(summarize);
            return json(res, 200, { items: list });
          }
          if (req.method === 'POST') {
            const body = await readJsonBody(req);
            const fields = Object.keys(body);
            if (fields.length === 0 || fields.some((f) => !KEY_FIELDS.has(f)) || Object.hasOwn(body, 'enabled')) {
              return errorJson(res, 400, 'invalid_request', 'Supply supported key fields.');
            }
            if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) {
              return errorJson(res, 400, 'invalid_request', 'name must be between 1 and 100 characters.');
            }
            if (!Number.isSafeInteger(body.quotaMicros) || body.quotaMicros < 0) {
              return errorJson(res, 400, 'invalid_request', 'quotaMicros must be a nonnegative safe integer.');
            }
            const expiresAt = validateExpiry(Object.hasOwn(body, 'expiresAt') ? body.expiresAt : null);
            const rawModels = Object.hasOwn(body, 'models') ? body.models : null;
            if (rawModels !== null && (!Array.isArray(rawModels) || rawModels.some((m) => !modelIds.has(m)))) {
              return errorJson(res, 400, 'invalid_request', 'models must be null or an array of configured model IDs.');
            }
            const secret = `gw_${randomBytes(24).toString('base64url')}`;
            const record = {
              id: randomUUID(),
              name: body.name.trim(),
              keyPrefix: secret.slice(0, 11),
              enabled: true,
              expiresAt,
              models: rawModels === null ? null : [...new Set(rawModels)],
              quotaMicros: body.quotaMicros,
              usedMicros: 0,
              reservedMicros: 0,
              requestCount: 0,
              createdAt: new Date().toISOString(),
            };
            data.keys.set(record.id, record);
            data.secretToId.set(secret, record.id);
            data.requestsByKey.set(record.id, []);
            return json(res, 201, { key: secret, ...summarize(record) });
          }
        }

        const match = KEY_ROUTE.exec(pathname);
        if (!match) return errorJson(res, 404, 'not_found', 'Route or resource not found.');
        const [, id, isRequests] = match;
        const record = data.keys.get(id);
        if (!record) return errorJson(res, 404, 'not_found', 'Route or resource not found.');

        if (req.method === 'GET') {
          if (isRequests) {
            return json(res, 200, paginateRequests(data.requestsByKey.get(id) ?? [], parsePage(searchParams)));
          }
          return json(res, 200, summarize(record));
        }

        if (isRequests) return errorJson(res, 404, 'not_found', 'Route or resource not found.');

        if (req.method === 'PATCH') {
          const body = await readJsonBody(req);
          const fields = Object.keys(body);
          if (fields.length === 0 || fields.some((f) => !KEY_FIELDS.has(f))) {
            return errorJson(res, 400, 'invalid_request', 'Supply supported key fields.');
          }
          if (Object.hasOwn(body, 'name')) {
            if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) {
              return errorJson(res, 400, 'invalid_request', 'name must be between 1 and 100 characters.');
            }
          }
          if (Object.hasOwn(body, 'quotaMicros')) {
            if (!Number.isSafeInteger(body.quotaMicros) || body.quotaMicros < 0) {
              return errorJson(res, 400, 'invalid_request', 'quotaMicros must be a nonnegative safe integer.');
            }
            if (body.quotaMicros < record.usedMicros + record.reservedMicros) {
              return errorJson(res, 409, 'quota_below_usage', 'Quota cannot be lower than settled and reserved usage.');
            }
          }
          if (Object.hasOwn(body, 'expiresAt')) validateExpiry(body.expiresAt);
          if (Object.hasOwn(body, 'models')) {
            if (body.models !== null && (!Array.isArray(body.models) || body.models.some((m) => !modelIds.has(m)))) {
              return errorJson(res, 400, 'invalid_request', 'models must be null or an array of configured model IDs.');
            }
          }
          if (Object.hasOwn(body, 'enabled') && typeof body.enabled !== 'boolean') {
            return errorJson(res, 400, 'invalid_request', 'enabled must be boolean.');
          }

          if (Object.hasOwn(body, 'name')) record.name = body.name.trim();
          if (Object.hasOwn(body, 'quotaMicros')) record.quotaMicros = body.quotaMicros;
          if (Object.hasOwn(body, 'expiresAt')) record.expiresAt = validateExpiry(body.expiresAt);
          if (Object.hasOwn(body, 'models')) record.models = body.models === null ? null : [...new Set(body.models)];
          if (Object.hasOwn(body, 'enabled')) record.enabled = body.enabled;

          return json(res, 200, summarize(record));
        }

        if (req.method === 'DELETE') {
          record.enabled = false;
          res.writeHead(204, { 'cache-control': 'no-store' });
          return res.end();
        }

        return errorJson(res, 404, 'not_found', 'Route or resource not found.');
      }

      if (req.method === 'GET' && (pathname === '/api/usage' || pathname === '/api/usage/requests')) {
        const keyId = data.secretToId.get(bearer(req));
        const record = keyId ? data.keys.get(keyId) : null;
        if (!record) return errorJson(res, 401, 'invalid_key', 'Supply a valid gateway API key.');
        if (!record.enabled) return errorJson(res, 401, 'key_disabled', 'This API key is disabled.');
        if (pathname === '/api/usage') return json(res, 200, summarize(record));
        return json(res, 200, paginateRequests(data.requestsByKey.get(record.id) ?? [], parsePage(searchParams)));
      }

      if (req.method === 'GET' && pathname === '/v1/models') {
        const keyId = data.secretToId.get(bearer(req));
        const record = keyId ? data.keys.get(keyId) : null;
        if (!record) return errorJson(res, 401, 'invalid_key', 'Supply a valid gateway API key.');
        if (!record.enabled) return errorJson(res, 401, 'key_disabled', 'This API key is disabled.');
        if (computeStatus(record) === 'expired') return errorJson(res, 401, 'key_expired', 'This API key expired.');
        const allowed = data.models.filter((m) => record.models === null || record.models.includes(m.id));
        return json(res, 200, {
          object: 'list',
          data: allowed.map((m) => ({ id: m.id, object: 'model', created: 0, owned_by: '9router' })),
        });
      }

      return errorJson(res, 404, 'not_found', 'Route or resource not found.');
    } catch (error) {
      if (error && typeof error.status === 'number') {
        return errorJson(res, error.status, error.code ?? 'invalid_request', error.message ?? 'Invalid request.');
      }
      return errorJson(res, 500, 'internal_error', 'Mock gateway error.');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.MOCK_GATEWAY_PORT ?? '20199');
  const server = createMockGateway();
  server.listen(port, '127.0.0.1', () => {
    console.info(`Mock gateway listening on http://127.0.0.1:${port}`);
  });
}
