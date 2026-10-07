// telegram.js - Telegram Bot API orqali guruhga yetkazish va kuryer xabarlari
const axios = require('axios');
const crypto = require('node:crypto');
const { db } = require('./database');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

async function getSetting(key) {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

async function setSetting(key, value) {
  await db.run(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `, [key, value]);
}

function getBotToken() {
  return getSetting('bot_token').then(value => value || process.env.TELEGRAM_BOT_TOKEN || '');
}

async function getAppUrl() {
  const configuredUrl = await getSetting('app_url');
  const deploymentHost = process.env.VERCEL_URL;
  return (configuredUrl || process.env.APP_BASE_URL ||
    (deploymentHost ? `https://${deploymentHost}` : 'https://osaf.vercel.app')).replace(/\/+$/, '');
}

async function callTelegramApi(method, payload = {}) {
  const token = await getBotToken();
  if (!token) throw new Error('Telegram bot token sozlanmagan');
  const response = await axios.post(`https://api.telegram.org/bot${token}/${method}`, payload, { timeout: 10000 });
  if (!response.data || response.data.ok !== true) {
    throw new Error(`Telegram ${method} so‘rovi bajarilmadi`);
  }
  return response.data.result;
}

async function configureWebhook() {
  const token = await getBotToken();
  if (!token) throw new Error('Avval Telegram bot tokenini kiriting');

  const appUrl = await getAppUrl();
  let parsedAppUrl;
  try {
    parsedAppUrl = new URL(appUrl);
  } catch {
    throw new Error('Ilova manzili noto‘g‘ri');
  }
  if (parsedAppUrl.protocol !== 'https:' || parsedAppUrl.username || parsedAppUrl.password) {
    throw new Error('Telegram webhook uchun HTTPS manzil kiriting');
  }

  const webhookUrl = `${appUrl}/api/telegram/webhook`;
  const existingSecret = await getSetting('telegram_webhook_secret');
  const secret = existingSecret || crypto.randomBytes(32).toString('hex');
  await setSetting('telegram_webhook_secret', secret);
  await setSetting('app_url', appUrl);
  await callTelegramApi('setWebhook', {
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ['message']
  });
  await callTelegramApi('setMyCommands', {
    commands: [
      { command: 'start', description: 'OSAF ilovasini ochish' },
      { command: 'id', description: 'Telegram ID raqamingizni ko‘rish' },
      { command: 'admin', description: 'Admin buyurtmalar holati' },
      { command: 'orders', description: 'Buyurtmalarim yoki buyurtmalar holati' },
      { command: 'help', description: 'Bot buyruqlari' }
    ]
  });
  return { success: true, webhook_url: webhookUrl };
}

async function getBotStatus() {
  const token = await getBotToken();
  const appUrl = await getAppUrl();
  const settings = await db.all(
    "SELECT key, value FROM settings WHERE key IN ('group_chat_id', 'auto_send_telegram', 'telegram_webhook_secret', 'telegram_admin_id')"
  );
  const settingMap = Object.fromEntries(settings.map(setting => [setting.key, setting.value]));
  const result = {
    configured: Boolean(token),
    app_url: appUrl,
    webhook_url: `${appUrl}/api/telegram/webhook`,
    group_chat_configured: Boolean(settingMap.group_chat_id),
    admin_chat_configured: Boolean(settingMap.telegram_admin_id),
    auto_send: settingMap.auto_send_telegram === 'true',
    linked_users: Number((await db.get("SELECT COUNT(*) AS count FROM users WHERE telegram_id IS NOT NULL AND telegram_id <> ''"))?.count || 0),
    bot: null,
    webhook: null,
    error: null
  };
  if (!token) return result;
  try {
    const [bot, webhook] = await Promise.all([
      callTelegramApi('getMe'),
      callTelegramApi('getWebhookInfo')
    ]);
    result.bot = { id: bot.id, username: bot.username, first_name: bot.first_name };
    result.webhook = {
      url: webhook.url,
      pending_update_count: webhook.pending_update_count || 0,
      last_error_date: webhook.last_error_date || null,
      last_error_message: webhook.last_error_message || null
    };
  } catch (error) {
    result.error = error.message;
  }
  return result;
}

async function sendBotMessage(chatId, text, replyMarkup) {
  return callTelegramApi('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...(replyMarkup ? { reply_markup: replyMarkup } : {})
  });
}

async function sendDocument(chatId, fileName, buffer, caption) {
  const token = await getBotToken();
  if (!token) throw new Error('Telegram bot token sozlanmagan');
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('caption', caption);
  form.append('document', new Blob([buffer]), fileName);
  const response = await axios.post(
    `https://api.telegram.org/bot${token}/sendDocument`,
    form,
    { timeout: 30000 }
  );
  if (!response.data || response.data.ok !== true) {
    throw new Error('Telegram hisobot faylini qabul qilmadi');
  }
  await logBotActivity(chatId, `${caption} — ${fileName}`, 'document_sent');
  return response.data.result;
}

async function sendReportsToAdmins(files, caption) {
  const recipients = new Set();
  const configuredAdminId = (await getSetting('telegram_admin_id')) || process.env.TELEGRAM_ADMIN_ID;
  const groupId = (await getSetting('group_chat_id')) || process.env.TELEGRAM_CHAT_ID;
  if (configuredAdminId) recipients.add(configuredAdminId);
  if (groupId) recipients.add(groupId);
  const owners = await db.all(`
    SELECT telegram_id FROM users
    WHERE role = 'owner' AND status = 'active' AND telegram_id IS NOT NULL AND telegram_id <> ''
  `);
  owners.forEach(owner => recipients.add(owner.telegram_id));
  if (!recipients.size) return { sent: false, simulated: true, recipients: [] };

  for (const recipient of recipients) {
    for (const file of files) await sendDocument(recipient, file.name, file.buffer, caption);
  }
  return { sent: true, simulated: false, recipients: [...recipients] };
}

async function notifyOwner(message) {
  const results = [];
  try {
    const recipients = new Set();
    const configuredAdminId = (await getSetting('telegram_admin_id')) || process.env.TELEGRAM_ADMIN_ID;
    const groupId = (await getSetting('group_chat_id')) || process.env.TELEGRAM_CHAT_ID;
    if (configuredAdminId) recipients.add(String(configuredAdminId));
    if (groupId) recipients.add(String(groupId));
    const owners = await db.all(`
      SELECT telegram_id FROM users
      WHERE role = 'owner' AND status = 'active' AND telegram_id IS NOT NULL AND telegram_id <> ''
    `);
    owners.forEach(owner => recipients.add(String(owner.telegram_id)));
    if (!recipients.size) {
      return { results: [{ success: false, error: 'Ega uchun Telegram chat ID sozlanmagan' }] };
    }

    const appUrl = await getAppUrl();
    for (const chatId of recipients) {
      try {
        await sendBotMessage(chatId, message, {
          inline_keyboard: [[{ text: 'Buyurtmani ilovada ko‘rish', url: appUrl }]]
        });
        results.push({ chat_id: chatId, success: true });
      } catch (error) {
        results.push({ chat_id: chatId, success: false, error: error.message });
      }
    }
  } catch (error) {
    console.error('Owner Telegram notification failed:', error.message);
    results.push({ success: false, error: error.message });
  }
  return { results };
}

async function logBotActivity(chatId, message, status) {
  await db.run(
    'INSERT INTO telegram_logs (chat_id, message, status) VALUES (?, ?, ?)',
    [String(chatId), message, status]
  );
}

async function processTelegramUpdate(update) {
  if (!update || !Number.isSafeInteger(update.update_id)) return { ignored: true };
  const updateMessage = update.message;
  const chatId = updateMessage && updateMessage.chat && updateMessage.chat.id;
  const telegramUser = updateMessage && updateMessage.from;
  const text = updateMessage && typeof updateMessage.text === 'string' ? updateMessage.text.trim() : '';
  if (!chatId || !telegramUser || !text) return { ignored: true };

  const reserved = await db.run(
    'INSERT INTO telegram_updates (update_id) VALUES (?) ON CONFLICT(update_id) DO NOTHING',
    [update.update_id]
  );
  if (!reserved.changes) return { duplicate: true };

  try {
    const user = await db.get(
      "SELECT id, full_name, role, status FROM users WHERE telegram_id = ?",
      [String(telegramUser.id)]
    );
    const command = text.split(/\s+/)[0].split('@')[0].toLowerCase();
    const appUrl = await getAppUrl();
    const appButton = {
      inline_keyboard: [[{ text: 'OSAF ilovasini ochish', url: appUrl }]]
    };
    let reply;
    let markup = appButton;

    if (command === '/start') {
      reply = user && user.status === 'active'
        ? `Assalomu alaykum, <b>${escapeHtml(user.full_name)}</b>! OSAF tizimiga xush kelibsiz.\nTelegram ID: <code>${escapeHtml(telegramUser.id)}</code>`
        : `OSAF Gilam Yuvish botiga xush kelibsiz!\nTelegram ID: <code>${escapeHtml(telegramUser.id)}</code>\nAdmin ushbu ID ni xodim profilingizga bog‘lagach bot buyruqlari ochiladi.`;
    } else if (command === '/id') {
      reply = `Telegram ID raqamingiz: <code>${escapeHtml(telegramUser.id)}</code>`;
    } else if (command === '/help') {
      reply = 'Buyruqlar:\n/start — salomlashish va Telegram ID\n/id — Telegram ID raqamingiz\n/orders — buyurtmalar holati\n/admin — adminlar uchun holat paneli\n/help — yordam';
    } else if (command === '/admin') {
      const configuredAdminId = (await getSetting('telegram_admin_id')) || process.env.TELEGRAM_ADMIN_ID || '';
      const isConfiguredAdmin = String(telegramUser.id) === String(configuredAdminId);
      const isPrivilegedUser = user && user.status === 'active' && ['owner', 'admin'].includes(user.role);
      if ((!isConfiguredAdmin && !isPrivilegedUser) || updateMessage.chat.type && updateMessage.chat.type !== 'private') {
        reply = 'Bu buyruq faqat egasi va adminlar uchun. Buyurtmalaringiz uchun /orders yuboring.';
      } else {
        const [stats, customers, couriers, latestOrders] = await Promise.all([
          db.get(`
            SELECT
              COUNT(*) AS total_orders,
              SUM(CASE WHEN status = 'yangi' THEN 1 ELSE 0 END) AS new_orders,
              SUM(CASE WHEN status = 'qabul_qilindi' THEN 1 ELSE 0 END) AS accepted_orders,
              SUM(CASE WHEN status IN ('yuvishda', 'quritishda', 'qadoqlayapti') THEN 1 ELSE 0 END) AS washing_orders,
              SUM(CASE WHEN status = 'tayyor' THEN 1 ELSE 0 END) AS ready_orders,
              SUM(CASE WHEN status = 'yetkazilmoqda' THEN 1 ELSE 0 END) AS delivering_orders,
              SUM(CASE WHEN status = 'yetkazildi' THEN 1 ELSE 0 END) AS delivered_orders,
              SUM(CASE WHEN status = 'bekor_qilindi' THEN 1 ELSE 0 END) AS cancelled_orders,
              COALESCE(SUM(CASE WHEN status <> 'bekor_qilindi' THEN final_amount ELSE 0 END), 0) AS revenue,
              COALESCE(SUM(CASE WHEN status <> 'bekor_qilindi' THEN paid_amount ELSE 0 END), 0) AS paid,
              COALESCE(SUM(CASE WHEN status <> 'bekor_qilindi' AND final_amount > paid_amount THEN final_amount - paid_amount ELSE 0 END), 0) AS debt,
              COALESCE(SUM(total_items), 0) AS total_items,
              COALESCE(SUM(total_area), 0) AS total_area
            FROM orders
          `),
          db.get('SELECT COUNT(*) AS count FROM customers'),
          db.get("SELECT COUNT(*) AS count FROM users WHERE role = 'courier' AND status = 'active'"),
          db.all(`
            SELECT o.order_number, o.status, o.final_amount, c.full_name AS customer_name
            FROM orders o
            JOIN customers c ON c.id = o.customer_id
            ORDER BY o.id DESC
            LIMIT 5
          `)
        ]);
        const money = value => `${Number(value || 0).toLocaleString('uz-UZ')} so‘m`;
        const recent = latestOrders.length
          ? latestOrders.map(order =>
            `• <b>${escapeHtml(order.order_number)}</b> — ${escapeHtml(order.customer_name)}, ${escapeHtml(order.status)}, ${money(order.final_amount)}`
          ).join('\n')
          : 'Buyurtmalar yo‘q';
        reply = [
          '<b>OSAF — to‘liq boshqaruv statistikasi</b>',
          `Buyurtmalar jami: <b>${Number(stats.total_orders || 0)}</b>`,
          `Yangi: ${Number(stats.new_orders || 0)} · Qabul qilindi: ${Number(stats.accepted_orders || 0)}`,
          `Yuvish/quritish: ${Number(stats.washing_orders || 0)} · Tayyor: ${Number(stats.ready_orders || 0)}`,
          `Yetkazilmoqda: ${Number(stats.delivering_orders || 0)} · Yetkazildi: ${Number(stats.delivered_orders || 0)}`,
          `Bekor qilingan: ${Number(stats.cancelled_orders || 0)}`,
          `Tushum: <b>${money(stats.revenue)}</b>`,
          `To‘langan: ${money(stats.paid)} · Qoldiq: ${money(stats.debt)}`,
          `Gilam/buyumlar: ${Number(stats.total_items || 0)} ta · Maydon: ${Number(stats.total_area || 0).toFixed(1)} m²`,
          `Mijozlar: ${Number(customers.count || 0)} · Faol kuryerlar: ${Number(couriers.count || 0)}`,
          '',
          '<b>So‘nggi buyurtmalar:</b>',
          recent
        ].join('\n');
      }
    } else if (command === '/orders') {
      if (!user || user.status !== 'active') {
        reply = 'Botdan foydalanish uchun Telegram profilingizni tizimdagi xodim akkauntiga bog‘lash kerak. /start buyrug‘ini yuboring.';
      } else if (user.role === 'courier') {
        const orders = await db.all(`
          SELECT o.order_number, o.status, c.full_name AS customer_name, c.address AS customer_address
          FROM orders o
          JOIN customers c ON c.id = o.customer_id
          WHERE (o.courier_pickup_id = ? OR o.courier_delivery_id = ?)
            AND o.status NOT IN ('yetkazildi', 'bekor_qilindi')
          ORDER BY o.id DESC LIMIT 10
        `, [user.id, user.id]);
        reply = orders.length
          ? `<b>Sizga biriktirilgan faol buyurtmalar:</b>\n${orders.map(order =>
            `• <b>${escapeHtml(order.order_number)}</b> — ${escapeHtml(order.status)}\n  ${escapeHtml(order.customer_name)}, ${escapeHtml(order.customer_address)}`
          ).join('\n')}`
          : 'Sizga hozircha faol buyurtma biriktirilmagan.';
      } else if (user.role === 'owner' || user.role === 'admin') {
        const statuses = await db.all('SELECT status, COUNT(*) AS count FROM orders GROUP BY status ORDER BY status');
        const orders = await db.all(`
          SELECT o.order_number, o.status, c.full_name AS customer_name
          FROM orders o JOIN customers c ON c.id = o.customer_id
          ORDER BY o.id DESC LIMIT 8
        `);
        const statusLines = statuses.map(row =>
          `• ${escapeHtml(row.status)}: ${Number(row.count)}`
        ).join('\n');
        const recentOrders = orders.map(order =>
          `• <b>${escapeHtml(order.order_number)}</b> — ${escapeHtml(order.status)}, ${escapeHtml(order.customer_name)}`
        ).join('\n');
        reply = `<b>Buyurtmalar holati (${statuses.reduce((sum, row) => sum + Number(row.count), 0)} ta):</b>\n${statusLines || 'Buyurtma yo‘q'}\n\n<b>So‘nggi buyurtmalar:</b>\n${recentOrders || 'Buyurtma yo‘q'}`;
      } else {
        reply = 'Ushbu profil uchun bot buyruqlari mavjud emas.';
      }
    } else {
      reply = 'Buyruq tushunilmadi. Buyruqlar ro‘yxati uchun /help yuboring.';
    }

    if (!['/start', '/admin'].includes(command) && user && user.status === 'active') markup = null;
    await sendBotMessage(chatId, reply, markup);
    await logBotActivity(chatId, `IN: ${text}\nOUT: ${reply}`, 'bot_reply_sent');
    return { success: true };
  } catch (error) {
    await db.run('DELETE FROM telegram_updates WHERE update_id = ?', [update.update_id]);
    await logBotActivity(chatId, `IN: ${text}\nERROR: ${error.message}`, 'bot_reply_failed');
    throw error;
  }
}

async function notifyCourierHandoff(order, assignment, fromCourier, toCourier, notes) {
  const assignmentName = assignment === 'pickup' ? 'Olib ketish' : 'Mijozga yetkazish';
  const noteText = notes ? `\nIzoh: ${escapeHtml(notes)}` : '';
  const message = `🔁 <b>Buyurtma kuryerga topshirildi</b>\n${escapeHtml(order.order_number)}\nBosqich: ${assignmentName}\nKimdan: ${escapeHtml(fromCourier.full_name)}\nKimga: ${escapeHtml(toCourier.full_name)}${noteText}`;
  const appUrl = await getAppUrl();
  const results = [];
  for (const courier of [fromCourier, toCourier]) {
    if (!courier.telegram_id) {
      results.push({
        courier_id: courier.id,
        success: false,
        skipped: true,
        error: 'Telegram profili bog‘lanmagan'
      });
      continue;
    }
    try {
      await sendBotMessage(courier.telegram_id, message, {
        inline_keyboard: [[{ text: 'Buyurtmani ilovada ko‘rish', url: `${appUrl}` }]]
      });
      await logBotActivity(courier.telegram_id, message, 'handoff_notice_sent');
      results.push({ courier_id: courier.id, success: true });
    } catch (error) {
      await logBotActivity(courier.telegram_id, message, `handoff_notice_failed: ${error.message}`);
      results.push({ courier_id: courier.id, success: false, error: error.message });
    }
  }
  return results;
}

// Telegram guruhiga yoki kanalga xabar yuborish
async function sendTelegramMessage(text, parseMode = 'HTML', locationObj = null) {
  const token = (await getSetting('bot_token')) || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = (await getSetting('group_chat_id')) || process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    // Agar bot sozlanmagan bo'lsa, log qilib qo'yamiz va simulyatsiya hisoblanadi
    await db.run(`
      INSERT INTO telegram_logs (chat_id, message, status)
      VALUES (?, ?, ?)
    `, [chatId || 'NOT_CONFIGURED', text, 'simulated']);
    return {
      success: true,
      simulated: true,
      message: "Telegram Bot Token yoki Guruh ID kiritilmagan. Xabar tizim jurnalida (Simulyatsiya) saqlandi."
    };
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await axios.post(url, {
      chat_id: chatId,
      text: text,
      parse_mode: parseMode,
      disable_web_page_preview: false
    }, { timeout: 10000 });

    // Agar lokatsiya koordinatalari bo'lsa, xaritadagi nuqtani ham alohida sendLocation orqali guruhga tashlaymiz!
    if (locationObj && locationObj.latitude && locationObj.longitude) {
      try {
        await axios.post(`https://api.telegram.org/bot${token}/sendLocation`, {
          chat_id: chatId,
          latitude: locationObj.latitude,
          longitude: locationObj.longitude
        }, { timeout: 10000 });
      } catch (locErr) {
        console.error("sendLocation error:", locErr.message);
      }
    }

    await db.run(`
      INSERT INTO telegram_logs (chat_id, message, status)
      VALUES (?, ?, ?)
    `, [chatId, text, 'sent']);

    return { success: true, simulated: false, data: response.data };
  } catch (error) {
    const errMsg = error.response ? JSON.stringify(error.response.data) : error.message;
    await db.run(`
      INSERT INTO telegram_logs (chat_id, message, status)
      VALUES (?, ?, ?)
    `, [chatId, text, 'failed: ' + errMsg]);
    return { success: false, error: errMsg };
  }
}

