const assert = require('node:assert/strict');
const { X509Certificate } = require('node:crypto');
const { spawn } = require('node:child_process');
const ExcelJS = require('exceljs');
const https = require('node:https');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

let child;
let baseUrl;
let tempDirectory;
let credentials;
let ownerCookie;
let courierCookie;
let operatorCookie;

async function reservePort() {
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const { port } = listener.address();
  await new Promise(resolve => listener.close(resolve));
  return port;
}

async function request(route, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = {
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.headers || {})
    };
    const req = https.request(`${baseUrl}${route}`, {
      method: options.method || 'GET',
      headers,
      rejectUnauthorized: false
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks);
        const responseHeaders = new Map(
          Object.entries(response.headers).map(([name, value]) => [
            name.toLowerCase(),
            Array.isArray(value) ? value.join(', ') : value
          ])
        );
        resolve({
          status: response.statusCode,
          headers: { get: name => responseHeaders.get(name.toLowerCase()) || null },
          json: async () => JSON.parse(body.toString('utf8')),
          text: async () => body.toString('utf8'),
          arrayBuffer: async () => Uint8Array.from(body)
        });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function login(username, password) {
  const captchaResponse = await request('/api/auth/captcha');
  assert.equal(captchaResponse.status, 200);
  const captcha = (await captchaResponse.json()).data;
  const response = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      captcha_id: captcha.id,
      captcha_answer: captcha.test_answer
    })
  });
  const data = await response.json();
  return { response, data, cookie: response.headers.get('set-cookie') };
}

before(async () => {
  tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'carpet-system-test-'));
  const port = await reservePort();
  baseUrl = `https://localhost:${port}`;

  child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      CARPET_DB_PATH: path.join(tempDirectory, 'test.db'),
      USERPROFILE: tempDirectory,
      HOME: tempDirectory,
      PORT: String(port),
      NODE_ENV: 'test'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Test server did not start: ${output}`)), 30000);
    const onData = chunk => {
      output += chunk.toString();
      if (output.includes(`https://localhost:${port} da ishga tushdi`)) {
        clearTimeout(timeout);
        child.stdout.off('data', onData);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    child.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`Test server exited with code ${code}: ${output}`));
    });
  });

  const ownerMatch = output.match(/ega: ([A-Za-z0-9_-]+)/);
  const operatorMatch = output.match(/operator: ([A-Za-z0-9_-]+)/);
  const courierMatch = output.match(/kuryer1: ([A-Za-z0-9_-]+)/);
  const secondCourierMatch = output.match(/kuryer2: ([A-Za-z0-9_-]+)/);
  assert.ok(ownerMatch, 'fresh database should print the one-time owner password');
  assert.ok(operatorMatch, 'fresh database should print the one-time operator password');
  assert.ok(courierMatch, 'fresh database should print the one-time courier password');
  assert.ok(secondCourierMatch, 'fresh database should print the second courier password');
  credentials = {
    owner: ownerMatch[1],
    operator: operatorMatch[1],
    courier: courierMatch[1],
    courier2: secondCourierMatch[1]
  };

  const generatedCertPath = path.join(tempDirectory, '.toza-gilam', 'localhost-cert.pem');
  const generatedKeyPath = path.join(tempDirectory, '.toza-gilam', 'localhost-key.pem');
  const certificate = new X509Certificate(await readFile(generatedCertPath));
  assert.match(certificate.subjectAltName, /DNS:localhost/);
  assert.equal(Date.parse(certificate.validTo) > Date.now(), true);
  assert.equal((await readFile(generatedKeyPath, 'utf8')).includes('PRIVATE KEY'), true);
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
  }
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
});

