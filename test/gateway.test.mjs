import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, rmSync, rmdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createGateway } from '../src/server.mjs';
import { createStore } from '../src/store.mjs';

const model = 'ag/test';
const otherModel = 'ag/other';
const adminToken = 'admin-test-0123456789-0123456789-0123456789';
const routerApiKey = 'router-test-only';
const chat = '/v1/chat/completions';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

async function fixture(t, reply) {
  const calls = [];
  const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    const call = { body, path: req.url, authorization: req.headers.authorization };
    calls.push(call);
    await reply(res, call);
  });
  const routerOrigin = await listen(upstream);
  const store = createStore(':memory:');
  const prices = { inputMicrosPerMillion: 2_000_000, outputMicrosPerMillion: 3_000_000, maxInputTokens: 10, maxOutputTokens: 10 };
  const config = {
    adminToken, routerApiKey, routerOrigin, upstreamTimeoutMs: 2000, maxBodyBytes: 1024,
    models: new Map([[model, { id: model, ...prices }], [otherModel, { id: otherModel, ...prices }]]),
  };
  const gateway = createGateway({ config, store });
  const origin = await listen(gateway);
  t.after(async () => {
    await Promise.all([gateway, upstream].map((server) => new Promise((resolve) => server.close(resolve))));
    await gateway.waitForRequests();
    store.close();
  });

  const call = (path, { token, body, method = body ? 'POST' : 'GET' } = {}) => fetch(`${origin}${path}`, {
    method,
    headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(body && { 'Content-Type': 'application/json' }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const makeKey = async (payload = {}) => {
    const response = await call('/admin/v1/keys', { token: adminToken, body: { name: 'Bạn', quotaMicros: 200, ...payload } });
    assert.equal(response.status, 201);
    return response.json();
  };
  const use = (token, body = {}) => call(chat, { token, body: { model, messages: [{ role: 'user', content: 'Hello' }], ...body } });
  return { calls, call, makeKey, use };
}

function respond(res, data, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

test('auth, expiry, quota, per-key isolation, and admin controls', async (t) => {
  const { calls, call, makeKey, use } = await fixture(t, (res) => respond(res, {
    choices: [{ message: { content: 'Hello' } }], usage: { prompt_tokens: 2, completion_tokens: 3 },
  }));
  const a = await makeKey({ name: 'A', models: [model] });
  const b = await makeKey({ name: 'B', quotaMicros: 1 });
  const expired = await makeKey({ name: 'Expired', expiresAt: '2000-01-01T00:00:00Z' });
  assert.match(a.key, /^gw_/);
  assert.equal((await call('/admin/v1/keys', { token: a.key })).status, 401);
  const listed = await (await call('/admin/v1/keys', { token: adminToken })).json();
  assert.equal(listed.items.length, 3);
  assert.ok(listed.items.every((item) => !Object.hasOwn(item, 'key')));
  assert.deepEqual((await (await call('/v1/models', { token: a.key })).json()).data.map((entry) => entry.id), [model]);
  assert.equal((await use(a.key, { model: otherModel })).status, 403);
  assert.equal((await use(expired.key)).status, 401);
  assert.equal((await (await call('/api/usage', { token: expired.key })).json()).status, 'expired');
  assert.equal((await use(b.key)).status, 429);
  assert.equal((await use()).status, 401);
  assert.equal((await use(a.key, { messages: [{ content: 'a'.repeat(1300) }] })).status, 413);
  const result = await use(a.key);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).choices[0].message.content, 'Hello');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].authorization, `Bearer ${routerApiKey}`);
  assert.equal(calls[0].body.max_tokens, 10);

  const usage = await (await call('/api/usage', { token: a.key })).json();
  assert.equal(usage.requestCount, 1);
  assert.equal(usage.usedMicros, 13);
  assert.equal(usage.remainingMicros, 187);
  assert.equal(usage.reservedMicros, 0);
  const history = await (await call('/api/usage/requests?limit=1', { token: a.key })).json();
  assert.equal(history.nextCursor, null);
  assert.deepEqual(
    ['inputTokens', 'outputTokens', 'inputCostMicros', 'outputCostMicros', 'chargedMicros', 'estimated'].map((field) => history.items[0][field]),
    [2, 3, 4, 9, 13, false],
  );
  assert.deepEqual((await (await call('/api/usage/requests', { token: b.key })).json()).items, []);
  assert.equal((await call(`/admin/v1/keys/${a.id}`, { token: adminToken, method: 'PATCH', body: { quotaMicros: 12 } })).status, 409);
  assert.equal((await call(`/admin/v1/keys/${a.id}`, { token: adminToken, method: 'DELETE' })).status, 204);
  assert.equal((await call('/api/usage', { token: a.key })).status, 401);
  assert.equal((await call('/v1/models', { token: b.key })).status, 200);
});

