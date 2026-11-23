import { readFileSync } from 'node:fs';

function integer(value, name, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function secret(value, name, minLength) {
  if (typeof value !== 'string' || value.length < minLength || !/^[\x21-\x7e]+$/.test(value)) {
    throw new Error(`${name} must contain at least ${minLength} printable non-space characters`);
  }
  return value;
}

function upstreamOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('ROUTER_BASE_URL must be a valid HTTP(S) address');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.search || url.hash || !['/', '/v1', '/v1/'].includes(url.pathname)) {
    throw new Error('ROUTER_BASE_URL must be an HTTP(S) origin with an optional /v1 suffix');
  }
  return url.origin;
}

function readModels(filename) {
  let source;
  try {
    source = readFileSync(filename, 'utf8');
  } catch (error) {
    throw new Error(error.code === 'ENOENT' ? 'MODELS_FILE does not exist' : 'Could not read MODELS_FILE');
  }
  let entries;
  try {
    entries = JSON.parse(source.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('MODELS_FILE must contain valid JSON');
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('MODELS_FILE must be a non-empty array of model configurations');
  }

  const models = new Map();
  for (const model of entries) {
    if (!model || typeof model.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(model.id)
      || models.has(model.id)) {
      throw new Error('Every model must have a unique, valid id');
    }
    const limits = {
      inputMicrosPerMillion: model.inputMicrosPerMillion,
      outputMicrosPerMillion: model.outputMicrosPerMillion,
      maxInputTokens: model.maxInputTokens,
      maxOutputTokens: model.maxOutputTokens,
    };
    for (const [name, value] of Object.entries(limits)) {
      const maximum = name.endsWith('Tokens') ? 10_000_000 : 1_000_000_000_000;
      if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
        throw new Error(`Invalid ${name} in MODELS_FILE for ${model.id}`);
      }
    }
    const chatOutputLimitField = model.chatOutputLimitField ?? 'max_tokens';
    if (!['max_tokens', 'max_completion_tokens'].includes(chatOutputLimitField)) {
      throw new Error(`Invalid chatOutputLimitField in MODELS_FILE for ${model.id}`);
    }
    const cachedInputMicrosPerMillion = model.cachedInputMicrosPerMillion ?? Math.round(limits.inputMicrosPerMillion * 0.25);
    if (!Number.isSafeInteger(cachedInputMicrosPerMillion) || cachedInputMicrosPerMillion < 0 || cachedInputMicrosPerMillion > 1_000_000_000_000) {
      throw new Error(`Invalid cachedInputMicrosPerMillion in MODELS_FILE for ${model.id}`);
    }
    models.set(model.id, { id: model.id, ...limits, cachedInputMicrosPerMillion, chatOutputLimitField });
  }
  return models;
}

export function loadConfig(env = process.env) {
  const adminToken = secret(env.ADMIN_TOKEN, 'ADMIN_TOKEN', 32);
  const routerApiKey = secret(env.ROUTER_API_KEY, 'ROUTER_API_KEY', 1);
  if (adminToken === routerApiKey) throw new Error('ADMIN_TOKEN and ROUTER_API_KEY must be distinct');

  const inviteCode = typeof env.INVITE_CODE === 'string' && env.INVITE_CODE.trim()
    ? env.INVITE_CODE.trim()
    : null;
  const adminUsername = typeof env.ADMIN_USERNAME === 'string' && env.ADMIN_USERNAME.trim()
    ? env.ADMIN_USERNAME.trim()
    : 'admin';
  const adminPassword = typeof env.ADMIN_PASSWORD === 'string' && env.ADMIN_PASSWORD.length >= 6
    ? env.ADMIN_PASSWORD
    : null;

  return {
    host: env.HOST ?? '127.0.0.1',
    port: integer(env.PORT ?? '20129', 'PORT', 1, 65535),
    adminToken,
    adminUsername,
    adminPassword,
    routerApiKey,
    routerOrigin: upstreamOrigin(env.ROUTER_BASE_URL ?? 'http://127.0.0.1:20128'),
    databasePath: env.DB_PATH ?? './data/gateway.sqlite',
    models: readModels(env.MODELS_FILE ?? './models.json'),
    upstreamTimeoutMs: integer(env.UPSTREAM_TIMEOUT_MS ?? '600000', 'UPSTREAM_TIMEOUT_MS', 1000, 600_000),
    maxBodyBytes: integer(env.MAX_BODY_BYTES ?? '16777216', 'MAX_BODY_BYTES', 1024, 52_428_800),
    defaultUserQuotaMicros: integer(
      env.DEFAULT_USER_QUOTA_MICROS ?? '1000000',
      'DEFAULT_USER_QUOTA_MICROS',
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    maxKeysPerUser: integer(env.MAX_KEYS_PER_USER ?? '5', 'MAX_KEYS_PER_USER', 1, 100),
    sessionTtlMs: integer(env.SESSION_TTL_HOURS ?? '168', 'SESSION_TTL_HOURS', 1, 720) * 3_600_000,
    inviteCode,
  };
}
