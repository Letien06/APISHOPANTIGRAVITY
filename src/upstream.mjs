import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const MAX_OBSERVATION_CHARS = 8 * 1024 * 1024;

const upstreamMessages = {
  400: 'The inference provider rejected the request.',
  401: 'The inference provider could not authenticate the request.',
  403: 'The inference provider denied the request.',
  404: 'The requested inference resource was unavailable.',
  413: 'The inference provider rejected the request size.',
  422: 'The inference provider could not process the request.',
  429: 'The inference provider is rate limiting requests.',
  502: 'The inference provider could not complete the request.',
  503: 'The inference provider is unavailable.',
  504: 'The inference provider timed out.',
};

function downstreamOpen(res) {
  return !res.destroyed && !res.writableEnded;
}

function setResponseHeaders(res, status, contentType, requestId) {
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Request-Id', requestId);
}

function sendError(res, status, requestId, retryAfter) {
  if (!downstreamOpen(res)) return;
  setResponseHeaders(res, status, 'application/json; charset=utf-8', requestId);
  if (retryAfter) res.setHeader('Retry-After', retryAfter);
  res.write(JSON.stringify({
    error: {
      message: upstreamMessages[status] ?? 'The inference provider returned an error.',
      type: status === 429 ? 'rate_limit_error' : 'upstream_error',
      code: status === 429 ? 'upstream_rate_limited' : 'upstream_error',
    },
  }));
}

function safeRetryAfter(value) {
  if (/^\d{1,10}$/.test(value ?? '')) return value;
  if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value ?? '')
      && Number.isFinite(Date.parse(value))) {
    return value;
  }
}

