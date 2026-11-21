import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { proxyToGateway, sendNotFound, serveStaticAsset } from './proxy-util.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADMIN_DIR = join(__dirname, 'admin');
const SHARED_DIR = join(__dirname, 'shared');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const KEY_ID_ROUTE = /^\/admin\/v1\/keys\/([\da-f-]{36})(\/requests)?$/;
const USER_ID_ROUTE = /^\/admin\/v1\/users\/([\da-f-]{36})$/;

const STATIC_ROUTES = new Map([
  ['/', { file: join(ADMIN_DIR, 'index.html'), type: 'text/html; charset=utf-8', cache: 'no-store' }],
  ['/admin', { file: join(ADMIN_DIR, 'index.html'), type: 'text/html; charset=utf-8', cache: 'no-store' }],
  ['/admin/', { file: join(ADMIN_DIR, 'index.html'), type: 'text/html; charset=utf-8', cache: 'no-store' }],
  ['/admin/assets/passport.css', { file: join(SHARED_DIR, 'passport.css'), type: 'text/css; charset=utf-8', cache: 'no-store' }],
  ['/admin/assets/admin.css', { file: join(ADMIN_DIR, 'admin.css'), type: 'text/css; charset=utf-8', cache: 'no-store' }],
  ['/admin/assets/admin.js', { file: join(ADMIN_DIR, 'admin.js'), type: 'text/javascript; charset=utf-8', cache: 'no-store' }],
  ['/admin/assets/format.js', { file: join(SHARED_DIR, 'format.js'), type: 'text/javascript; charset=utf-8', cache: 'no-store' }],
  ['/favicon.ico', { file: join(SHARED_DIR, 'favicon.svg'), type: 'image/svg+xml', cache: 'no-store' }],
  ['/admin/assets/favicon.svg', { file: join(SHARED_DIR, 'favicon.svg'), type: 'image/svg+xml', cache: 'no-store' }],
]);

function isAllowedAdminApi(method, pathname) {
  if (pathname === '/admin/v1/login' || pathname === '/admin/v1/logout') return method === 'POST';
  if (pathname === '/admin/v1/models') return method === 'GET';
  if (pathname === '/admin/v1/users') return method === 'GET';
  if (USER_ID_ROUTE.test(pathname)) return method === 'GET' || method === 'PATCH';
  if (pathname === '/admin/v1/keys') return method === 'GET' || method === 'POST';
  const match = KEY_ID_ROUTE.exec(pathname);
  if (!match) return false;
  const isRequests = Boolean(match[2]);
  if (isRequests) return method === 'GET';
  return method === 'GET' || method === 'PATCH' || method === 'DELETE';
}

export function assertLoopbackHost(host) {
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`Admin frontend must bind to loopback only (127.0.0.1 or ::1), got: ${host}`);
  }
}

export function createAdminFrontendServer({ gatewayOrigin = 'http://127.0.0.1:20129' } = {}) {
  const origin = new URL(gatewayOrigin).origin;

  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const { pathname, search } = url;

    if (req.method === 'GET' && STATIC_ROUTES.has(pathname)) {
      const asset = STATIC_ROUTES.get(pathname);
      return serveStaticAsset(res, asset.file, asset.type, asset.cache);
    }

    if (isAllowedAdminApi(req.method, pathname)) {
      return proxyToGateway(req, res, origin, `${pathname}${search}`);
    }

    return sendNotFound(res);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.ADMIN_UI_HOST ?? '127.0.0.1';
  assertLoopbackHost(host);
  const port = Number(process.env.ADMIN_UI_PORT ?? '20131');
  const gatewayOrigin = process.env.GATEWAY_ORIGIN ?? 'http://127.0.0.1:20129';
  const server = createAdminFrontendServer({ gatewayOrigin });
  server.listen(port, host, () => {
    console.info(`Private admin frontend listening on http://${host}:${port}/ -> ${gatewayOrigin}`);
  });
}
