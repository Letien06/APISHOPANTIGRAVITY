import { createAdminFrontendServer } from './server-admin.mjs';
import { createPublicFrontendServer } from './server-public.mjs';
import { createMockGateway, MOCK_CREDENTIALS } from './mock-gateway.mjs';

const MOCK_PORT = Number(process.env.MOCK_GATEWAY_PORT ?? '20199');
const PUBLIC_PORT = Number(process.env.PUBLIC_UI_PORT ?? '20132');
const ADMIN_PORT = Number(process.env.ADMIN_UI_PORT ?? '20131');

const mockGateway = createMockGateway();
const gatewayOrigin = `http://127.0.0.1:${MOCK_PORT}`;
const publicServer = createPublicFrontendServer({ gatewayOrigin });
const adminServer = createAdminFrontendServer({ gatewayOrigin });

await Promise.all([
  new Promise((resolve) => mockGateway.listen(MOCK_PORT, '127.0.0.1', resolve)),
  new Promise((resolve) => publicServer.listen(PUBLIC_PORT, '127.0.0.1', resolve)),
  new Promise((resolve) => adminServer.listen(ADMIN_PORT, '127.0.0.1', resolve)),
]);

console.info('\n=== Giao diện Gateway 9Router (Chế độ Mock cục bộ) ===');
console.info(`Trang công khai /usage : http://127.0.0.1:${PUBLIC_PORT}/usage`);
console.info(`Trang quản trị (SSH)   : http://127.0.0.1:${ADMIN_PORT}/`);
console.info(`Mock Gateway           : ${gatewayOrigin}`);
console.info('\nKhóa thử nghiệm giả (chỉ dùng cục bộ):');
console.info(`  Admin token          : ${MOCK_CREDENTIALS.adminToken}`);
console.info(`  Key đang hoạt động   : ${MOCK_CREDENTIALS.activeKey}`);
console.info(`  Key đã hết hạn       : ${MOCK_CREDENTIALS.expiredKey}`);
console.info(`  Key hết hạn mức      : ${MOCK_CREDENTIALS.exhaustedKey}`);
console.info(`  Key bị vô hiệu hóa   : ${MOCK_CREDENTIALS.disabledKey}`);
console.info(`  Key lịch sử trống    : ${MOCK_CREDENTIALS.emptyKey}\n`);

function shutdown() {
  publicServer.close();
  adminServer.close();
  mockGateway.close();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