test('concurrent requests reserve quota atomically and retain observed costs if the upstream exceeds a configured bound', async (t) => {
  let upstreamStarted;
  let allowResponse;
  const started = new Promise((resolve) => { upstreamStarted = resolve; });
  const blocked = new Promise((resolve) => { allowResponse = resolve; });
  const { calls, call, makeKey, use } = await fixture(t, async (res) => {
    upstreamStarted();
    await blocked;
    respond(res, { usage: { prompt_tokens: 12, completion_tokens: 11 } });
  });
  const { key } = await makeKey({ quotaMicros: 50 });
  const first = use(key);
  await started;
  try {
    const interim = await (await call('/api/usage', { token: key })).json();
    assert.equal(interim.reservedMicros, 50);
    assert.equal((await use(key)).status, 429);
    assert.equal(calls.length, 1);
  } finally {
    allowResponse();
  }
  assert.equal((await first).status, 200);
  const usage = await (await call('/api/usage', { token: key })).json();
  assert.equal(usage.usedMicros, 50);
  assert.equal(usage.remainingMicros, 0);
  const { items: [item] } = await (await call('/api/usage/requests', { token: key })).json();
  assert.equal(item.inputCostMicros + item.outputCostMicros, 57);
  assert.equal(item.chargedMicros, 50);
});

test('streaming usage, structured Responses, sanitized upstream errors, and missing usage', async (t) => {
  const sse = 'data: {"choices":[{"delta":{"content":"Chào"}}]}\r\n\r\ndata: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":4}}\r\n\r\ndata: [DONE]\r\n\r\n';
  const { calls, call, makeKey, use } = await fixture(t, (res, request) => {
    if (request.body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const bytes = Buffer.from(sse);
      const split = bytes.indexOf(Buffer.from('à')) + 1;
      res.write(bytes.subarray(0, split));
      return res.end(bytes.subarray(split));
    }
    if (request.body.user === 'error') return respond(res, { error: 'sensitive upstream detail' }, 429);
    if (request.body.user === 'invalid') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"partial":');
    }
    if (request.body.user === 'missing') return respond(res, { choices: [] });
    return respond(res, { object: 'response', usage: { input_tokens: 1, output_tokens: 2 } });
  });
  const { key } = await makeKey({ quotaMicros: 500 });
  const stream = await use(key, { stream: true });
  assert.match(stream.headers.get('content-type'), /^text\/event-stream/);
  assert.equal(await stream.text(), sse);
  assert.equal(calls[0].body.stream_options.include_usage, true);
  const response = await call('/v1/responses', { token: key, body: { model, input: 'Hi', max_output_tokens: 4 } });
  assert.equal((await response.json()).object, 'response');
  assert.equal(calls[1].body.max_output_tokens, 4);
  const error = await use(key, { user: 'error' });
  assert.equal(error.status, 429);
  assert.doesNotMatch(await error.text(), /sensitive/);
  assert.equal((await use(key, { user: 'invalid' })).status, 502);
  assert.equal((await use(key, { user: 'missing' })).status, 200);
  const recent = await (await call('/api/usage/requests?limit=2', { token: key })).json();
  assert.deepEqual(recent.items.map((item) => [item.status, item.estimated, item.chargedMicros]), [
    ['usage_missing', true, 50],
    ['transport_error', true, 50],
  ]);
  const earlier = await (await call(`/api/usage/requests?before=${recent.nextCursor}`, { token: key })).json();
  assert.deepEqual(earlier.items.map((item) => item.chargedMicros), [0, 8, 18]);
});

test('streaming SSE succeeds when upstream omits trailing blank line or [DONE] after finish_reason/usage', async (t) => {
  const sseNoBlank = 'data: {"choices":[{"delta":{"content":"Ok"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":5}}\n\ndata: [DONE]';
  const sseNoDone = 'data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3}}\n\n';
  const { call, makeKey, use } = await fixture(t, (res, request) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    return res.end(request.body.user === 'no-done' ? sseNoDone : sseNoBlank);
  });
  const { key } = await makeKey({ quotaMicros: 500 });

  const r1 = await use(key, { stream: true, user: 'no-blank' });
  assert.equal(r1.status, 200);
  assert.equal(await r1.text(), sseNoBlank);

  const r2 = await use(key, { stream: true, user: 'no-done' });
  assert.equal(r2.status, 200);
  assert.equal(await r2.text(), sseNoDone);

  const history = await (await call('/api/usage/requests?limit=2', { token: key })).json();
  assert.deepEqual(
    history.items.map((i) => [i.status, i.inputTokens, i.outputTokens, i.estimated]),
    [
      ['success', 2, 3, false],
      ['success', 4, 5, false],
    ],
  );
});