test('login page is served without exposing demo credentials', async () => {
  const response = await request('/');
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(baseUrl, /^https:/);
  assert.match(html, /id="loginScreen"/);
  assert.match(html, /id="passwordModal"/);
  assert.match(html, /<div class="form-row" id="orderCourierAssignmentFields">[\s\S]*?id="orderPickupCourier"/);
  assert.match(html, /id="custPhone" required/);
  assert.match(html, /password-visibility-toggle/);
  for (const inputId of ['loginPassword', 'tgBotToken', 'newStaffPass', 'currentPassword', 'newPassword', 'confirmNewPassword']) {
    assert.match(html, new RegExp(`togglePasswordVisibility\\('${inputId}', this\\)`));
  }
  assert.match(html, /loginCaptchaImage/);
  assert.match(html, /amaldagi parollar hech kimga ko‘rsatilmaydi/i);
  const appScript = await request('/app.js');
  const appScriptText = await appScript.text();
  assert.match(appScriptText, /Yangi vaqtinchalik parol/);
  assert.match(html, /quickCalcSizePresets/);
  assert.match(appScriptText, /Yetkazib berish/);
  assert.match(appScriptText, /title="Yetkazib berish ma'lumotlari"/);
  assert.match(appScriptText, /Gilam olingan sana/);
  assert.match(appScriptText, /Buyurtma ID/);
  assert.match(appScriptText, /Mijoz ID/);
  assert.match(appScriptText, /Qabul qiluvchi/);
  assert.match(appScriptText, /Qo‘shimcha izoh/);
  assert.match(appScriptText, /customerPhoneLinks/);
  assert.match(appScriptText, /Yetkazishga chiqish/);
  assert.match(html, /id="tab-washer-mode"/);
  assert.match(html, /option value="washer">Yuvuvchi/);
  assert.match(appScriptText, /saveWasherMeasurements/);
  assert.match(appScriptText, /loadOwnerNotifications/);
  assert.doesNotMatch(html, /id="orderCourierAssignmentFields">[\s\S]*?id="custPhone"/);
  assert.doesNotMatch(html, /preset-sizes-bar|applyPresetToActiveRow/);
  assert.doesNotMatch(html, /fillLoginForm|admin123/);
});

test('health endpoint reports the active persistent database driver', async () => {
  const response = await request('/api/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, database: 'sqlite' });
});

test('a second server on the same port exits with a clear error', async () => {
  const duplicate = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      CARPET_DB_PATH: path.join(tempDirectory, 'duplicate.db'),
      USERPROFILE: path.join(tempDirectory, 'duplicate-home'),
      HOME: path.join(tempDirectory, 'duplicate-home'),
      PORT: baseUrl.split(':').pop(),
      NODE_ENV: 'test'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  duplicate.stdout.on('data', chunk => { output += chunk.toString(); });
  duplicate.stderr.on('data', chunk => { output += chunk.toString(); });
  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      duplicate.kill();
      reject(new Error(`Duplicate server failed to exit: ${output}`));
    }, 30000);
    duplicate.once('exit', code => {
      clearTimeout(timeout);
      resolve(code);
    });
  });

  assert.equal(exitCode, 1);
  assert.match(output, /3000-port .* band/);
  assert.match(output, /Ctrl\+C/);
});

test('unauthenticated API access is denied and login creates an HttpOnly session', async () => {
  const denied = await request('/api/orders');
  assert.equal(denied.status, 401);

  const crossOrigin = await request('/api/orders', { headers: { Origin: 'https://attacker.example' } });
  assert.equal(crossOrigin.status, 403);

  const invalidLogin = await login('ega', 'wrong-password');
  assert.equal(invalidLogin.response.status, 401);

  const owner = await login('ega', credentials.owner);
  assert.equal(owner.response.status, 200);
  assert.equal(owner.data.user.role, 'owner');
  assert.equal(Object.hasOwn(owner.data.user, 'password'), false);
  assert.match(owner.cookie, /HttpOnly/);
  assert.match(owner.cookie, /SameSite=Strict/);
  assert.match(owner.cookie, /;\s*Secure/);
  assert.match(owner.cookie, /Max-Age=2592000/);
  ownerCookie = owner.cookie.split(';')[0];
  const restoredSession = await request('/api/auth/me', { cookie: ownerCookie });
  assert.equal(restoredSession.status, 200);
  assert.equal((await restoredSession.json()).user.role, 'owner');
});

