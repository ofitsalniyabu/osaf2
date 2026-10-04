// telegram.js - Telegram Bot API orqali guruhga yetkazish va kuryer xabarlari
const axios = require('axios');
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
  else if (order.status === 'tayyor') { statusEmoji = '✨'; statusUz = 'Yuvib tayyorlandi (Qadoqlangan)'; }
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
  sendTelegramMessage,
  formatOrderMessage,
  getSetting,
  setSetting
};