test('prompt caching bills cached input tokens at 25% Gemini rate for both Chat and Responses APIs', async (t) => {
  const { call, makeKey, use } = await fixture(t, (res, request) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (request.path === '/v1/responses') {
      return res.end(JSON.stringify({
        id: 'resp_cached',
        status: 'completed',
        usage: { input_tokens: 10, output_tokens: 2, input_tokens_details: { cached_tokens: 4 } },
      }));
    }
    return res.end(JSON.stringify({
      choices: [{ message: { content: 'cached' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 8 } },
    }));
  });
  const { key } = await makeKey({ quotaMicros: 500 });

  assert.equal((await use(key, {})).status, 200);
  assert.equal((await call('/v1/responses', { token: key, body: { model, input: 'hi' } })).status, 200);

  const history = await (await call('/api/usage/requests?limit=2', { token: key })).json();
  assert.deepEqual(
    history.items.map((i) => [i.inputTokens, i.cachedTokens, i.inputCostMicros, i.outputCostMicros, i.chargedMicros]),
    [
      [10, 4, 14, 6, 20],
      [10, 8, 8, 6, 14],
    ],
  );
  const summary = await (await call('/api/usage', { token: key })).json();
  assert.equal(summary.usedMicros, 34);
});

test('a restarted process recovers a stale reservation once and preserves admin sessions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-test-'));
  const database = join(dir, 'test.sqlite');
  let store = createStore(database);
  try {
    const { key, id } = store.createKey({ name: 'A', quotaMicros: 200, models: null });
    const adminSess = store.createAdminSession(60_000);
    assert.equal(store.hasAdminSession(adminSess), true);
    store.reserve({ keyId: id, model, endpoint: chat, inputReservedMicros: 20, outputReservedMicros: 30, leaseExpiresAt: 1 });
    store.close();
    store = createStore(database);
    assert.equal(store.hasAdminSession(adminSess), true);
    assert.equal(store.findKey(key).usedMicros, 50);
    assert.equal(store.getKey(id).usedMicros, 50);
    assert.equal(store.getKey(id).reservedMicros, 0);
    assert.equal(store.listRequests(id).items[0].estimated, true);
    store.deleteAdminSession(adminSess);
    assert.equal(store.hasAdminSession(adminSess), false);
  } finally {
    store.close();
    for (const filename of readdirSync(dir)) rmSync(join(dir, filename));
    rmdirSync(dir);
  }
});

test('a $1 starter wallet can call high-cap models via bounded reservation without going negative', () => {
  const store = createStore(':memory:');
  try {
    const { id } = store.createKey({ name: 'Starter', quotaMicros: 1_000_000, models: null });
    // Theoretical max reservation = $2.36 (e.g. Claude Opus $8/$40), wallet has $1.00
    const job = store.reserve({
      keyId: id,
      model: 'claude-opus-5-5',
      endpoint: chat,
      inputReservedMicros: 1_048_576,
      outputReservedMicros: 1_310_720,
      leaseExpiresAt: Date.now() + 60_000,
      minReserveMicros: 50_000,
    });
    assert.ok(job.id);
    assert.equal(job.inputReservedMicros + job.outputReservedMicros, 1_000_000);
    // Concurrent call blocked because entire $1.00 is reserved in flight
    assert.deepEqual(
      store.reserve({
        keyId: id,
        model: 'claude-opus-5-5',
        endpoint: chat,
        inputReservedMicros: 1_048_576,
        outputReservedMicros: 1_310_720,
        leaseExpiresAt: Date.now() + 60_000,
        minReserveMicros: 50_000,
      }),
      { error: 'quota_exceeded' },
    );
    // Settle actual small cost ($0.04) -> wallet has $0.96 left
    store.settle(job.id, {
      httpStatus: 200,
      status: 'success',
      inputTokens: 2000,
      outputTokens: 600,
      cachedTokens: 0,
      inputCostMicros: 16_000,
      outputCostMicros: 24_000,
      estimated: false,
    });
    const after = store.getKey(id);
    assert.equal(after.usedMicros, 40_000);
    assert.equal(after.reservedMicros, 0);
    assert.equal(after.remainingMicros, 960_000);

    // Wallet with $0.04 (< $0.05 minReserveMicros) is blocked for high-cap models
    const lowKey = store.createKey({ name: 'Low', quotaMicros: 40_000, models: null });
    assert.deepEqual(
      store.reserve({
        keyId: lowKey.id,
        model: 'claude-opus-5-5',
        endpoint: chat,
        inputReservedMicros: 1_048_576,
        outputReservedMicros: 1_310_720,
        leaseExpiresAt: Date.now() + 60_000,
        minReserveMicros: 50_000,
      }),
      { error: 'quota_exceeded' },
    );
  } finally {
    store.close();
  }
});