test('login requires a valid one-time CAPTCHA challenge', async () => {
  const challengeResponse = await request('/api/auth/captcha');
  const challenge = (await challengeResponse.json()).data;
  const missing = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ega', password: credentials.owner })
  });
  assert.equal(missing.status, 400);

  const valid = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'ega',
      password: credentials.owner,
      captcha_id: challenge.id,
      captcha_answer: challenge.test_answer
    })
  });
  assert.equal(valid.status, 200);

  const replay = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'ega',
      password: credentials.owner,
      captcha_id: challenge.id,
      captcha_answer: challenge.test_answer
    })
  });
  assert.equal(replay.status, 400);
});

test('Telegram send buttons accept bodyless POST requests', async () => {
  const telegramTest = await request('/api/telegram/test', {
    cookie: ownerCookie,
    method: 'POST'
  });

  assert.equal(telegramTest.status, 200);
  assert.equal((await telegramTest.json()).success, true);

  const orderTelegram = await request('/api/orders/1/send-telegram', {
    cookie: ownerCookie,
    method: 'POST'
  });
  assert.equal(orderTelegram.status, 200);
  assert.equal((await orderTelegram.json()).success, true);
  const logsResponse = await request('/api/telegram/logs', { cookie: ownerCookie });
  const logs = await logsResponse.json();
  assert.match(logs.data[0].message, /Tartib raqami:<\/b> <code>#1<\/code>/);
});

test('couriers can only read assigned orders and cannot access owner data', async () => {
  const courier = await login('kuryer1', credentials.courier);
  assert.equal(courier.response.status, 200);
  courierCookie = courier.cookie.split(';')[0];

  const ordersResponse = await request('/api/orders', { cookie: courierCookie });
  const orders = await ordersResponse.json();
  assert.equal(ordersResponse.status, 200);
  assert.ok(orders.data.every(order =>
    order.courier_pickup_id === courier.data.user.id ||
    order.courier_delivery_id === courier.data.user.id
  ));

  const forbiddenOrder = await request('/api/orders/2', { cookie: courierCookie });
  assert.equal(forbiddenOrder.status, 403);
  const ownOrder = await request('/api/orders/1', { cookie: courierCookie });
  assert.equal(ownOrder.status, 200);
  const ownOrderData = (await ownOrder.json()).data;
  assert.equal(Object.hasOwn(ownOrderData, 'admin_notes'), false);
  assert.equal(typeof ownOrderData.customer_name, 'string');
  assert.equal(typeof ownOrderData.customer_phone, 'string');
  assert.equal(typeof ownOrderData.customer_address, 'string');
  assert.ok(ownOrderData.items.length > 0);
  assert.equal(typeof ownOrderData.target_delivery_date, 'string');
  const forbiddenUpdate = await request('/api/orders/2/status', {
    cookie: courierCookie,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'yetkazildi', paid_amount: 270000 })
  });
  assert.equal(forbiddenUpdate.status, 403);
  assert.equal((await request('/api/settings', { cookie: courierCookie })).status, 403);
  assert.equal((await request('/api/reports/excel', { cookie: courierCookie })).status, 403);
});

test('owner can inspect and revoke active device sessions without exposing passwords', async () => {
  const response = await request('/api/sessions', { cookie: ownerCookie });
  const sessions = await response.json();
  assert.equal(response.status, 200);
  assert.ok(sessions.data.some(session => session.role === 'owner'));
  assert.ok(sessions.data.some(session => session.role === 'courier'));
  assert.ok(sessions.data.every(session => !Object.hasOwn(session, 'password')));

  const courierSession = sessions.data.find(session => session.role === 'courier');
  const revoked = await request(`/api/sessions/${courierSession.session_id}`, {
    cookie: ownerCookie,
    method: 'DELETE'
  });
  assert.equal(revoked.status, 200);
});

test('operators cannot access owner-only settings or financial summaries', async () => {
  const operator = await login('operator', credentials.operator);
  assert.equal(operator.response.status, 200);
  operatorCookie = operator.cookie.split(';')[0];

  const statsResponse = await request('/api/stats', { cookie: operatorCookie });
  const stats = await statsResponse.json();
  assert.equal(statsResponse.status, 200);
  assert.equal(Object.hasOwn(stats.data, 'total_revenue'), false);
  assert.equal((await request('/api/settings', { cookie: operatorCookie })).status, 403);
  assert.equal((await request('/api/reports/excel', { cookie: operatorCookie })).status, 403);
});