function waitForDrain(res, signal) {
  if (!downstreamOpen(res) || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    function done() {
      res.off('drain', done);
      res.off('close', done);
      res.off('error', done);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    res.once('drain', done);
    res.once('close', done);
    res.once('error', done);
    signal?.addEventListener('abort', done, { once: true });
  });
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function createObservation(httpStatus, chat, sse) {
  let terminal = false;
  let failed = false;
  let inputTokens = null;
  let outputTokens = null;
  let cachedTokens = 0;

  return {
    accept(value, event) {
      if (chat && sse && value.trim() === '[DONE]') {
        terminal = true;
        return;
      }

      const envelope = typeof value === 'string' ? parseJson(value) : value;
      if (event === 'error' || event === 'response.failed' || event === 'response.cancelled') {
        terminal = true;
        failed = true;
      }
      if (!envelope || typeof envelope !== 'object') return;

      const recognizedEvent = typeof envelope.type === 'string' ? envelope.type : event;
      const response = chat ? envelope : envelope.response ?? envelope;
      if (chat && sse && Array.isArray(envelope.choices)
          && envelope.choices.some((choice) => choice && typeof choice.finish_reason === 'string' && choice.finish_reason.length > 0)) {
        terminal = true;
      }
      if (!chat && sse && [
        'response.completed',
        'response.incomplete',
        'response.failed',
        'response.cancelled',
      ].includes(recognizedEvent)) terminal = true;

      if (envelope.error || response.error || recognizedEvent === 'error'
          || recognizedEvent === 'response.failed' || recognizedEvent === 'response.cancelled'
          || response.status === 'failed' || response.status === 'cancelled') {
        terminal = true;
        failed = true;
      }

      const usage = response.usage;
      const input = chat ? usage?.prompt_tokens ?? usage?.input_tokens : usage?.input_tokens ?? usage?.prompt_tokens;
      const output = chat ? usage?.completion_tokens ?? usage?.output_tokens : usage?.output_tokens ?? usage?.completion_tokens;
      if (Number.isSafeInteger(input) && input >= 0 && Number.isSafeInteger(output) && output >= 0) {
        inputTokens = input;
        outputTokens = output;
        const rawCached = usage?.prompt_tokens_details?.cached_tokens
          ?? usage?.input_tokens_details?.cached_tokens
          ?? usage?.cache_read_input_tokens
          ?? usage?.cached_tokens;
        cachedTokens = Number.isSafeInteger(rawCached) && rawCached > 0 ? Math.min(rawCached, input) : 0;
        if (chat && sse) terminal = true;
      }
    },
    result(interrupted = false) {
      let status = 'success';
      if (failed) status = 'upstream_error';
      else if (interrupted || (sse && !terminal)) status = 'transport_error';
      else if (inputTokens === null) status = 'usage_missing';
      return { httpStatus, status, inputTokens, outputTokens, cachedTokens: inputTokens === null ? null : cachedTokens };
    },
  };
}

function createSseParser(onEvent) {
  const decoder = new TextDecoder();
  let line = '';
  let lineOverflow = false;
  let skipLineFeed = false;
  let event = '';
  let data = [];
  let size = 0;
  let overflow = false;

  function finishLine() {
    if (lineOverflow) {
      overflow = true;
    } else if (!line) {
      if (!overflow && data.length) onEvent(data.join('\n'), event);
      event = '';
      data = [];
      size = 0;
      overflow = false;
    } else if (!overflow && line[0] !== ':') {
      const separator = line.indexOf(':');
      const name = separator < 0 ? line : line.slice(0, separator);
      let value = separator < 0 ? '' : line.slice(separator + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (name === 'event') event = value;
      if (name === 'data') {
        size += value.length + 1;
        if (size > MAX_OBSERVATION_CHARS) {
          data = [];
          overflow = true;
        } else {
          data.push(value);
        }
      }
    }
    line = '';
    lineOverflow = false;
  }

  function append(part) {
    if (lineOverflow) return;
    if (line.length + part.length > MAX_OBSERVATION_CHARS) {
      line = '';
      lineOverflow = true;
      return;
    }
    line += part;
  }

  function consume(text) {
    let start = 0;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (skipLineFeed) {
        skipLineFeed = false;
        if (char === '\n') {
          start = index + 1;
          continue;
        }
      }
      if (char === '\r' || char === '\n') {
        append(text.slice(start, index));
        finishLine();
        skipLineFeed = char === '\r';
        start = index + 1;
      }
    }
    append(text.slice(start));
  }

  return {
    write(chunk) {
      consume(decoder.decode(chunk, { stream: true }));
    },
    end() {
      consume(decoder.decode());
      if (line || lineOverflow) finishLine();
      if (!overflow && data.length) {
        onEvent(data.join('\n'), event);
        event = '';
        data = [];
        size = 0;
        overflow = false;
      }
    },
  };
}

async function readJsonResponse(body) {
  const chunks = [];
  let size = 0;
  for await (const chunk of body ?? []) {
    size += chunk.length;
    if (size > MAX_OBSERVATION_CHARS) throw new Error('Upstream JSON response is too large');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const value = parseJson(bytes.toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid upstream JSON response');
  }
  return { bytes, value };
}

function openUpstreamRequest(url, { key, streaming, payload, signal }) {
  const target = url instanceof URL ? url : new URL(url);
  const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const serialized = Buffer.from(JSON.stringify(payload), 'utf8');

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Upstream request aborted'));
      return;
    }

    let settled = false;
    const req = transport(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Content-Length': String(serialized.length),
          Accept: streaming ? 'text/event-stream, application/json' : 'application/json',
        },
      },
      (upstreamRes) => {
        if (settled) {
          upstreamRes.destroy();
          return;
        }
        settled = true;
        cleanup();
        resolve({ upstreamReq: req, upstreamRes });
      },
    );

    function onAbort() {
      const err = signal?.reason ?? new Error('Upstream request aborted');
      req.destroy(err);
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
      }
    }

    function onError(err) {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
      }
    }

    function cleanup() {
      signal?.removeEventListener('abort', onAbort);
      req.off('error', onError);
    }

    signal?.addEventListener('abort', onAbort, { once: true });
    req.on('error', onError);
    // Disable socket inactivity timeout so long-thinking models rely strictly on AbortSignal (up to UPSTREAM_TIMEOUT_MS).
    req.setTimeout(0);
    req.end(serialized);
  });
}

