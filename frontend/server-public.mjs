import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { proxyToGateway, sendNotFound, serveStaticAsset } from './proxy-util.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const SHARED_DIR = join(__dirname, 'shared');

const CONSOLE_KEY_ROUTE = /^\/api\/console\/keys\/([\da-f-]{36})(\/requests|\/secret)?$/;

const STATIC_ROUTES = new Map([
  ['/', { file: join(PUBLIC_DIR, 'index.html'), type: 'text/html; charset=utf-8', cache: 'no-store' }],
  ['/sign-in', { file: join(PUBLIC_DIR, 'auth.html'), type: 'text/html; charset=utf-8', cache: 'no-store' }],
  ['/sign-in/', { file: join(PUBLIC_DIR, 'auth.html'), type: 'text/html; charset=utf-8', cache: 'no-store' }],
  ['/sign-up', { file: join(PUBLIC_DIR, 'auth.html'), type: 'text/html; charset=utf-8', cache: 'no-store' }],
  ['/sign-up/', { file: join(PUBLIC_DIR, 'auth.html'), type: 'text/html; charset=utf-8', cache: 'no-store' }],
  ['/console', { file: join(PUBLIC_DIR, 'console.html'), type: 'text/html; charset=utf-8', cache: 'no-store' }],
  ['/console/', { file: join(PUBLIC_DIR, 'console.html'), type: 'text/html; charset=utf-8', cache: 'no-store' }],
  ['/usage', { file: join(PUBLIC_DIR, 'usage.html'), type: 'text/html; charset=utf-8', cache: 'no-store' }],
  ['/usage/', { file: join(PUBLIC_DIR, 'usage.html'), type: 'text/html; charset=utf-8', cache: 'no-store' }],
  ['/docs', { file: join(PUBLIC_DIR, 'docs.html'), type: 'text/html; charset=utf-8', cache: 'no-store' }],
  ['/docs/', { file: join(PUBLIC_DIR, 'docs.html'), type: 'text/html; charset=utf-8', cache: 'no-store' }],
  ['/assets/passport.css', { file: join(SHARED_DIR, 'passport.css'), type: 'text/css; charset=utf-8', cache: 'public, max-age=300' }],
  ['/assets/format.js', { file: join(SHARED_DIR, 'format.js'), type: 'text/javascript; charset=utf-8', cache: 'public, max-age=300' }],
  ['/assets/landing.js', { file: join(PUBLIC_DIR, 'landing.js'), type: 'text/javascript; charset=utf-8', cache: 'public, max-age=300' }],
  ['/assets/auth.js', { file: join(PUBLIC_DIR, 'auth.js'), type: 'text/javascript; charset=utf-8', cache: 'public, max-age=300' }],
  ['/assets/console.js', { file: join(PUBLIC_DIR, 'console.js'), type: 'text/javascript; charset=utf-8', cache: 'public, max-age=300' }],
  ['/assets/docs.js', { file: join(PUBLIC_DIR, 'docs.js'), type: 'text/javascript; charset=utf-8', cache: 'public, max-age=300' }],
  ['/usage/assets/passport.css', { file: join(SHARED_DIR, 'passport.css'), type: 'text/css; charset=utf-8', cache: 'public, max-age=300' }],
  ['/usage/assets/usage.css', { file: join(PUBLIC_DIR, 'usage.css'), type: 'text/css; charset=utf-8', cache: 'public, max-age=300' }],
  ['/usage/assets/usage.js', { file: join(PUBLIC_DIR, 'usage.js'), type: 'text/javascript; charset=utf-8', cache: 'public, max-age=300' }],
  ['/usage/assets/format.js', { file: join(SHARED_DIR, 'format.js'), type: 'text/javascript; charset=utf-8', cache: 'public, max-age=300' }],
  ['/favicon.ico', { file: join(SHARED_DIR, 'favicon.svg'), type: 'image/svg+xml', cache: 'public, max-age=3600' }],
  ['/assets/favicon.svg', { file: join(SHARED_DIR, 'favicon.svg'), type: 'image/svg+xml', cache: 'public, max-age=3600' }],
  ['/usage/assets/favicon.svg', { file: join(SHARED_DIR, 'favicon.svg'), type: 'image/svg+xml', cache: 'public, max-age=3600' }],
]);

const ALLOWED_GET_PROXIES = new Set([
  '/api/public/models',
  '/api/auth/me',
  '/api/console/keys',
  '/api/usage',
  '/api/usage/requests',
  '/v1/models',
]);

const ALLOWED_POST_PROXIES = new Set([
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/console/keys',
  '/v1/chat/completions',
  '/v1/responses',
]);

function isAllowedConsoleKeyProxy(method, pathname) {
  const match = CONSOLE_KEY_ROUTE.exec(pathname);
  if (!match) return false;
  const isRequests = Boolean(match[2]);
  if (isRequests) return method === 'GET';
  return method === 'GET' || method === 'PATCH' || method === 'DELETE';
}

export function createPublicFrontendServer({ gatewayOrigin = 'http://127.0.0.1:20129' } = {}) {
  const origin = new URL(gatewayOrigin).origin;

  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const { pathname, search } = url;

    if (req.method === 'GET' && STATIC_ROUTES.has(pathname)) {
      const asset = STATIC_ROUTES.get(pathname);
      return serveStaticAsset(res, asset.file, asset.type, asset.cache);
    }

    if (
      (req.method === 'GET' && ALLOWED_GET_PROXIES.has(pathname))
      || (req.method === 'POST' && ALLOWED_POST_PROXIES.has(pathname))
      || isAllowedConsoleKeyProxy(req.method, pathname)
    ) {
      return proxyToGateway(req, res, origin, `${pathname}${search}`);
    }

    // Strict deny-by-default: admin UI, admin assets, /admin/v1/*, /healthz, /dashboard all return 404.
    return sendNotFound(res);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.PUBLIC_UI_HOST ?? '127.0.0.1';
  const port = Number(process.env.PUBLIC_UI_PORT ?? '20132');
  const gatewayOrigin = process.env.GATEWAY_ORIGIN ?? 'http://127.0.0.1:20129';
  const server = createPublicFrontendServer({ gatewayOrigin });
  server.listen(port, host, () => {
    console.info(`Public portal listening on http://${host}:${port}/ -> ${gatewayOrigin}`);
  });
}