test('owner can reset a staff password once and the old session is revoked', async () => {
  const response = await request('/api/users/2/reset-password', {
    cookie: ownerCookie,
    method: 'POST'
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(typeof result.temporary_password, 'string');
  assert.ok(result.temporary_password.length >= 20);
  assert.equal((await request('/api/stats', { cookie: operatorCookie })).status, 401);

  const operator = await login('operator', result.temporary_password);
  assert.equal(operator.response.status, 200);
  operatorCookie = operator.cookie.split(';')[0];
  credentials.operator = result.temporary_password;
});

test('owner Excel export keeps all report worksheets', async () => {
  const response = await request('/api/reports/excel', { cookie: ownerCookie });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /spreadsheetml/);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), [
    'Buyurtmalar Hisoboti',
    "Gilam va Adyollar Ro'yxati",
    'Kassa va Xarajatlar'
  ]);
  assert.equal(workbook.worksheets[0].getCell('A1').value, '№');
});

test('owner permissions and server-side service pricing are enforced', async () => {
  const ordersResponse = await request('/api/orders', { cookie: ownerCookie });
  assert.equal(ordersResponse.status, 200);

  const invalidOrder = await request('/api/orders', {
    cookie: ownerCookie,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_name: 'Test Customer',
      customer_phone: '+998901112233',
      customer_address: 'Test address',
      discount: -100,
      items: [{ category_id: 1, length: 2, width: 3, unit_price: 1, quantity: 1 }]
    })
  });
  assert.equal(invalidOrder.status, 400);

  const created = await request('/api/orders', {
    cookie: ownerCookie,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_name: 'Test Customer',
      customer_phone: '+998901112233',
      customer_address: 'Test address',
      items: [{ category_id: 1, length: 2, width: 3, unit_price: 1, quantity: 1 }]
    })
  });
  assert.equal(created.status, 200);
  const createdData = await created.json();
  const { orderId } = createdData;
  assert.equal(createdData.orderNumber, '#GLM-1005');
  assert.equal(createdData.telegram?.success, true);
  assert.equal(createdData.telegram?.simulated, true);
  const detailsResponse = await request(`/api/orders/${orderId}`, { cookie: ownerCookie });
  const details = await detailsResponse.json();
  assert.equal(details.data.items[0].unit_price, 15000);
  assert.equal(details.data.items[0].subtotal, 90000);

  const telegramResponse = await request(`/api/orders/${orderId}/send-telegram`, {
    cookie: ownerCookie,
    method: 'POST'
  });
  assert.equal(telegramResponse.status, 200);
  const logsResponse = await request('/api/telegram/logs', { cookie: ownerCookie });
  const logs = await logsResponse.json();
  assert.match(logs.data[0].message, new RegExp(`Tartib raqami:<\\/b> <code>#${orderId}<\\/code>`));

  const exported = await request('/api/reports/excel', { cookie: ownerCookie });
  assert.equal(exported.status, 200);
  assert.equal(exported.headers.get('x-exported-orders'), '1');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await exported.arrayBuffer()));
  assert.equal(workbook.worksheets[0].getRow(2).getCell(2).value, createdData.orderNumber);

  const duplicateExport = await request('/api/reports/excel', { cookie: ownerCookie });
  assert.equal(duplicateExport.status, 204);
});

test('only active courier accounts can be assigned and assignment notifications stay valid', async () => {
  const invalidRequest = await request('/api/orders/1/assign-courier', {
    cookie: ownerCookie,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ courier_delivery_id: 1 })
  });
  assert.equal(invalidRequest.status, 400);

  const assigned = await request('/api/orders/1/assign-courier', {
    cookie: ownerCookie,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ courier_delivery_id: 4 })
  });
  assert.equal(assigned.status, 200);

  const orderResponse = await request('/api/orders/1', { cookie: ownerCookie });
  assert.equal((await orderResponse.json()).data.courier_delivery_id, 4);
});

