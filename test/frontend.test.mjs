import assert from 'node:assert/strict';
import test from 'node:test';
import { createGateway } from '../src/server.mjs';
import { createStore } from '../src/store.mjs';
import {
  formatMicrosInputValue,
  formatMicrosToUsd,
  formatVnDateTime,
  isChargeCappedByReservation,
  isoUtcToVnInput,
  parseUsdToMicros,
  translateApiError,
  vnInputToIsoUtc,
} from '../frontend/shared/format.js';
import { createMockGateway, MOCK_CREDENTIALS } from '../frontend/mock-gateway.mjs';
import { assertLoopbackHost, createAdminFrontendServer } from '../frontend/server-admin.mjs';
import { createPublicFrontendServer } from '../frontend/server-public.mjs';

async function listenEphemeral(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

test('USD and micros conversion preserves exact precision without float rounding errors', () => {
  assert.deepEqual(parseUsdToMicros('0'), { ok: true, micros: 0 });
  assert.deepEqual(parseUsdToMicros('0.29'), { ok: true, micros: 290_000 });
  assert.deepEqual(parseUsdToMicros('0.000001'), { ok: true, micros: 1 });
  assert.deepEqual(parseUsdToMicros('5.123456'), { ok: true, micros: 5_123_456 });
  assert.deepEqual(parseUsdToMicros('1,25'), { ok: true, micros: 1_250_000 });
  assert.equal(parseUsdToMicros('-1').ok, false);
  assert.equal(parseUsdToMicros('1.1234567').ok, false);
  assert.equal(parseUsdToMicros('abc').ok, false);

  assert.equal(formatMicrosToUsd(0), '$0.00');
  assert.equal(formatMicrosToUsd(1), '$0.000001');
  assert.equal(formatMicrosToUsd(10), '$0.00001');
  assert.equal(formatMicrosToUsd(1_250_000), '$1.25');
  assert.equal(formatMicrosToUsd(null), null);
  assert.equal(formatMicrosInputValue(290_000), '0.29');
  assert.equal(formatMicrosInputValue(5_000_000), '5');
});

test('Vietnam timezone (UTC+7) conversion and reservation cap detection work deterministically', () => {
  const utcResult = vnInputToIsoUtc('2026-12-01T17:30');
  assert.deepEqual(utcResult, { ok: true, value: '2026-12-01T10:30:00.000Z' });
  assert.equal(isoUtcToVnInput('2026-12-01T10:30:00.000Z'), '2026-12-01T17:30');
  assert.equal(vnInputToIsoUtc('2026-02-31T10:00').ok, false);
  assert.match(formatVnDateTime('2026-12-01T10:30:00.000Z'), /17:30:00/);

  assert.equal(
    isChargeCappedByReservation({ inputCostMicros: 55_500, outputCostMicros: 93_000, chargedMicros: 120_000 }),
    true,
  );
  assert.equal(
    isChargeCappedByReservation({ inputCostMicros: 300, outputCostMicros: 1_250, chargedMicros: 1_550 }),
    false,
  );
  assert.equal(
    isChargeCappedByReservation({ inputCostMicros: null, outputCostMicros: null, chargedMicros: null }),
    false,
  );

  assert.equal(translateApiError({ error: { code: 'key_disabled' } }, 401).code, 'key_disabled');
  assert.equal(translateApiError({ error: { code: 'quota_below_usage' } }, 409).code, 'quota_below_usage');
});

test('Admin server enforces loopback-only binding', () => {
  assert.doesNotThrow(() => assertLoopbackHost('127.0.0.1'));
  assert.doesNotThrow(() => assertLoopbackHost('::1'));
  assert.throws(() => assertLoopbackHost('0.0.0.0'), /loopback only/i);
  assert.throws(() => assertLoopbackHost('192.168.1.10'), /loopback only/i);
});

test('Public origin strictly isolates /usage and blocks all admin UI, assets, and admin APIs with 404', async () => {
  const mock = createMockGateway();
  const mockOrigin = await listenEphemeral(mock);
  const publicServer = createPublicFrontendServer({ gatewayOrigin: mockOrigin });
  const publicOrigin = await listenEphemeral(publicServer);

  try {
    // Allowed public HTML & assets
    for (const path of [
      '/',
      '/sign-in',
      '/sign-up',
      '/console',
      '/usage',
      '/docs',
      '/docs/',
      '/assets/passport.css',
      '/assets/landing.js',
      '/assets/auth.js',
      '/assets/console.js',
      '/assets/docs.js',
      '/assets/format.js',
      '/usage/assets/passport.css',
      '/usage/assets/usage.css',
      '/usage/assets/usage.js',
      '/usage/assets/format.js',
    ]) {
      const res = await fetch(`${publicOrigin}${path}`);
      assert.equal(res.status, 200, `Expected 200 for ${path}`);
    }

    // Blocked routes MUST return 404 on public origin
    const blockedPaths = [
      '/admin',
      '/admin/',
      '/admin/assets/admin.js',
      '/admin/assets/admin.css',
      '/admin/v1/keys',
      '/admin/v1/models',
      '/admin/v1/users',
      '/healthz',
      '/dashboard',
    ];
    for (const path of blockedPaths) {
      const res = await fetch(`${publicOrigin}${path}`, {
        headers: { Authorization: `Bearer ${MOCK_CREDENTIALS.adminToken}` },
      });
      assert.equal(res.status, 404, `Expected 404 on public origin for ${path}`);
    }

    // Invalid key -> 401 invalid_key + Cache-Control: no-store
    const badKeyRes = await fetch(`${publicOrigin}/api/usage`, {
      headers: { Authorization: 'Bearer gw_invalid_demo' },
    });
    assert.equal(badKeyRes.status, 401);
    assert.equal(badKeyRes.headers.get('cache-control'), 'no-store');
    assert.equal((await badKeyRes.json()).error.code, 'invalid_key');

    // Disabled key -> 401 key_disabled
    const disabledRes = await fetch(`${publicOrigin}/api/usage`, {
      headers: { Authorization: `Bearer ${MOCK_CREDENTIALS.disabledKey}` },
    });
    assert.equal(disabledRes.status, 401);
    assert.equal((await disabledRes.json()).error.code, 'key_disabled');

    // Expired key -> still readable on /api/usage
    const expiredRes = await fetch(`${publicOrigin}/api/usage`, {
      headers: { Authorization: `Bearer ${MOCK_CREDENTIALS.expiredKey}` },
    });
    assert.equal(expiredRes.status, 200);
    assert.equal((await expiredRes.json()).status, 'expired');

    // Exhausted key -> still readable on /api/usage with remainingMicros === 0
    const exhaustedRes = await fetch(`${publicOrigin}/api/usage`, {
      headers: { Authorization: `Bearer ${MOCK_CREDENTIALS.exhaustedKey}` },
    });
    assert.equal(exhaustedRes.status, 200);
    const exhausted = await exhaustedRes.json();
    assert.equal(exhausted.status, 'exhausted');
    assert.equal(exhausted.remainingMicros, 0);

    // Empty history key
    const emptyHistRes = await fetch(`${publicOrigin}/api/usage/requests?limit=25`, {
      headers: { Authorization: `Bearer ${MOCK_CREDENTIALS.emptyKey}` },
    });
    assert.equal(emptyHistRes.status, 200);
    assert.deepEqual(await emptyHistRes.json(), { items: [], nextCursor: null });

    // Multi-page pagination & edge-case requests on active key
    const page1Res = await fetch(`${publicOrigin}/api/usage/requests?limit=25`, {
      headers: { Authorization: `Bearer ${MOCK_CREDENTIALS.activeKey}` },
    });
    assert.equal(page1Res.status, 200);
    assert.equal(page1Res.headers.get('cache-control'), 'no-store');
    const page1 = await page1Res.json();
    assert.equal(page1.items.length, 25);
    assert.ok(Number.isSafeInteger(page1.nextCursor));
    assert.equal(page1.items[0].status, 'pending');
    assert.equal(page1.items[0].chargedMicros, null);
    assert.equal(isChargeCappedByReservation(page1.items[1]), true);
    assert.equal(page1.items[2].status, 'usage_missing');
    assert.equal(page1.items[2].estimated, true);
    assert.equal(page1.items[4].status, 'upstream_error');
    assert.equal(page1.items[4].chargedMicros, 0);

    const page2Res = await fetch(`${publicOrigin}/api/usage/requests?limit=25&before=${page1.nextCursor}`, {
      headers: { Authorization: `Bearer ${MOCK_CREDENTIALS.activeKey}` },
    });
    assert.equal(page2Res.status, 200);
    const page2 = await page2Res.json();
    assert.equal(page2.items.length, 5);
    assert.equal(page2.nextCursor, null);
  } finally {
    await closeServer(publicServer);
    await closeServer(mock);
  }
});

test('Private admin origin supports full key lifecycle, 401 re-auth, 409 quota floor, and 204 disable', async () => {
  const mock = createMockGateway();
  const mockOrigin = await listenEphemeral(mock);
  const adminServer = createAdminFrontendServer({ gatewayOrigin: mockOrigin });
  const adminOrigin = await listenEphemeral(adminServer);

  try {
    // Admin assets served with no-store; public /usage blocked with 404
    const indexRes = await fetch(`${adminOrigin}/`);
    assert.equal(indexRes.status, 200);
    assert.equal(indexRes.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(`${adminOrigin}/usage`)).status, 404);

    // Wrong admin token -> 401 admin_required
    const unauthRes = await fetch(`${adminOrigin}/admin/v1/keys`, {
      headers: { Authorization: 'Bearer wrong_token' },
    });
    assert.equal(unauthRes.status, 401);
    assert.equal((await unauthRes.json()).error.code, 'admin_required');

    const authHeaders = {
      Authorization: `Bearer ${MOCK_CREDENTIALS.adminToken}`,
      'Content-Type': 'application/json',
    };

    // Fetch models catalog
    const modelsRes = await fetch(`${adminOrigin}/admin/v1/models`, { headers: authHeaders });
    assert.equal(modelsRes.status, 200);
    const models = await modelsRes.json();
    assert.ok(models.items.length >= 3);

    // Create key -> 201 returns full one-time key
    const createRes = await fetch(`${adminOrigin}/admin/v1/keys`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Bạn Test UI',
        quotaMicros: 2_500_000,
        expiresAt: '2026-12-31T16:59:00.000Z',
        models: ['ag/gemini-3.8-flash'],
      }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.ok(created.key.startsWith('gw_'));
    assert.equal(created.keyPrefix, created.key.slice(0, 11));

    // Listing keys never returns full secret key again
    const listRes = await fetch(`${adminOrigin}/admin/v1/keys`, { headers: authHeaders });
    const list = await listRes.json();
    const listed = list.items.find((k) => k.id === created.id);
    assert.ok(listed);
    assert.equal(listed.key, undefined);
    assert.equal(listed.keyPrefix, created.keyPrefix);

    // PATCH update key name & models
    const patchRes = await fetch(`${adminOrigin}/admin/v1/keys/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Bạn Test UI Updated', models: null }),
    });
    assert.equal(patchRes.status, 200);
    const patched = await patchRes.json();
    assert.equal(patched.name, 'Bạn Test UI Updated');
    assert.equal(patched.models, null);

    // PATCH quota below used+reserved -> 409 quota_below_usage
    const activeKeyId = '11111111-1111-4111-8111-111111111111';
    const lowQuotaRes = await fetch(`${adminOrigin}/admin/v1/keys/${activeKeyId}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ quotaMicros: 1 }),
    });
    assert.equal(lowQuotaRes.status, 409);
    assert.equal((await lowQuotaRes.json()).error.code, 'quota_below_usage');

    // DELETE disables key with 204 empty body; history stays viewable
    const delRes = await fetch(`${adminOrigin}/admin/v1/keys/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${MOCK_CREDENTIALS.adminToken}` },
    });
    assert.equal(delRes.status, 204);
    assert.equal(await delRes.text(), '');

    const afterDel = await (await fetch(`${adminOrigin}/admin/v1/keys/${created.id}`, { headers: authHeaders })).json();
    assert.equal(afterDel.enabled, false);
    assert.equal(afterDel.status, 'disabled');

    // Re-enable via PATCH enabled: true
    const reenableRes = await fetch(`${adminOrigin}/admin/v1/keys/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(reenableRes.status, 200);
    assert.equal((await reenableRes.json()).enabled, true);
  } finally {
    await closeServer(adminServer);
    await closeServer(mock);
  }
});

test('Full user registration, login, shared-wallet multi-key console, key copy secret, and admin user controls', async () => {
  const adminToken = 'test_admin_token_32_characters_minimum_0001';
  const store = createStore(':memory:', { encryptionSecret: adminToken });
  const gateway = createGateway({
    config: {
      adminToken,
      adminUsername: 'admin',
      adminPassword: 'TestAdminPass@2026',
      routerApiKey: 'test_router_key',
      routerOrigin: 'http://127.0.0.1:1',
      models: new Map([
        [
          'ag/gemini-3.8-flash',
          {
            id: 'ag/gemini-3.8-flash',
            inputMicrosPerMillion: 300_000,
            outputMicrosPerMillion: 2_500_000,
            maxInputTokens: 32_768,
            maxOutputTokens: 4_096,
            chatOutputLimitField: 'max_tokens',
          },
        ],
      ]),
      upstreamTimeoutMs: 5_000,
      maxBodyBytes: 1_048_576,
      defaultUserQuotaMicros: 1_000_000,
      maxKeysPerUser: 2,
      sessionTtlMs: 3_600_000,
      inviteCode: null,
    },
    store,
  });

  const gwOrigin = await listenEphemeral(gateway);
  const publicServer = createPublicFrontendServer({ gatewayOrigin: gwOrigin });
  const adminServer = createAdminFrontendServer({ gatewayOrigin: gwOrigin });
  const publicOrigin = await listenEphemeral(publicServer);
  const adminOrigin = await listenEphemeral(adminServer);

  try {
    // Public model catalog
    const pubModelsRes = await fetch(`${publicOrigin}/api/public/models`);
    assert.equal(pubModelsRes.status, 200);
    const pubModels = await pubModelsRes.json();
    assert.equal(pubModels.items[0].id, 'ag/gemini-3.8-flash');
    assert.equal(pubModels.defaultUserQuotaMicros, 1_000_000);

    // Register user -> 201 + HttpOnly cookie
    const regRes = await fetch(`${publicOrigin}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'minh_dev',
        email: 'minh@example.com',
        password: 'StrongPassword123!',
      }),
    });
    assert.equal(regRes.status, 201);
    const setCookie = regRes.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /tc_session=sess_/);
    assert.match(setCookie, /HttpOnly/i);
    const sessionCookie = setCookie.split(';')[0];
    const regData = await regRes.json();
    assert.equal(regData.user.username, 'minh_dev');
    assert.equal(regData.user.quotaMicros, 1_000_000);
    assert.equal(regData.user.remainingMicros, 1_000_000);

    // Duplicate username -> 409
    const dupRes = await fetch(`${publicOrigin}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'minh_dev',
        email: 'other@example.com',
        password: 'StrongPassword123!',
      }),
    });
    assert.equal(dupRes.status, 409);
    assert.equal((await dupRes.json()).error.code, 'username_taken');

    // User creates 2 keys WITHOUT specifying per-key quota — both share the $1.00 account wallet!
    const key1Res = await fetch(`${publicOrigin}/api/console/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({
        name: 'Cursor Work',
        expiresAt: null,
        models: ['ag/gemini-3.8-flash'],
      }),
    });
    assert.equal(key1Res.status, 201);
    const key1 = await key1Res.json();
    assert.ok(key1.key.startsWith('gw_'));
    assert.equal(key1.canCopy, true);
    assert.equal(key1.remainingMicros, 1_000_000);

    const key2Res = await fetch(`${publicOrigin}/api/console/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({
        name: 'Roo Code Laptop',
        expiresAt: null,
        models: null,
      }),
    });
    assert.equal(key2Res.status, 201);
    const key2 = await key2Res.json();
    assert.equal(key2.remainingMicros, 1_000_000);

    // 3rd key exceeds maxKeysPerUser (2) -> 409 max_keys_reached
    const key3Res = await fetch(`${publicOrigin}/api/console/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({ name: 'Extra Key', expiresAt: null, models: null }),
    });
    assert.equal(key3Res.status, 409);
    assert.equal((await key3Res.json()).error.code, 'max_keys_reached');

    // Owner can copy exact key secret via GET /api/console/keys/:id/secret
    const secretRes = await fetch(`${publicOrigin}/api/console/keys/${key1.id}/secret`, {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(secretRes.status, 200);
    assert.equal((await secretRes.json()).key, key1.key);

    // Spend $0.70 on key1 -> BOTH key1 and key2 immediately see $0.30 remaining in shared wallet!
    const job = store.reserve({
      keyId: key1.id,
      model: 'ag/gemini-3.8-flash',
      endpoint: '/v1/chat/completions',
      inputReservedMicros: 350_000,
      outputReservedMicros: 350_000,
      leaseExpiresAt: Date.now() + 60_000,
    });
    assert.ok(job.id);
    store.settle(job.id, {
      httpStatus: 200,
      status: 'success',
      inputTokens: 1000,
      outputTokens: 1000,
      inputCostMicros: 350_000,
      outputCostMicros: 350_000,
      estimated: false,
    });

    const usage1 = await (await fetch(`${publicOrigin}/api/usage`, { headers: { Authorization: `Bearer ${key1.key}` } })).json();
    const usage2 = await (await fetch(`${publicOrigin}/api/usage`, { headers: { Authorization: `Bearer ${key2.key}` } })).json();
    assert.equal(usage1.remainingMicros, 300_000);
    assert.equal(usage2.remainingMicros, 300_000);
    assert.equal(usage1.usedMicros, 700_000);
    assert.equal(usage2.usedMicros, 0);

    // Key2 trying to reserve $0.40 fails with quota_exceeded because shared wallet only has $0.30 left!
    const blockedReserve = store.reserve({
      keyId: key2.id,
      model: 'ag/gemini-3.8-flash',
      endpoint: '/v1/chat/completions',
      inputReservedMicros: 200_000,
      outputReservedMicros: 200_000,
      leaseExpiresAt: Date.now() + 60_000,
    });
    assert.deepEqual(blockedReserve, { error: 'quota_exceeded' });

    // Admin lists users, rejects lowering below spent ($0.70), and tops up to $5.00 -> unlocks both keys immediately!
    const adminHeaders = {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    };
    const usersList = await (await fetch(`${adminOrigin}/admin/v1/users`, { headers: adminHeaders })).json();
    assert.equal(usersList.items.length, 1);
    assert.equal(usersList.items[0].remainingMicros, 300_000);

    const badLowerRes = await fetch(`${adminOrigin}/admin/v1/users/${regData.user.id}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ quotaMicros: 500_000 }),
    });
    assert.equal(badLowerRes.status, 409);
    assert.equal((await badLowerRes.json()).error.code, 'quota_below_usage');

    const topupRes = await fetch(`${adminOrigin}/admin/v1/users/${regData.user.id}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ quotaMicros: 5_000_000 }),
    });
    assert.equal(topupRes.status, 200);
    assert.equal((await topupRes.json()).remainingMicros, 4_300_000);

    const usage2AfterTopup = await (await fetch(`${publicOrigin}/api/usage`, { headers: { Authorization: `Bearer ${key2.key}` } })).json();
    assert.equal(usage2AfterTopup.remainingMicros, 4_300_000);

    // Logout revokes session
    const logoutRes = await fetch(`${publicOrigin}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: sessionCookie },
    });
    assert.equal(logoutRes.status, 204);
    assert.equal((await fetch(`${publicOrigin}/api/auth/me`, { headers: { Cookie: sessionCookie } })).status, 401);

    // Login again with email works
    const loginRes = await fetch(`${publicOrigin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'minh@example.com', password: 'StrongPassword123!' }),
    });
    assert.equal(loginRes.status, 200);
    const loginCookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0];

    // Admin disables user -> immediately invalidates session & blocks login
    const disableUserRes = await fetch(`${adminOrigin}/admin/v1/users/${regData.user.id}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(disableUserRes.status, 200);
    assert.equal((await fetch(`${publicOrigin}/api/auth/me`, { headers: { Cookie: loginCookie } })).status, 401);
    const blockedLogin = await fetch(`${publicOrigin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'minh_dev', password: 'StrongPassword123!' }),
    });
    assert.equal(blockedLogin.status, 403);
    assert.equal((await blockedLogin.json()).error.code, 'account_disabled');

    // Admin username/password login & cookie session flow
    const badAdminLogin = await fetch(`${adminOrigin}/admin/v1/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    });
    assert.equal(badAdminLogin.status, 401);

    const okAdminLogin = await fetch(`${adminOrigin}/admin/v1/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'TestAdminPass@2026' }),
    });
    assert.equal(okAdminLogin.status, 200);
    const adminCookie = (okAdminLogin.headers.get('set-cookie') ?? '').split(';')[0];
    assert.match(adminCookie, /^tc_admin_session=adm_/);

    const cookieUsersRes = await fetch(`${adminOrigin}/admin/v1/users`, {
      headers: { Cookie: adminCookie },
    });
    assert.equal(cookieUsersRes.status, 200);

    const adminLogoutRes = await fetch(`${adminOrigin}/admin/v1/logout`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    assert.equal(adminLogoutRes.status, 204);
    assert.equal((await fetch(`${adminOrigin}/admin/v1/users`, { headers: { Cookie: adminCookie } })).status, 401);
  } finally {
    await closeServer(publicServer);
    await closeServer(adminServer);
    await closeServer(gateway);
    store.close();
  }
});