// Holat o'zgarganda yoki buyurtma olinganda guruhga chiroyli xabar tayyorlash
async function formatOrderMessage(orderId, actionType = 'status_change') {
  const order = await db.get(`
    SELECT o.*, 
      c.full_name as customer_name, c.phone as customer_phone, c.address as customer_address, c.landmark,
      u1.full_name as courier_pickup_name, u1.phone as courier_pickup_phone,
      u2.full_name as courier_deliv_name, u2.phone as courier_deliv_phone
    FROM orders o
    JOIN customers c ON o.customer_id = c.id
    LEFT JOIN users u1 ON o.courier_pickup_id = u1.id
    LEFT JOIN users u2 ON o.courier_delivery_id = u2.id
    WHERE o.id = ?
  `, [orderId]);

  if (!order) return null;

  const items = await db.all('SELECT * FROM order_items WHERE order_id = ?', [orderId]);

  let statusEmoji = '🆕';
  let statusUz = 'Yangi buyurtma';
  if (order.status === 'qabul_qilindi') { statusEmoji = '📦'; statusUz = 'Qabul qilindi (Kuryer oldi)'; }
  else if (order.status === 'yuvishda') { statusEmoji = '🧼'; statusUz = 'Yuvish jarayonida (Sexda)'; }
  else if (order.status === 'quritishda') { statusEmoji = '☀️'; statusUz = 'Quritish kamerasida'; }
  else if (order.status === 'qadoqlayapti') { statusEmoji = '📦'; statusUz = 'Qadoqlanmoqda'; }
  else if (order.status === 'tayyor') { statusEmoji = '✨'; statusUz = 'Qadoqlangan, yetkazishga tayyor'; }
  else if (order.status === 'yetkazilmoqda') { statusEmoji = '🚚'; statusUz = 'Dastavchik yo\'lda (Yetkazilmoqda)'; }
  else if (order.status === 'yetkazildi') { statusEmoji = '✅'; statusUz = 'Mijozga yetkazib topshirildi'; }
  else if (order.status === 'bekor_qilindi') { statusEmoji = '❌'; statusUz = 'Bekor qilindi'; }

  let msg = `<b>${statusEmoji} GILAM YUVISH BILDIRISHNOMASI</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🔢 <b>Tartib raqami:</b> <code>#${order.id}</code>\n`;
  msg += `📋 <b>Buyurtma kodi:</b> <code>${escapeHtml(order.order_number)}</code>\n`;
  msg += `⚡ <b>Hozirgi holat:</b> <b>${statusUz}</b>\n\n`;

  msg += `👤 <b>Mijoz:</b> ${escapeHtml(order.customer_name)}\n`;
  msg += `📞 <b>Telefon:</b> <a href="tel:${escapeHtml(order.customer_phone)}">${escapeHtml(order.customer_phone)}</a>\n`;
  msg += `📍 <b>Manzil:</b> ${escapeHtml(order.customer_address)}\n`;
  if (order.landmark) {
    msg += `🏢 <b>Mo'ljal:</b> ${escapeHtml(order.landmark)}\n`;
  }

  // Geolocation navigator havolalari (Yandex Navigator va Google Maps)
  if (order.latitude && order.longitude) {
    const yandexNav = `https://yandex.com/maps/?rtext=~${order.latitude},${order.longitude}&rtt=auto`;
    const googleMaps = `https://www.google.com/maps/search/?api=1&query=${order.latitude},${order.longitude}`;
    msg += `🗺️ <b>Navigator:</b> <a href="${yandexNav}">Yandex Navigator</a> | <a href="${googleMaps}">Google Xarita</a>\n`;
  }
  msg += `\n`;

  // Belgilangan nuqsonlar / belgilar
  if (order.defect_tags) {
    msg += `⚠️ <b>Maxsus belgilar:</b> <code>${escapeHtml(order.defect_tags)}</code>\n\n`;
  }

  msg += `🧺 <b>Buyumlar tafsiloti (${items.length} ta):</b>\n`;
  items.forEach((item, index) => {
    let sizeStr = '';
    if (item.length > 0 && item.width > 0) {
      sizeStr = `(${item.length}m × ${item.width}m = <b>${item.area.toFixed(2)} m²</b>)`;
    } else {
      sizeStr = `(<b>${item.quantity} dona</b>)`;
    }
    msg += `  ${index + 1}. <b>${escapeHtml(item.item_type)}</b> ${sizeStr} - ${item.subtotal.toLocaleString()} so'm\n`;
    if (item.notes) {
      msg += `     <i>Belgi: ${escapeHtml(item.notes)}</i>\n`;
    }
  });

  msg += `\n`;
  msg += `📐 <b>Jami maydon:</b> ${order.total_area ? order.total_area.toFixed(2) : 0} m²\n`;
  msg += `💰 <b>Jami summa:</b> ${order.final_amount.toLocaleString()} so'm\n`;
  msg += `💳 <b>To'lov holati:</b> ${order.payment_status === 'tolandi' ? '🟢 To\'langan' : (order.paid_amount > 0 ? `🟡 Qisman (${order.paid_amount.toLocaleString()} so'm to'langan)` : '🔴 To\'lanmagan')}\n`;

  if (order.courier_pickup_name || order.courier_deliv_name) {
    msg += `\n🛵 <b>Dastavchik:</b>\n`;
    if (order.courier_pickup_name) {
      msg += `  • Olib keluvchi: <b>${escapeHtml(order.courier_pickup_name)}</b> (${escapeHtml(order.courier_pickup_phone || '')})\n`;
    }
    if (order.courier_deliv_name) {
      msg += `  • Yetkazib beruvchi: <b>${escapeHtml(order.courier_deliv_name)}</b> (${escapeHtml(order.courier_deliv_phone || '')})\n`;
    }
  }

  if (order.courier_notes) {
    msg += `\n📝 <b>Kuryer izohi:</b> ${escapeHtml(order.courier_notes)}\n`;
  }
  if (order.target_delivery_date) {
    msg += `📅 <b>Yetkazish muddati:</b> ${escapeHtml(order.target_delivery_date)}\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `⏰ <i>Vaqt: ${new Date().toLocaleString('uz-UZ')}</i>`;

  return {
    text: msg,
    location: (order.latitude && order.longitude) ? { latitude: order.latitude, longitude: order.longitude } : null
  };
}

module.exports = {
  escapeHtml,
  sendTelegramMessage,
  formatOrderMessage,
  getSetting,
  setSetting,
  configureWebhook,
  getBotStatus,
  processTelegramUpdate,
  notifyCourierHandoff,
  sendReportsToAdmins,
  notifyOwner
};
