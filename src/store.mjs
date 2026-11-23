import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const digest = (secret) => createHash('sha256').update(secret).digest('hex')
const nowIso = () => new Date().toISOString()

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
      CREATE INDEX IF NOT EXISTS gateway_requests_lease ON gateway_requests(lease_expires_at)
        WHERE status = 'pending';
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
    const userKeyAggregates = db.prepare(`
      SELECT
        COUNT(*) AS key_count,
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
      listRequests(keyId, { limit = 50, before = null } = {}) {
        recoverBeforeRead()
        const rows = before === null
          ? latestRequests.all(keyId, limit + 1)
          : earlierRequests.all(keyId, before, limit + 1)
        const items = rows.slice(0, limit).map(describeRequest)
        const total = Number(countKeyRequests.get(keyId)?.total ?? items.length)
        return { items, nextCursor: rows.length > limit ? items.at(-1).id : null, total }
      },
      listAllRequests({ limit = 50, before = null } = {}) {
        recoverBeforeRead()
        const rows = before === null
          ? latestAllRequests.all(limit + 1)
          : earlierAllRequests.all(before, limit + 1)
        const items = rows.slice(0, limit).map((row) => ({
          ...describeRequest(row),
          keyId: row.key_id,
          keyName: row.key_name ?? 'Không rõ',
          keyPrefix: row.key_prefix ?? '',
          username: row.username ?? null,
        }))
        const total = Number(countAllRequests.get()?.total ?? items.length)
        return { items, nextCursor: rows.length > limit ? items.at(-1).id : null, total }
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
          const row = insertUser.get(
            randomUUID(), normalizedUser, normalizedEmail, hashPassword(password), quotaMicros, nowIso(),
          )
          return summarizeUser(row)
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
          const updated = writeUser.get(
            patch.quotaMicros ?? row.quota_micros,
            patch.enabled === undefined ? row.enabled : Number(patch.enabled),
            id,
          )
          if (patch.enabled === false) {
            removeUserSessions.run(id)
          }
          return summarizeUser(updated)
        })
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
          const keyCount = Number(agg?.key_count ?? 0)
          if (keyCount >= maxKeysPerUser) {
            throw storeError('max_keys_reached', `Mỗi tài khoản chỉ được tạo tối đa ${maxKeysPerUser} khóa.`)
          }
          const key = `gw_${randomBytes(32).toString('base64url')}`
          const encrypted = encryptSecret(key, vaultKey)
          const row = insertKey.get(
            randomUUID(), userId, name, digest(key), encrypted, key.slice(0, 11), expiresAt, JSON.stringify(models), 0, nowIso(),
          )
          return { key, ...summarize(row) }
        })
      },
      updateUserKey(userId, keyId, patch) {
        return transaction(() => {
          recoverStale(Date.now())
          const owner = getUserById.get(userId)
          if (!owner || !owner.enabled) throw storeError('account_disabled', 'Tài khoản đã bị vô hiệu hóa.')
          const row = getKeyRow.get(keyId)
          if (!row || row.user_id !== userId) return null
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
