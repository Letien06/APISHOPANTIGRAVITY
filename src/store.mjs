import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { chmodSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const digest = (secret) => createHash('sha256').update(secret).digest('hex')
const nowIso = () => new Date().toISOString()
const VN_OFFSET_MS = 7 * 60 * 60 * 1000
const BACKUP_FILE_RE = /^gateway-backup-[A-Za-z0-9_-]+\.sqlite$/

function deriveVaultKey(encryptionSecret) {
  if (typeof encryptionSecret !== 'string' || !encryptionSecret) return null
  return createHash('sha256').update(`tiencoder-key-vault:${encryptionSecret}`).digest()
}

function encryptSecret(plaintext, vaultKey) {
  if (!vaultKey) return null
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', vaultKey, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`
}

function decryptSecret(payload, vaultKey) {
  if (!vaultKey || typeof payload !== 'string' || !payload.startsWith('v1:')) return null
  const parts = payload.split(':')
  if (parts.length !== 4) return null
  try {
    const iv = Buffer.from(parts[1], 'base64url')
    const tag = Buffer.from(parts[2], 'base64url')
    const encrypted = Buffer.from(parts[3], 'base64url')
    const decipher = createDecipheriv('aes-256-gcm', vaultKey, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const derived = scryptSync(password, salt, 64).toString('hex')
  return `scrypt$${salt}$${derived}`
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const [, salt, expectedHex] = parts
  const derived = scryptSync(password, salt, 64)
  const expected = Buffer.from(expectedHex, 'hex')
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

function describeRequest(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    model: row.model,
    endpoint: row.endpoint,
    httpStatus: row.http_status,
    status: row.status,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cachedTokens: row.cached_tokens ?? null,
    inputCostMicros: row.input_cost_micros,
    outputCostMicros: row.output_cost_micros,
    chargedMicros: row.charged_micros,
    estimated: Boolean(row.estimated),
  }
}

function storeError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function describeTransaction(row) {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username ?? null,
    email: row.email ?? null,
    deltaMicros: row.delta_micros,
    balanceAfterMicros: row.balance_after_micros,
    type: row.type,
    note: row.note ?? null,
    refCode: row.ref_code ?? null,
    createdAt: row.created_at,
  }
}

function describeGiftcode(row) {
  let status = 'active'
  if (!row.enabled) status = 'disabled'
  else if (row.expires_at !== null && Date.parse(row.expires_at) <= Date.now()) status = 'expired'
  else if (row.used_count >= row.max_uses) status = 'exhausted'
  return {
    id: row.id,
    code: row.code,
    amountMicros: row.amount_micros,
    maxUses: row.max_uses,
    usedCount: row.used_count,
    enabled: Boolean(row.enabled),
    expiresAt: row.expires_at,
    note: row.note ?? null,
    createdAt: row.created_at,
    status,
  }
}

function toVnDateKey(ms) {
  const vn = new Date(ms + VN_OFFSET_MS)
  const y = vn.getUTCFullYear()
  const m = String(vn.getUTCMonth() + 1).padStart(2, '0')
  const d = String(vn.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function vnDayStartUtcIso(vnDateKey) {
  const [y, m, d] = vnDateKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - VN_OFFSET_MS).toISOString()
}

function formatBackupStamp(ms) {
  const vn = new Date(ms + VN_OFFSET_MS)
  const y = vn.getUTCFullYear()
  const m = String(vn.getUTCMonth() + 1).padStart(2, '0')
  const d = String(vn.getUTCDate()).padStart(2, '0')
  const hh = String(vn.getUTCHours()).padStart(2, '0')
  const mm = String(vn.getUTCMinutes()).padStart(2, '0')
  const ss = String(vn.getUTCSeconds()).padStart(2, '0')
  return `${y}${m}${d}-${hh}${mm}${ss}`
}

export function createStore(databasePath, { encryptionSecret = null } = {}) {
  const db = new DatabaseSync(databasePath)
  const vaultKey = deriveVaultKey(encryptionSecret)

  function transaction(operation) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  try {
    db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS gateway_users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        quota_micros INTEGER NOT NULL DEFAULT 1000000 CHECK (quota_micros >= 0),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS gateway_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES gateway_users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS gateway_sessions_user ON gateway_sessions(user_id);
      CREATE TABLE IF NOT EXISTS admin_sessions (
        token_hash TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS gateway_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES gateway_users(id),
        name TEXT NOT NULL,
        secret_hash TEXT NOT NULL UNIQUE,
        encrypted_secret TEXT,
        key_prefix TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        expires_at TEXT,
        models TEXT NOT NULL,
        quota_micros INTEGER NOT NULL CHECK (quota_micros >= 0),
        used_micros INTEGER NOT NULL DEFAULT 0 CHECK (used_micros >= 0),
        reserved_micros INTEGER NOT NULL DEFAULT 0 CHECK (reserved_micros >= 0),
        request_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS gateway_requests (
        id INTEGER PRIMARY KEY,
        key_id TEXT NOT NULL REFERENCES gateway_keys(id),
        model TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'success', 'upstream_error', 'transport_error', 'usage_missing')),
        http_status INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cached_tokens INTEGER,
        input_cost_micros INTEGER,
        output_cost_micros INTEGER,
        charged_micros INTEGER,
        estimated INTEGER NOT NULL DEFAULT 0 CHECK (estimated IN (0, 1)),
        input_reserved_micros INTEGER NOT NULL CHECK (input_reserved_micros >= 0),
        output_reserved_micros INTEGER NOT NULL CHECK (output_reserved_micros >= 0),
        lease_expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        finished_at TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS gateway_requests_key_cursor ON gateway_requests(key_id, id DESC);
      CREATE INDEX IF NOT EXISTS gateway_requests_created_at ON gateway_requests(created_at DESC);
      CREATE INDEX IF NOT EXISTS gateway_requests_lease ON gateway_requests(lease_expires_at)
        WHERE status = 'pending';
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id INTEGER PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES gateway_users(id) ON DELETE CASCADE,
        delta_micros INTEGER NOT NULL,
        balance_after_micros INTEGER NOT NULL CHECK (balance_after_micros >= 0),
        type TEXT NOT NULL CHECK (type IN ('signup_bonus', 'admin_adjust', 'giftcode')),
        note TEXT,
        ref_code TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS wallet_tx_user_cursor ON wallet_transactions(user_id, id DESC);
      CREATE TABLE IF NOT EXISTS giftcodes (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        amount_micros INTEGER NOT NULL CHECK (amount_micros > 0),
        max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
        used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        expires_at TEXT,
        note TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS giftcode_redemptions (
        id INTEGER PRIMARY KEY,
        giftcode_id TEXT NOT NULL REFERENCES giftcodes(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES gateway_users(id) ON DELETE CASCADE,
        amount_micros INTEGER NOT NULL CHECK (amount_micros > 0),
        created_at TEXT NOT NULL,
        UNIQUE(giftcode_id, user_id)
      ) STRICT;
    `)

    // Migrate existing databases cleanly
    const keyColumns = db.prepare('PRAGMA table_info(gateway_keys)').all()
    if (!keyColumns.some((col) => col.name === 'user_id')) {
      db.exec('ALTER TABLE gateway_keys ADD COLUMN user_id TEXT REFERENCES gateway_users(id)')
    }
    if (!keyColumns.some((col) => col.name === 'encrypted_secret')) {
      db.exec('ALTER TABLE gateway_keys ADD COLUMN encrypted_secret TEXT')
    }
    const reqColumns = db.prepare('PRAGMA table_info(gateway_requests)').all()
    if (!reqColumns.some((col) => col.name === 'cached_tokens')) {
      db.exec('ALTER TABLE gateway_requests ADD COLUMN cached_tokens INTEGER')
    }
    db.exec('CREATE INDEX IF NOT EXISTS gateway_keys_user ON gateway_keys(user_id)')

    const getKeyRow = db.prepare('SELECT * FROM gateway_keys WHERE id = ?')
    const listKeyRows = db.prepare('SELECT * FROM gateway_keys ORDER BY created_at DESC, id DESC')
    const listUserKeyRows = db.prepare('SELECT * FROM gateway_keys WHERE user_id = ? ORDER BY created_at DESC, id DESC')
    const findKeyRow = db.prepare('SELECT * FROM gateway_keys WHERE secret_hash = ?')
    const insertKey = db.prepare(`
      INSERT INTO gateway_keys (id, user_id, name, secret_hash, encrypted_secret, key_prefix, expires_at, models, quota_micros, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
    `)
    const writeKey = db.prepare(`
      UPDATE gateway_keys SET name = ?, quota_micros = ?, expires_at = ?, models = ?, enabled = ?
      WHERE id = ? RETURNING *
    `)
    const insertRequest = db.prepare(`
      INSERT INTO gateway_requests (
        key_id, model, endpoint, input_reserved_micros, output_reserved_micros, lease_expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id
    `)
    const reserveOnKey = db.prepare(`
      UPDATE gateway_keys SET reserved_micros = reserved_micros + ?, request_count = request_count + 1
      WHERE id = ?
    `)
    const chargeKey = db.prepare(`
      UPDATE gateway_keys SET reserved_micros = reserved_micros - ?, used_micros = used_micros + ?
      WHERE id = ?
    `)
    const completeRequest = db.prepare(`
      UPDATE gateway_requests SET http_status = ?, status = ?, input_tokens = ?, output_tokens = ?, cached_tokens = ?,
        input_cost_micros = ?, output_cost_micros = ?,
        charged_micros = MIN(? + ?, input_reserved_micros + output_reserved_micros),
        estimated = ?, finished_at = ?
      WHERE id = ? AND status = 'pending'
      RETURNING key_id, input_reserved_micros, output_reserved_micros, charged_micros
    `)
    const hasStaleRequests = db.prepare(`
      SELECT 1 FROM gateway_requests WHERE status = 'pending' AND lease_expires_at <= ? LIMIT 1
    `)
    const recoverStaleRequests = db.prepare(`
      UPDATE gateway_requests SET status = 'transport_error', input_cost_micros = input_reserved_micros,
        output_cost_micros = output_reserved_micros,
        charged_micros = input_reserved_micros + output_reserved_micros, estimated = 1, finished_at = ?
      WHERE status = 'pending' AND lease_expires_at <= ?
      RETURNING key_id, input_reserved_micros, output_reserved_micros
    `)
    const latestRequests = db.prepare(`
      SELECT * FROM gateway_requests WHERE key_id = ? ORDER BY id DESC LIMIT ?
    `)
    const earlierRequests = db.prepare(`
      SELECT * FROM gateway_requests WHERE key_id = ? AND id < ? ORDER BY id DESC LIMIT ?
    `)
    const countKeyRequests = db.prepare(`
      SELECT COUNT(*) AS total FROM gateway_requests WHERE key_id = ?
    `)
    const latestAllRequests = db.prepare(`
      SELECT r.*, k.name AS key_name, k.key_prefix AS key_prefix, u.username AS username
      FROM gateway_requests r
      LEFT JOIN gateway_keys k ON k.id = r.key_id
      LEFT JOIN gateway_users u ON u.id = k.user_id
      ORDER BY r.id DESC LIMIT ?
    `)
    const earlierAllRequests = db.prepare(`
      SELECT r.*, k.name AS key_name, k.key_prefix AS key_prefix, u.username AS username
      FROM gateway_requests r
      LEFT JOIN gateway_keys k ON k.id = r.key_id
      LEFT JOIN gateway_users u ON u.id = k.user_id
      WHERE r.id < ?
      ORDER BY r.id DESC LIMIT ?
    `)
    const countAllRequests = db.prepare(`
      SELECT COUNT(*) AS total FROM gateway_requests
    `)

    // User & session prepared statements
    const getUserById = db.prepare('SELECT * FROM gateway_users WHERE id = ?')
    const getUserByUsername = db.prepare('SELECT * FROM gateway_users WHERE username = ?')
    const getUserByEmail = db.prepare('SELECT * FROM gateway_users WHERE email = ?')
    const listUserRows = db.prepare('SELECT * FROM gateway_users ORDER BY created_at DESC, id DESC')
    const insertUser = db.prepare(`
      INSERT INTO gateway_users (id, username, email, password_hash, quota_micros, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?) RETURNING *
    `)
    const writeUser = db.prepare(`
      UPDATE gateway_users SET quota_micros = ?, enabled = ? WHERE id = ? RETURNING *
    `)
    const writeUserPassword = db.prepare(`
      UPDATE gateway_users SET password_hash = ? WHERE id = ? RETURNING *
    `)
    const removeOtherUserSessions = db.prepare(`
      DELETE FROM gateway_sessions WHERE user_id = ? AND token_hash != ?
    `)
    const insertWalletTx = db.prepare(`
      INSERT INTO wallet_transactions (user_id, delta_micros, balance_after_micros, type, note, ref_code, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *
    `)
    const insertGiftcode = db.prepare(`
      INSERT INTO giftcodes (id, code, amount_micros, max_uses, used_count, enabled, expires_at, note, created_at)
      VALUES (?, ?, ?, ?, 0, 1, ?, ?, ?) RETURNING *
    `)
    const listGiftcodeRows = db.prepare('SELECT * FROM giftcodes ORDER BY created_at DESC, id DESC')
    const getGiftcodeById = db.prepare('SELECT * FROM giftcodes WHERE id = ?')
    const getGiftcodeByCode = db.prepare('SELECT * FROM giftcodes WHERE code = ?')
    const writeGiftcode = db.prepare(`
      UPDATE giftcodes SET enabled = ?, max_uses = ?, expires_at = ?, note = ? WHERE id = ? RETURNING *
    `)
    const incrementGiftcodeUse = db.prepare(`
      UPDATE giftcodes SET used_count = used_count + 1 WHERE id = ? RETURNING *
    `)
    const findRedemption = db.prepare(`
      SELECT id FROM giftcode_redemptions WHERE giftcode_id = ? AND user_id = ?
    `)
    const insertRedemption = db.prepare(`
      INSERT INTO giftcode_redemptions (giftcode_id, user_id, amount_micros, created_at)
      VALUES (?, ?, ?, ?)
    `)
    const userKeyAggregates = db.prepare(`
      SELECT
        COUNT(*) AS key_count,
        COALESCE(SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END), 0) AS active_key_count,
        COALESCE(SUM(used_micros), 0) AS used_micros,
        COALESCE(SUM(reserved_micros), 0) AS reserved_micros,
        COALESCE(SUM(request_count), 0) AS request_count
      FROM gateway_keys WHERE user_id = ?
    `)
    const insertSession = db.prepare(`
      INSERT INTO gateway_sessions (token_hash, user_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `)
    const findSession = db.prepare(`
      SELECT s.user_id, s.expires_at, u.*
      FROM gateway_sessions s
      JOIN gateway_users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `)
    const removeSession = db.prepare('DELETE FROM gateway_sessions WHERE token_hash = ?')
    const removeUserSessions = db.prepare('DELETE FROM gateway_sessions WHERE user_id = ?')
    const purgeExpiredSessions = db.prepare('DELETE FROM gateway_sessions WHERE expires_at <= ?')
    const insertAdminSession = db.prepare(`
      INSERT INTO admin_sessions (token_hash, expires_at, created_at) VALUES (?, ?, ?)
    `)
    const findAdminSession = db.prepare('SELECT expires_at FROM admin_sessions WHERE token_hash = ?')
    const removeAdminSession = db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?')
    const purgeExpiredAdminSessions = db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?')

    function getUserWallet(userId) {
      const owner = getUserById.get(userId)
      if (!owner) return null
      const agg = userKeyAggregates.get(userId)
      const usedMicros = Number(agg?.used_micros ?? 0)
      const reservedMicros = Number(agg?.reserved_micros ?? 0)
      return {
        owner,
        quotaMicros: owner.quota_micros,
        usedMicros,
        reservedMicros,
        remainingMicros: Math.max(0, owner.quota_micros - usedMicros - reservedMicros),
        keyCount: Number(agg?.key_count ?? 0),
        activeKeyCount: Number(agg?.active_key_count ?? 0),
        requestCount: Number(agg?.request_count ?? 0),
      }
    }

    function summarize(row) {
      if (!row) return null
      const base = {
        id: row.id,
        name: row.name,
        keyPrefix: row.key_prefix,
        enabled: Boolean(row.enabled),
        expiresAt: row.expires_at,
        models: JSON.parse(row.models),
        quotaMicros: row.quota_micros,
        usedMicros: row.used_micros,
        reservedMicros: row.reserved_micros,
        remainingMicros: Math.max(0, row.quota_micros - row.used_micros - row.reserved_micros),
        requestCount: row.request_count,
        createdAt: row.created_at,
        canCopy: Boolean(row.encrypted_secret && vaultKey),
      }
      if (row.user_id) {
        const wallet = getUserWallet(row.user_id)
        if (wallet) {
          return {
            ...base,
            userId: row.user_id,
            username: wallet.owner.username,
            sharedWallet: true,
            quotaMicros: wallet.quotaMicros,
            remainingMicros: wallet.remainingMicros,
            accountUsedMicros: wallet.usedMicros,
            accountReservedMicros: wallet.reservedMicros,
            keyEnabled: Boolean(row.enabled),
            accountEnabled: Boolean(wallet.owner.enabled),
            enabled: Boolean(row.enabled) && Boolean(wallet.owner.enabled),
          }
        }
        return { ...base, userId: row.user_id, sharedWallet: true }
      }
      return base
    }

    function summarizeUser(row) {
      if (!row) return null
      const agg = userKeyAggregates.get(row.id)
      const usedMicros = Number(agg?.used_micros ?? 0)
      const reservedMicros = Number(agg?.reserved_micros ?? 0)
      return {
        id: row.id,
        username: row.username,
        email: row.email,
        enabled: Boolean(row.enabled),
        quotaMicros: row.quota_micros,
        usedMicros,
        reservedMicros,
        remainingMicros: Math.max(0, row.quota_micros - usedMicros - reservedMicros),
        requestCount: Number(agg?.request_count ?? 0),
        keyCount: Number(agg?.key_count ?? 0),
        activeKeyCount: Number(agg?.active_key_count ?? 0),
        createdAt: row.created_at,
      }
    }

    function recoverStale(now) {
      for (const row of recoverStaleRequests.all(new Date(now).toISOString(), now)) {
        const charge = row.input_reserved_micros + row.output_reserved_micros
        chargeKey.run(charge, charge, row.key_id)
      }
    }

    function recoverBeforeRead() {
      const now = Date.now()
      if (hasStaleRequests.get(now)) transaction(() => recoverStale(now))
    }

    recoverBeforeRead()

    return {
      close() {
        db.close()
      },
      createKey({ name, quotaMicros, expiresAt = null, models, userId = null }) {
        const key = `gw_${randomBytes(32).toString('base64url')}`
        const encrypted = encryptSecret(key, vaultKey)
        const row = insertKey.get(
          randomUUID(), userId, name, digest(key), encrypted, key.slice(0, 11), expiresAt, JSON.stringify(models), quotaMicros, nowIso(),
        )
        return { key, ...summarize(row) }
      },
      listKeys() {
        recoverBeforeRead()
        return listKeyRows.all().map(summarize)
      },
      getKey(id) {
        recoverBeforeRead()
        return summarize(getKeyRow.get(id))
      },
      findKey(secret) {
        if (typeof secret !== 'string' || !secret.startsWith('gw_')) return null
        recoverBeforeRead()
        return summarize(findKeyRow.get(digest(secret)))
      },
      updateKey(id, patch) {
        return transaction(() => {
          recoverStale(Date.now())
          const row = getKeyRow.get(id)
          if (!row) return null
          if (!row.user_id && patch.quotaMicros !== undefined && patch.quotaMicros < row.used_micros + row.reserved_micros) {
            throw storeError('quota_below_usage', 'Quota cannot be lower than settled and reserved usage.')
          }
          const nextQuota = row.user_id ? row.quota_micros : (patch.quotaMicros ?? row.quota_micros)
          return summarize(writeKey.get(
            patch.name ?? row.name,
            nextQuota,
            patch.expiresAt === undefined ? row.expires_at : patch.expiresAt,
            patch.models === undefined ? row.models : JSON.stringify(patch.models),
            patch.enabled === undefined ? row.enabled : Number(patch.enabled),
            id,
          ))
        })
      },
      reserve({ keyId, model, endpoint, inputReservedMicros, outputReservedMicros, leaseExpiresAt, minReserveMicros = null }) {
        return transaction(() => {
          const now = Date.now()
          recoverStale(now)
          const raw = getKeyRow.get(keyId)
          if (!raw) return { error: 'invalid_key' }
          if (!raw.enabled) return { error: 'key_disabled' }
          const key = summarize(raw)
          if (!key.enabled) return { error: 'key_disabled' }
          if (key.expiresAt !== null && Date.parse(key.expiresAt) <= now) return { error: 'key_expired' }
          if (key.models !== null && !key.models.includes(model)) return { error: 'model_forbidden' }
          const projectedCost = inputReservedMicros + outputReservedMicros
          // For user-owned keys, key.remainingMicros is the atomic shared account wallet remaining balance.
          // When minReserveMicros is provided (inference routes), allow wallets >= minReserveMicros to call
          // high-cap models by reserving up to remainingMicros atomically so wallets can never go negative.
          const minRequired = minReserveMicros === null ? projectedCost : Math.min(projectedCost, minReserveMicros)
          if (key.remainingMicros < minRequired || key.remainingMicros <= 0) return { error: 'quota_exceeded' }
          const actualReserve = Math.min(projectedCost, key.remainingMicros)
          let effectiveInputReserve = inputReservedMicros
          let effectiveOutputReserve = outputReservedMicros
          if (actualReserve < projectedCost && projectedCost > 0) {
            effectiveInputReserve = Number((BigInt(inputReservedMicros) * BigInt(actualReserve)) / BigInt(projectedCost))
            effectiveOutputReserve = actualReserve - effectiveInputReserve
          }
          const row = insertRequest.get(
            keyId, model, endpoint, effectiveInputReserve, effectiveOutputReserve, leaseExpiresAt, new Date(now).toISOString(),
          )
          reserveOnKey.run(actualReserve, keyId)
          return {
            id: row.id,
            inputReservedMicros: effectiveInputReserve,
            outputReservedMicros: effectiveOutputReserve,
          }
        })
      },
      settle(id, { httpStatus, status, inputTokens, outputTokens, cachedTokens = null, inputCostMicros, outputCostMicros, estimated }) {
        return transaction(() => {
          const row = completeRequest.get(
            httpStatus ?? null, status, inputTokens ?? null, outputTokens ?? null, cachedTokens ?? null,
            inputCostMicros, outputCostMicros, inputCostMicros, outputCostMicros,
            Number(Boolean(estimated)), nowIso(), id,
          )
          if (row) {
            chargeKey.run(
              row.input_reserved_micros + row.output_reserved_micros,
              row.charged_micros,
              row.key_id,
            )
          }
        })
      },
      listRequests(keyId, { limit = 50, before = null, from = null, to = null, model = null, status = null } = {}) {
        recoverBeforeRead()
        const clauses = ['key_id = ?']
        const params = [keyId]
        if (from) {
          clauses.push('created_at >= ?')
          params.push(from)
        }
        if (to) {
          clauses.push('created_at <= ?')
          params.push(to)
        }
        if (model) {
          clauses.push('model = ?')
          params.push(model)
        }
        if (status) {
          clauses.push('status = ?')
          params.push(status)
        }
        const countWhere = clauses.join(' AND ')
        const total = Number(db.prepare(`SELECT COUNT(*) AS total FROM gateway_requests WHERE ${countWhere}`).get(...params)?.total ?? 0)
        const pageClauses = [...clauses]
        const pageParams = [...params]
        if (before !== null) {
          pageClauses.push('id < ?')
          pageParams.push(before)
        }
        pageParams.push(limit + 1)
        const rows = db.prepare(
          `SELECT * FROM gateway_requests WHERE ${pageClauses.join(' AND ')} ORDER BY id DESC LIMIT ?`,
        ).all(...pageParams)
        const items = rows.slice(0, limit).map(describeRequest)
        return { items, nextCursor: rows.length > limit ? items.at(-1).id : null, total }
      },
      listAllRequests({ limit = 50, before = null, from = null, to = null, model = null, status = null, q = null } = {}) {
        recoverBeforeRead()
        const clauses = []
        const params = []
        if (from) {
          clauses.push('r.created_at >= ?')
          params.push(from)
        }
        if (to) {
          clauses.push('r.created_at <= ?')
          params.push(to)
        }
        if (model) {
          clauses.push('r.model = ?')
          params.push(model)
        }
        if (status) {
          clauses.push('r.status = ?')
          params.push(status)
        }
        if (q) {
          const like = `%${q.toLowerCase()}%`
          clauses.push('(LOWER(COALESCE(k.name, \'\')) LIKE ? OR LOWER(COALESCE(k.key_prefix, \'\')) LIKE ? OR LOWER(COALESCE(u.username, \'\')) LIKE ? OR LOWER(r.model) LIKE ?)')
          params.push(like, like, like, like)
        }
        const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
        const total = Number(db.prepare(`
          SELECT COUNT(*) AS total
          FROM gateway_requests r
          LEFT JOIN gateway_keys k ON k.id = r.key_id
          LEFT JOIN gateway_users u ON u.id = k.user_id
          ${whereSql}
        `).get(...params)?.total ?? 0)
        const pageClauses = [...clauses]
        const pageParams = [...params]
        if (before !== null) {
          pageClauses.push('r.id < ?')
          pageParams.push(before)
        }
        const pageWhere = pageClauses.length ? `WHERE ${pageClauses.join(' AND ')}` : ''
        pageParams.push(limit + 1)
        const rows = db.prepare(`
          SELECT r.*, k.name AS key_name, k.key_prefix AS key_prefix, u.username AS username
          FROM gateway_requests r
          LEFT JOIN gateway_keys k ON k.id = r.key_id
          LEFT JOIN gateway_users u ON u.id = k.user_id
          ${pageWhere}
          ORDER BY r.id DESC LIMIT ?
        `).all(...pageParams)
        const items = rows.slice(0, limit).map((row) => ({
          ...describeRequest(row),
          keyId: row.key_id,
          keyName: row.key_name ?? 'Không rõ',
          keyPrefix: row.key_prefix ?? '',
          username: row.username ?? null,
        }))
        return { items, nextCursor: rows.length > limit ? items.at(-1).id : null, total }
      },
      exportRequests({ keyId = null, from = null, to = null, model = null, status = null, q = null, maxRows = 5000 } = {}) {
        recoverBeforeRead()
        const clauses = []
        const params = []
        if (keyId) {
          clauses.push('r.key_id = ?')
          params.push(keyId)
        }
        if (from) {
          clauses.push('r.created_at >= ?')
          params.push(from)
        }
        if (to) {
          clauses.push('r.created_at <= ?')
          params.push(to)
        }
        if (model) {
          clauses.push('r.model = ?')
          params.push(model)
        }
        if (status) {
          clauses.push('r.status = ?')
          params.push(status)
        }
        if (q) {
          const like = `%${q.toLowerCase()}%`
          clauses.push('(LOWER(COALESCE(k.name, \'\')) LIKE ? OR LOWER(COALESCE(k.key_prefix, \'\')) LIKE ? OR LOWER(COALESCE(u.username, \'\')) LIKE ? OR LOWER(r.model) LIKE ?)')
          params.push(like, like, like, like)
        }
        const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
        params.push(maxRows)
        return db.prepare(`
          SELECT r.*, k.name AS key_name, k.key_prefix AS key_prefix, u.username AS username
          FROM gateway_requests r
          LEFT JOIN gateway_keys k ON k.id = r.key_id
          LEFT JOIN gateway_users u ON u.id = k.user_id
          ${whereSql}
          ORDER BY r.id DESC LIMIT ?
        `).all(...params).map((row) => ({
          ...describeRequest(row),
          keyId: row.key_id,
          keyName: row.key_name ?? 'Không rõ',
          keyPrefix: row.key_prefix ?? '',
          username: row.username ?? null,
        }))
      },
      revealKeySecret(keyId) {
        const row = getKeyRow.get(keyId)
        if (!row) return null
        return decryptSecret(row.encrypted_secret, vaultKey)
      },

      // --- User account & shared-wallet self-service console methods ---
      createUser({ username, email, password, quotaMicros }) {
        const normalizedUser = username.trim().toLowerCase()
        const normalizedEmail = email.trim().toLowerCase()
        return transaction(() => {
          if (getUserByUsername.get(normalizedUser)) {
            throw storeError('username_taken', 'Tên đăng nhập này đã được sử dụng.')
          }
          if (getUserByEmail.get(normalizedEmail)) {
            throw storeError('email_taken', 'Email này đã được đăng ký.')
          }
          const createdAt = nowIso()
          const row = insertUser.get(
            randomUUID(), normalizedUser, normalizedEmail, hashPassword(password), quotaMicros, createdAt,
          )
          if (quotaMicros > 0) {
            insertWalletTx.get(row.id, quotaMicros, quotaMicros, 'signup_bonus', 'Số dư khởi tạo khi đăng ký tài khoản', null, createdAt)
          }
          return summarizeUser(row)
        })
      },
      changeUserPassword(userId, { currentPassword, newPassword, keepSessionToken = null }) {
        return transaction(() => {
          const row = getUserById.get(userId)
          if (!row || !row.enabled) throw storeError('account_disabled', 'Tài khoản đã bị vô hiệu hóa.')
          if (!verifyPassword(currentPassword, row.password_hash)) {
            throw storeError('invalid_current_password', 'Mật khẩu hiện tại không đúng.')
          }
          writeUserPassword.get(hashPassword(newPassword), userId)
          if (typeof keepSessionToken === 'string' && keepSessionToken.startsWith('sess_')) {
            removeOtherUserSessions.run(userId, digest(keepSessionToken))
          } else {
            removeUserSessions.run(userId)
          }
          return true
        })
      },
      resetUserPassword(userId, newPassword) {
        return transaction(() => {
          const row = getUserById.get(userId)
          if (!row) return null
          const updated = writeUserPassword.get(hashPassword(newPassword), userId)
          removeUserSessions.run(userId)
          return summarizeUser(updated)
        })
      },
      authenticateUser({ identifier, password }) {
        const normalized = identifier.trim().toLowerCase()
        const row = normalized.includes('@')
          ? getUserByEmail.get(normalized)
          : getUserByUsername.get(normalized)
        if (!row) {
          scryptSync(password, '00000000000000000000000000000000', 64)
          return { error: 'invalid_credentials' }
        }
        if (!verifyPassword(password, row.password_hash)) {
          return { error: 'invalid_credentials' }
        }
        if (!row.enabled) {
          return { error: 'account_disabled' }
        }
        recoverBeforeRead()
        return { user: summarizeUser(row) }
      },
      createSession(userId, ttlMs) {
        const token = `sess_${randomBytes(32).toString('base64url')}`
        const now = Date.now()
        purgeExpiredSessions.run(now)
        insertSession.run(digest(token), userId, now + ttlMs, new Date(now).toISOString())
        return token
      },
      findSessionUser(token) {
        if (typeof token !== 'string' || !token.startsWith('sess_')) return null
        const row = findSession.get(digest(token))
        if (!row) return null
        if (row.expires_at <= Date.now()) {
          removeSession.run(digest(token))
          return null
        }
        if (!row.enabled) return null
        recoverBeforeRead()
        return summarizeUser(row)
      },
      deleteSession(token) {
        if (typeof token === 'string' && token.startsWith('sess_')) {
          removeSession.run(digest(token))
        }
      },
      createAdminSession(ttlMs) {
        const token = `adm_${randomBytes(32).toString('base64url')}`
        const now = Date.now()
        purgeExpiredAdminSessions.run(now)
        insertAdminSession.run(digest(token), now + ttlMs, new Date(now).toISOString())
        return token
      },
      hasAdminSession(token) {
        if (typeof token !== 'string' || !token.startsWith('adm_')) return false
        const hashKey = digest(token)
        const row = findAdminSession.get(hashKey)
        if (!row) return false
        if (row.expires_at <= Date.now()) {
          removeAdminSession.run(hashKey)
          return false
        }
        return true
      },
      deleteAdminSession(token) {
        if (typeof token === 'string' && token.startsWith('adm_')) {
          removeAdminSession.run(digest(token))
        }
      },
      listUsers() {
        recoverBeforeRead()
        return listUserRows.all().map(summarizeUser)
      },
      getUser(id) {
        recoverBeforeRead()
        return summarizeUser(getUserById.get(id))
      },
      updateUser(id, patch) {
        return transaction(() => {
          recoverStale(Date.now())
          const row = getUserById.get(id)
          if (!row) return null
          const agg = userKeyAggregates.get(id)
          const spent = Number(agg?.used_micros ?? 0) + Number(agg?.reserved_micros ?? 0)
          if (patch.quotaMicros !== undefined && patch.quotaMicros < spent) {
            throw storeError(
              'quota_below_usage',
              'Hạn mức ví không được thấp hơn tổng số đã dùng và đang giữ chỗ.',
            )
          }
          const nextQuota = patch.quotaMicros ?? row.quota_micros
          const updated = writeUser.get(
            nextQuota,
            patch.enabled === undefined ? row.enabled : Number(patch.enabled),
            id,
          )
          if (nextQuota !== row.quota_micros) {
            const delta = nextQuota - row.quota_micros
            const defaultNote = delta > 0 ? 'Admin nạp thêm hạn mức ví' : 'Admin điều chỉnh giảm hạn mức ví'
            insertWalletTx.get(id, delta, nextQuota, 'admin_adjust', patch.note || defaultNote, null, nowIso())
          }
          if (patch.enabled === false) {
            removeUserSessions.run(id)
          }
          return summarizeUser(updated)
        })
      },
      listUserTransactions(userId, { limit = 50, before = null } = {}) {
        const clauses = ['t.user_id = ?']
        const params = [userId]
        const total = Number(db.prepare('SELECT COUNT(*) AS total FROM wallet_transactions WHERE user_id = ?').get(userId)?.total ?? 0)
        if (before !== null) {
          clauses.push('t.id < ?')
          params.push(before)
        }
        params.push(limit + 1)
        const rows = db.prepare(`
          SELECT t.*, u.username AS username, u.email AS email
          FROM wallet_transactions t
          JOIN gateway_users u ON u.id = t.user_id
          WHERE ${clauses.join(' AND ')}
          ORDER BY t.id DESC LIMIT ?
        `).all(...params)
        const items = rows.slice(0, limit).map(describeTransaction)
        return { items, nextCursor: rows.length > limit ? items.at(-1).id : null, total }
      },
      listAllTransactions({ limit = 50, before = null, userId = null } = {}) {
        const clauses = []
        const params = []
        if (userId) {
          clauses.push('t.user_id = ?')
          params.push(userId)
        }
        const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
        const total = Number(db.prepare(`SELECT COUNT(*) AS total FROM wallet_transactions t ${whereSql}`).get(...params)?.total ?? 0)
        const pageClauses = [...clauses]
        const pageParams = [...params]
        if (before !== null) {
          pageClauses.push('t.id < ?')
          pageParams.push(before)
        }
        const pageWhere = pageClauses.length ? `WHERE ${pageClauses.join(' AND ')}` : ''
        pageParams.push(limit + 1)
        const rows = db.prepare(`
          SELECT t.*, u.username AS username, u.email AS email
          FROM wallet_transactions t
          JOIN gateway_users u ON u.id = t.user_id
          ${pageWhere}
          ORDER BY t.id DESC LIMIT ?
        `).all(...pageParams)
        const items = rows.slice(0, limit).map(describeTransaction)
        return { items, nextCursor: rows.length > limit ? items.at(-1).id : null, total }
      },
      createGiftcode({ code, amountMicros, maxUses = 1, expiresAt = null, note = null }) {
        const normalized = code.trim().toUpperCase()
        return transaction(() => {
          if (getGiftcodeByCode.get(normalized)) {
            throw storeError('giftcode_exists', 'Mã nạp Giftcode này đã tồn tại.')
          }
          const row = insertGiftcode.get(
            randomUUID(), normalized, amountMicros, maxUses, expiresAt, note, nowIso(),
          )
          return describeGiftcode(row)
        })
      },
      listGiftcodes() {
        return listGiftcodeRows.all().map(describeGiftcode)
      },
      updateGiftcode(id, patch) {
        return transaction(() => {
          const row = getGiftcodeById.get(id)
          if (!row) return null
          const nextMaxUses = patch.maxUses ?? row.max_uses
          if (nextMaxUses < row.used_count) {
            throw storeError('invalid_request', 'Số lượt dùng tối đa không thể nhỏ hơn số lượt đã sử dụng.')
          }
          const updated = writeGiftcode.get(
            patch.enabled === undefined ? row.enabled : Number(patch.enabled),
            nextMaxUses,
            patch.expiresAt === undefined ? row.expires_at : patch.expiresAt,
            patch.note === undefined ? row.note : patch.note,
            id,
          )
          return describeGiftcode(updated)
        })
      },
      redeemGiftcode(userId, rawCode) {
        const normalized = String(rawCode ?? '').trim().toUpperCase()
        return transaction(() => {
          recoverStale(Date.now())
          const user = getUserById.get(userId)
          if (!user || !user.enabled) throw storeError('account_disabled', 'Tài khoản đã bị vô hiệu hóa.')
          const gift = getGiftcodeByCode.get(normalized)
          if (!gift) throw storeError('giftcode_not_found', 'Mã nạp không tồn tại. Vui lòng kiểm tra lại.')
          if (!gift.enabled) throw storeError('giftcode_disabled', 'Mã nạp này đã bị vô hiệu hóa.')
          if (gift.expires_at !== null && Date.parse(gift.expires_at) <= Date.now()) {
            throw storeError('giftcode_expired', 'Mã nạp này đã hết hạn sử dụng.')
          }
          if (gift.used_count >= gift.max_uses) {
            throw storeError('giftcode_exhausted', 'Mã nạp này đã hết lượt sử dụng.')
          }
          if (findRedemption.get(gift.id, userId)) {
            throw storeError('giftcode_already_used', 'Tài khoản của bạn đã sử dụng mã nạp này trước đó.')
          }
          const now = nowIso()
          insertRedemption.run(gift.id, userId, gift.amount_micros, now)
          const updatedGift = incrementGiftcodeUse.get(gift.id)
          const nextQuota = user.quota_micros + gift.amount_micros
          const updatedUser = writeUser.get(nextQuota, user.enabled, userId)
          const txNote = gift.note ? `Mã nạp ${gift.code} · ${gift.note}` : `Nạp ví bằng mã ${gift.code}`
          const tx = insertWalletTx.get(userId, gift.amount_micros, nextQuota, 'giftcode', txNote, gift.code, now)
          return {
            giftcode: describeGiftcode(updatedGift),
            user: summarizeUser(updatedUser),
            transaction: describeTransaction({ ...tx, username: updatedUser.username, email: updatedUser.email }),
          }
        })
      },
      getAnalytics({ days = 14, userId = null, modelsMap = null } = {}) {
        recoverBeforeRead()
        const safeDays = Math.min(90, Math.max(1, Number(days) || 14))
        const nowMs = Date.now()
        const todayKey = toVnDateKey(nowMs)
        const dayKeys = []
        for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
          dayKeys.push(toVnDateKey(nowMs - offset * 86_400_000))
        }
        const startIso = vnDayStartUtcIso(dayKeys[0])
        const dailyMap = new Map(
          dayKeys.map((date) => [date, { date, requests: 0, spentMicros: 0, savedMicros: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0 }]),
        )

        const rows = userId
          ? db.prepare(`
              SELECT r.created_at, r.model, r.status, r.input_tokens, r.output_tokens, r.cached_tokens, r.charged_micros
              FROM gateway_requests r
              JOIN gateway_keys k ON k.id = r.key_id
              WHERE k.user_id = ? AND r.created_at >= ?
            `).all(userId, startIso)
          : db.prepare(`
              SELECT r.created_at, r.model, r.status, r.input_tokens, r.output_tokens, r.cached_tokens, r.charged_micros,
                     k.user_id AS user_id, u.username AS username
              FROM gateway_requests r
              LEFT JOIN gateway_keys k ON k.id = r.key_id
              LEFT JOIN gateway_users u ON u.id = k.user_id
              WHERE r.created_at >= ?
            `).all(startIso)

        let totalRequests = 0
        let successRequests = 0
        let errorRequests = 0
        let periodSpentMicros = 0
        let periodSavedMicros = 0
        let todaySpentMicros = 0
        let totalInputTokens = 0
        let totalCachedTokens = 0
        let totalOutputTokens = 0
        const byModel = new Map()
        const byUser = new Map()

        for (const r of rows) {
          const ms = Date.parse(r.created_at)
          const dayKey = Number.isFinite(ms) ? toVnDateKey(ms) : todayKey
          const bucket = dailyMap.get(dayKey)
          const spent = Number(r.charged_micros ?? 0)
          const inTok = Number(r.input_tokens ?? 0)
          const outTok = Number(r.output_tokens ?? 0)
          const cachedTok = Number(r.cached_tokens ?? 0)
          let saved = 0
          if (cachedTok > 0) {
            const cfg = modelsMap?.get(r.model)
            if (cfg) {
              const cachedRate = cfg.cachedInputMicrosPerMillion ?? Math.round(cfg.inputMicrosPerMillion * 0.25)
              const deltaRate = Math.max(0, cfg.inputMicrosPerMillion - cachedRate)
              saved = Number((BigInt(cachedTok) * BigInt(deltaRate)) / 1_000_000n)
            }
          }

          totalRequests += 1
          if (r.status === 'success') successRequests += 1
          else if (r.status !== 'pending') errorRequests += 1
          periodSpentMicros += spent
          periodSavedMicros += saved
          if (dayKey === todayKey) todaySpentMicros += spent
          totalInputTokens += inTok
          totalCachedTokens += cachedTok
          totalOutputTokens += outTok

          if (bucket) {
            bucket.requests += 1
            bucket.spentMicros += spent
            bucket.savedMicros += saved
            bucket.inputTokens += inTok
            bucket.cachedTokens += cachedTok
            bucket.outputTokens += outTok
          }

          const mAcc = byModel.get(r.model) ?? {
            model: r.model, requests: 0, spentMicros: 0, savedMicros: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0,
          }
          mAcc.requests += 1
          mAcc.spentMicros += spent
          mAcc.savedMicros += saved
          mAcc.inputTokens += inTok
          mAcc.cachedTokens += cachedTok
          mAcc.outputTokens += outTok
          byModel.set(r.model, mAcc)

          if (!userId && r.user_id) {
            const uAcc = byUser.get(r.user_id) ?? {
              userId: r.user_id, username: r.username ?? 'unknown', requests: 0, spentMicros: 0, savedMicros: 0,
            }
            uAcc.requests += 1
            uAcc.spentMicros += spent
            uAcc.savedMicros += saved
            byUser.set(r.user_id, uAcc)
          }
        }

        const topModels = [...byModel.values()]
          .sort((a, b) => b.spentMicros - a.spentMicros || b.requests - a.requests)
          .slice(0, 10)

        const topUsers = !userId
          ? [...byUser.values()]
              .sort((a, b) => b.spentMicros - a.spentMicros || b.requests - a.requests)
              .slice(0, 10)
              .map((entry) => {
                const wallet = getUserWallet(entry.userId)
                return { ...entry, remainingMicros: wallet?.remainingMicros ?? 0 }
              })
          : []

        const txSumRow = userId
          ? db.prepare('SELECT COALESCE(SUM(CASE WHEN delta_micros > 0 THEN delta_micros ELSE 0 END), 0) AS total FROM wallet_transactions WHERE user_id = ? AND created_at >= ?').get(userId, startIso)
          : db.prepare('SELECT COALESCE(SUM(CASE WHEN delta_micros > 0 THEN delta_micros ELSE 0 END), 0) AS total FROM wallet_transactions WHERE created_at >= ?').get(startIso)

        return {
          days: safeDays,
          todayKey,
          summary: {
            todaySpentMicros,
            periodSpentMicros,
            periodSavedMicros,
            periodTopupMicros: Number(txSumRow?.total ?? 0),
            totalRequests,
            successRequests,
            errorRequests,
            totalInputTokens,
            totalCachedTokens,
            totalOutputTokens,
          },
          daily: [...dailyMap.values()],
          topModels,
          topUsers,
        }
      },
      createBackup(backupDir, { label = 'manual', retentionCount = 14 } = {}) {
        if (!backupDir) throw storeError('backup_unconfigured', 'Chưa cấu hình thư mục sao lưu SQLite.')
        mkdirSync(backupDir, { recursive: true })
        const safeLabel = String(label).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16) || 'manual'
        const suffix = randomBytes(2).toString('hex')
        const filename = `gateway-backup-${formatBackupStamp(Date.now())}-${safeLabel}-${suffix}.sqlite`
        const fullPath = join(backupDir, filename)
        db.prepare('VACUUM INTO ?').run(fullPath)
        try {
          chmodSync(fullPath, 0o600)
        } catch {
          // Ignore chmod error on platforms without POSIX permissions
        }
        const entries = readdirSync(backupDir)
          .filter((name) => BACKUP_FILE_RE.test(name))
          .map((name) => {
            const st = statSync(join(backupDir, name))
            return { filename: name, sizeBytes: st.size, mtimeMs: st.mtimeMs, createdAt: new Date(st.mtimeMs).toISOString() }
          })
          .sort((a, b) => b.mtimeMs - a.mtimeMs || b.filename.localeCompare(a.filename))
        const keep = Math.max(1, Number(retentionCount) || 14)
        for (const stale of entries.slice(keep)) {
          try {
            rmSync(join(backupDir, stale.filename), { force: true })
          } catch {
            // Best-effort rotation
          }
        }
        const current = entries.find((item) => item.filename === filename)
          ?? { filename, sizeBytes: statSync(fullPath).size, createdAt: nowIso() }
        return { filename: current.filename, sizeBytes: current.sizeBytes, createdAt: current.createdAt }
      },
      listBackups(backupDir) {
        if (!backupDir) return []
        let names = []
        try {
          names = readdirSync(backupDir)
        } catch {
          return []
        }
        return names
          .filter((name) => BACKUP_FILE_RE.test(name))
          .map((name) => {
            const st = statSync(join(backupDir, name))
            return { filename: name, sizeBytes: st.size, mtimeMs: st.mtimeMs, createdAt: new Date(st.mtimeMs).toISOString() }
          })
          .sort((a, b) => b.mtimeMs - a.mtimeMs || b.filename.localeCompare(a.filename))
          .map(({ filename, sizeBytes, createdAt }) => ({ filename, sizeBytes, createdAt }))
      },
      listUserKeys(userId) {
        recoverBeforeRead()
        return listUserKeyRows.all(userId).map(summarize)
      },
      getUserKey(userId, keyId) {
        recoverBeforeRead()
        const row = getKeyRow.get(keyId)
        if (!row || row.user_id !== userId) return null
        return summarize(row)
      },
      revealUserKeySecret(userId, keyId) {
        const row = getKeyRow.get(keyId)
        if (!row || row.user_id !== userId) return null
        return decryptSecret(row.encrypted_secret, vaultKey)
      },
      createUserKey(userId, { name, expiresAt = null, models }, maxKeysPerUser) {
        return transaction(() => {
          recoverStale(Date.now())
          const owner = getUserById.get(userId)
          if (!owner || !owner.enabled) throw storeError('account_disabled', 'Tài khoản đã bị vô hiệu hóa.')
          const agg = userKeyAggregates.get(userId)
          const activeKeyCount = Number(agg?.active_key_count ?? 0)
          const totalKeyCount = Number(agg?.key_count ?? 0)
          const hardTotalLimit = Math.max(maxKeysPerUser * 4, 20)
          if (activeKeyCount >= maxKeysPerUser) {
            throw storeError('max_keys_reached', `Mỗi tài khoản chỉ được bật tối đa ${maxKeysPerUser} khóa hoạt động. Hãy vô hiệu hóa khóa cũ trước khi tạo mới.`)
          }
          if (totalKeyCount >= hardTotalLimit) {
            throw storeError('max_keys_reached', `Tài khoản đã chạm trần lưu trữ lịch sử ${hardTotalLimit} khóa.`)
          }
          const key = `gw_${randomBytes(32).toString('base64url')}`
          const encrypted = encryptSecret(key, vaultKey)
          const row = insertKey.get(
            randomUUID(), userId, name, digest(key), encrypted, key.slice(0, 11), expiresAt, JSON.stringify(models), 0, nowIso(),
          )
          return { key, ...summarize(row) }
        })
      },
      updateUserKey(userId, keyId, patch, maxKeysPerUser = null) {
        return transaction(() => {
          recoverStale(Date.now())
          const owner = getUserById.get(userId)
          if (!owner || !owner.enabled) throw storeError('account_disabled', 'Tài khoản đã bị vô hiệu hóa.')
          const row = getKeyRow.get(keyId)
          if (!row || row.user_id !== userId) return null
          if (patch.enabled === true && !row.enabled && maxKeysPerUser !== null) {
            const agg = userKeyAggregates.get(userId)
            const activeKeyCount = Number(agg?.active_key_count ?? 0)
            if (activeKeyCount >= maxKeysPerUser) {
              throw storeError('max_keys_reached', `Bạn đã bật đủ ${maxKeysPerUser} khóa hoạt động. Hãy tắt bớt một khóa trước khi bật lại khóa này.`)
            }
          }
          return summarize(writeKey.get(
            patch.name ?? row.name,
            row.quota_micros,
            patch.expiresAt === undefined ? row.expires_at : patch.expiresAt,
            patch.models === undefined ? row.models : JSON.stringify(patch.models),
            patch.enabled === undefined ? row.enabled : Number(patch.enabled),
            keyId,
          ))
        })
      },
      disableUserKey(userId, keyId) {
        return transaction(() => {
          const row = getKeyRow.get(keyId)
          if (!row || row.user_id !== userId) return false
          writeKey.get(row.name, row.quota_micros, row.expires_at, row.models, 0, keyId)
          return true
        })
      },
    }
  } catch (error) {
    db.close()
    throw error
  }
}