/**
 * Forward an inference request and observe usage without transforming its response.
 * Uses node:http/https directly to avoid Undici's hardcoded 5-minute headers/body timeout.
 */
export async function proxyInference({ res, url, key, body, signal, requestId, endpoint }) {
  const chat = endpoint === '/v1/chat/completions';
  const streaming = body.stream === true;
  const streamOptions = body.stream_options && typeof body.stream_options === 'object' && !Array.isArray(body.stream_options)
    ? body.stream_options
    : {};
  const payload = chat && streaming
    ? { ...body, stream_options: { ...streamOptions, include_usage: true } }
    : body;

  let observation;
  let upstreamRes;
  let onStreamAbort;
  try {
    const opened = await openUpstreamRequest(url, { key, streaming, payload, signal });
    upstreamRes = opened.upstreamRes;
    onStreamAbort = () => upstreamRes?.destroy(signal?.reason ?? new Error('Upstream request aborted'));
    signal?.addEventListener('abort', onStreamAbort, { once: true });

    const upstreamStatus = upstreamRes.statusCode ?? 502;
    if (upstreamStatus >= 300 && upstreamStatus < 400) {
      upstreamRes.resume();
      sendError(res, 502, requestId);
      return { httpStatus: 502, status: 'upstream_error', inputTokens: null, outputTokens: null };
    }
    if (upstreamStatus < 200 || upstreamStatus >= 400) {
      upstreamRes.resume();
      const rawRetryAfter = Array.isArray(upstreamRes.headers['retry-after'])
        ? upstreamRes.headers['retry-after'][0]
        : upstreamRes.headers['retry-after'];
      sendError(res, upstreamStatus, requestId, safeRetryAfter(rawRetryAfter));
      return { httpStatus: upstreamStatus, status: 'upstream_error', inputTokens: null, outputTokens: null };
    }

    const rawContentType = Array.isArray(upstreamRes.headers['content-type'])
      ? upstreamRes.headers['content-type'][0]
      : upstreamRes.headers['content-type'];
    const mediaType = rawContentType?.split(';', 1)[0].trim().toLowerCase();
    const sse = mediaType === 'text/event-stream';
    observation = createObservation(upstreamStatus, chat, sse);
    if (!sse) {
      const { bytes, value } = await readJsonResponse(upstreamRes);
      observation.accept(value);
      const result = observation.result();
      if (result.status === 'upstream_error') {
        sendError(res, 502, requestId);
        return { ...result, httpStatus: 502 };
      }
      if (downstreamOpen(res)) {
        setResponseHeaders(res, upstreamStatus, 'application/json; charset=utf-8', requestId);
        res.write(bytes);
      }
      return result;
    }

    const parser = createSseParser(observation.accept);
    if (downstreamOpen(res)) {
      setResponseHeaders(res, upstreamStatus, 'text/event-stream; charset=utf-8', requestId);
      res.flushHeaders();
    }

    for await (const chunk of upstreamRes) {
      parser.write(chunk);
      if (downstreamOpen(res) && !res.write(chunk)) await waitForDrain(res, signal);
      signal?.throwIfAborted();
    }

    parser.end();
    const result = observation.result();
    if (result.status === 'transport_error' && downstreamOpen(res)) res.destroy();
    return result;
  } catch {
    const status = signal?.aborted ? 504 : 502;
    if (res.headersSent) {
      if (downstreamOpen(res)) res.destroy();
      return observation?.result(true)
        ?? { httpStatus: res.statusCode, status: 'transport_error', inputTokens: null, outputTokens: null };
    }
    sendError(res, status, requestId);
    // If connection failed before upstream returned any HTTP response headers (e.g. ECONNREFUSED during restart),
    // mark as upstream_error so accounting refunds 100% of the reservation instead of charging the user.
    if (!observation && !signal?.aborted) {
      return { httpStatus: status, status: 'upstream_error', inputTokens: null, outputTokens: null };
    }
    return { httpStatus: status, status: 'transport_error', inputTokens: null, outputTokens: null };
  } finally {
    if (onStreamAbort) signal?.removeEventListener('abort', onStreamAbort);
  }
}