test('couriers can register collected items and confirm delivery to the wash shop', async () => {
  const courier = await login('kuryer1', credentials.courier);
  const courierId = courier.data.user.id;
  const courierSession = courier.cookie.split(';')[0];
  const created = await request('/api/orders', {
    cookie: courierSession,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_name: 'Test mijoz',
      customer_phone: '+998901234567',
      customer_address: 'Toshkent, test manzil',
      courier_pickup_id: 999,
      courier_delivery_id: 999,
      discount: 50000,
      paid_amount: 50000,
      admin_notes: 'Kuryer yuborgan maxfiy izoh',
      items: [{ category_id: 1, length: 2, width: 3, quantity: 2 }]
    })
  });
  assert.equal(created.status, 200);
  const { orderId } = await created.json();

  const detailsResponse = await request(`/api/orders/${orderId}`, { cookie: ownerCookie });
  const { data: order } = await detailsResponse.json();
  assert.equal(order.courier_pickup_id, courierId);
  assert.equal(order.courier_delivery_id, null);
  assert.equal(order.status, 'yangi');
  assert.equal(order.final_amount, 0);
  assert.equal(order.total_area, 0);
  assert.equal(order.paid_amount, 0);
  assert.equal(order.admin_notes, '');

  const handoff = await request(`/api/orders/${orderId}/status`, {
    cookie: courierSession,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'qabul_qilindi' })
  });
  assert.equal(handoff.status, 200);
  const updatedOrder = await request(`/api/orders/${orderId}`, { cookie: ownerCookie });
  assert.equal((await updatedOrder.json()).data.status, 'qabul_qilindi');

  const handedOver = await request(`/api/orders/${orderId}/handoff`, {
    cookie: courierSession,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignment: 'pickup', to_courier_id: 4, notes: 'Boshqa mashinaga topshirildi' })
  });
  assert.equal(handedOver.status, 200);
  const afterHandoff = await request(`/api/orders/${orderId}`, { cookie: ownerCookie });
  const handedOrder = (await afterHandoff.json()).data;
  assert.equal(handedOrder.courier_pickup_id, 4);
  assert.equal(handedOrder.handoffs.length, 1);
  assert.equal(handedOrder.handoffs[0].from_courier_name, 'Jasur Rustamov (Dastavchik #1)');
  assert.equal((await request(`/api/orders/${orderId}`, { cookie: courierSession })).status, 403);

  const washerAccount = await request('/api/users', {
    cookie: ownerCookie,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'washer-test',
      password: 'washer-password-123',
      full_name: 'Test yuvuvchi',
      role: 'washer'
    })
  });
  assert.equal(washerAccount.status, 200);
  const washerLogin = await login('washer-test', 'washer-password-123');
  assert.equal(washerLogin.data.user.role, 'washer');
  const washerCookie = washerLogin.cookie.split(';')[0];
  assert.equal((await request('/api/orders', { cookie: washerCookie })).status, 403);
  const washerWork = await request('/api/washer/orders', { cookie: washerCookie });
  assert.equal(washerWork.status, 200);
  assert.ok((await washerWork.json()).data.some(order => order.id === orderId));

  for (const status of ['yuvishda', 'quritishda', 'qadoqlayapti']) {
    const advanced = await request(`/api/washer/orders/${orderId}/status`, {
      cookie: washerCookie,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    assert.equal(advanced.status, 200);
  }
  const deliveryCourier = await login('kuryer2', credentials.courier2);
  const deliveryCourierSession = deliveryCourier.cookie.split(';')[0];
  const packagingOrders = await request('/api/orders', { cookie: deliveryCourierSession });
  assert.ok((await packagingOrders.json()).data.some(order =>
    order.id === orderId && order.status === 'qadoqlayapti'
  ));
  const courierCannotChangeWasherPricing = await request(`/api/washer/orders/${orderId}/measurements`, {
    cookie: deliveryCourierSession,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ measurements: [] })
  });
  assert.equal(courierCannotChangeWasherPricing.status, 403);
  const dispatchBeforeMeasurement = await request(`/api/orders/${orderId}/status`, {
    cookie: deliveryCourierSession,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'yetkazilmoqda' })
  });
  assert.equal(dispatchBeforeMeasurement.status, 403);
  const itemId = order.items[0].id;
  const invalidMeasure = await request(`/api/washer/orders/${orderId}/measurements`, {
    cookie: washerCookie,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ measurements: [{ id: itemId, length: 0, width: 4 }] })
  });
  assert.equal(invalidMeasure.status, 400);
  const measured = await request(`/api/washer/orders/${orderId}/measurements`, {
    cookie: washerCookie,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ measurements: [{ id: itemId, length: 3, width: 4, unit_price: 20000 }] })
  });
  assert.equal(measured.status, 200);
  assert.equal((await measured.json()).status, 'qadoqlayapti');
  const readyOrder = (await (await request(`/api/orders/${orderId}`, { cookie: ownerCookie })).json()).data;
  assert.equal(readyOrder.status, 'qadoqlayapti');
  assert.equal(readyOrder.total_area, 24);
  assert.equal(readyOrder.items[0].unit_price, 20000);
  assert.equal(readyOrder.items[0].subtotal, 480000);
  assert.equal(readyOrder.payment_status, 'kutilmoqda');
  assert.equal(readyOrder.courier_delivery_id, 4);
  const readyForCourier = await request('/api/orders', { cookie: deliveryCourierSession });
  assert.ok((await readyForCourier.json()).data.some(order =>
    order.id === orderId && order.status === 'qadoqlayapti'
  ));

  const startedDelivery = await request(`/api/orders/${orderId}/status`, {
    cookie: deliveryCourierSession,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'yetkazilmoqda' })
  });
  assert.equal(startedDelivery.status, 200);
  assert.ok((await startedDelivery.json()).notification_warning);
  const notifications = await request('/api/owner-notifications', { cookie: ownerCookie });
  const notificationData = (await notifications.json()).data;
  assert.equal(notifications.status, 200);
  assert.ok(notificationData.some(notification =>
    notification.order_id === orderId && notification.message.includes('sexdan olib')
  ));
  const markedRead = await request('/api/owner-notifications/read', {
    cookie: ownerCookie,
    method: 'POST'
  });
  assert.equal(markedRead.status, 200);
});

