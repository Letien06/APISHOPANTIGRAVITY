import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFileSync } from 'node:fs';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
]);

export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

export function sendNotFound(res) {
  res.writeHead(404, {
    ...SECURITY_HEADERS,
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify({ error: { type: 'invalid_request_error', code: 'not_found', message: 'Route not found.' } }));
}

export function serveStaticAsset(res, filePath, contentType, cacheControl = 'no-store') {
  const body = readFileSync(filePath);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': contentType,
    'content-length': body.length,
    'cache-control': cacheControl,
  });
  res.end(body);
}

export function proxyToGateway(req, res, targetOrigin, pathAndSearch) {
  const target = new URL(pathAndSearch, targetOrigin);
  const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;

  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || value === undefined) continue;
    headers[lower] = value;
  }
  headers.host = target.host;

  const upstream = transport(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers,
    },
    (upstreamRes) => {
      const responseHeaders = { ...SECURITY_HEADERS };
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        const lower = key.toLowerCase();
        if (HOP_BY_HOP.has(lower) || value === undefined) continue;
        responseHeaders[lower] = value;
      }
      // Always enforce no-store on proxied authenticated API responses.
      responseHeaders['cache-control'] = 'no-store';
      res.writeHead(upstreamRes.statusCode ?? 502, responseHeaders);
      upstreamRes.pipe(res);
    },
  );

  upstream.on('error', () => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(502, {
      ...SECURITY_HEADERS,
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    });
    res.end(
      JSON.stringify({
        error: {
          type: 'server_error',
          code: 'upstream_unavailable',
          message: 'Could not reach gateway upstream.',
        },
      }),
    );
  });

  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}