test('Telegram status is visible to the owner, webhook is protected, and daily cron requires a secret', async () => {
  const status = await request('/api/telegram/status', { cookie: ownerCookie });
  assert.equal(status.status, 200);
  assert.equal((await status.json()).data.configured, false);

  const blockedWebhook = await request('/api/telegram/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ update_id: 1 })
  });
  assert.equal(blockedWebhook.status, 403);

  const blockedCron = await request('/api/cron/daily-reports');
  assert.equal(blockedCron.status, 503);
});

test('users can change their own password without losing the active session', async () => {
  const tooShort = await request('/api/auth/change-password', {
    cookie: ownerCookie,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: credentials.owner, new_password: 'short7!' })
  });
  assert.equal(tooShort.status, 400);

  const newPassword = 'changed-owner-password-2026';
  const changed = await request('/api/auth/change-password', {
    cookie: ownerCookie,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: credentials.owner, new_password: newPassword })
  });
  assert.equal(changed.status, 200);
  assert.equal((await request('/api/orders', { cookie: ownerCookie })).status, 200);
  assert.equal((await login('ega', credentials.owner)).response.status, 401);

  const newLogin = await login('ega', newPassword);
  assert.equal(newLogin.response.status, 200);
  ownerCookie = newLogin.cookie.split(';')[0];
});

test('owner can configure the order-number starting value from admin settings', async () => {
  const settingsResponse = await request('/api/settings', { cookie: ownerCookie });
  assert.equal(settingsResponse.status, 200);

  const saveResponse = await request('/api/settings', {
    cookie: ownerCookie,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_number_start: 1234 })
  });
  assert.equal(saveResponse.status, 200);

  const created = await request('/api/orders', {
    cookie: ownerCookie,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_name: 'Order Start Test',
      customer_phone: '+998901234567',
      customer_address: 'Setting test address',
      items: [{ category_id: 1, length: 2, width: 3, unit_price: 1, quantity: 1 }]
    })
  });
  assert.equal(created.status, 200);
  assert.equal((await created.json()).orderNumber, '#GLM-1234');
});

test('logout invalidates the server-side session', async () => {
  const response = await request('/api/auth/logout', { cookie: ownerCookie, method: 'POST' });
  assert.equal(response.status, 200);
  assert.equal((await request('/api/orders', { cookie: ownerCookie })).status, 401);
});
