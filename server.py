#!/usr/bin/env python3
import http.server
import socketserver
import json
import os
import sqlite3
import urllib.parse
import urllib.request
import shutil
import subprocess
import sys
from datetime import datetime

PORT = 3000
DB_FILE = os.path.join(os.path.dirname(__file__), 'carpet_system.db')
PUBLIC_DIR = os.path.join(os.path.dirname(__file__), 'public')

def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.executescript('''
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL,
        phone TEXT,
        car_model TEXT,
        car_number TEXT,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        unit TEXT NOT NULL,
        price_per_unit REAL NOT NULL,
        description TEXT,
        icon TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        phone2 TEXT,
        address TEXT NOT NULL,
        landmark TEXT,
        telegram_id TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT UNIQUE NOT NULL,
        customer_id INTEGER NOT NULL,
        courier_pickup_id INTEGER,
        courier_delivery_id INTEGER,
        status TEXT NOT NULL DEFAULT 'yangi',
        total_area REAL DEFAULT 0,
        total_items INTEGER DEFAULT 0,
        total_amount REAL DEFAULT 0,
        discount REAL DEFAULT 0,
        final_amount REAL DEFAULT 0,
        paid_amount REAL DEFAULT 0,
        payment_method TEXT DEFAULT 'naqd',
        payment_status TEXT DEFAULT 'kutilmoqda',
        pickup_date TEXT,
        target_delivery_date TEXT,
        delivered_date TEXT,
        courier_notes TEXT,
        admin_notes TEXT,
        latitude REAL,
        longitude REAL,
        location_address TEXT,
        defect_tags TEXT,
        rating INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        category_id INTEGER NOT NULL,
        item_type TEXT NOT NULL,
        barcode TEXT,
        length REAL DEFAULT 0,
        width REAL DEFAULT 0,
        area REAL DEFAULT 0,
        quantity INTEGER DEFAULT 1,
        unit_price REAL NOT NULL,
        subtotal REAL NOT NULL,
        notes TEXT,
        status TEXT DEFAULT 'yangi'
    );

    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER,
        type TEXT NOT NULL,
        category TEXT NOT NULL,
        amount REAL NOT NULL,
        payment_method TEXT DEFAULT 'naqd',
        description TEXT,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    );

    CREATE TABLE IF NOT EXISTS telegram_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER,
        chat_id TEXT,
        message TEXT,
        status TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    ''')
    conn.commit()

    # Yangi ustunlarni tekshirish
    for col in [("latitude", "REAL"), ("longitude", "REAL"), ("location_address", "TEXT"), ("defect_tags", "TEXT")]:
        try:
            c.execute(f"ALTER TABLE orders ADD COLUMN {col[0]} {col[1]}")
            conn.commit()
        except:
            pass

    # Foydalanuvchilar yo'q bo'lsa kiritish
    c.execute("SELECT COUNT(*) as count FROM users")
    if c.fetchone()['count'] == 0:
        c.execute("INSERT INTO users (username, password, full_name, role, phone, car_model, car_number) VALUES (?, ?, ?, ?, ?, ?, ?)",
                  ('ega', 'admin123', 'Akmal Rahimov (Ega Admin)', 'owner', '+998 90 123 45 67', 'Malibu 2', '01 A 777 AA'))
        c.execute("INSERT INTO users (username, password, full_name, role, phone, car_model, car_number) VALUES (?, ?, ?, ?, ?, ?, ?)",
                  ('operator', '123456', 'Dilshod Karimov (Admin Operator)', 'admin', '+998 93 234 56 78', None, None))
        c.execute("INSERT INTO users (username, password, full_name, role, phone, car_model, car_number) VALUES (?, ?, ?, ?, ?, ?, ?)",
                  ('kuryer1', '123456', 'Jasur Rustamov (Dastavchik #1)', 'courier', '+998 97 345 67 89', 'Damas', '01 888 CBA'))
        c.execute("INSERT INTO users (username, password, full_name, role, phone, car_model, car_number) VALUES (?, ?, ?, ?, ?, ?, ?)",
                  ('kuryer2', '123456', 'Azizbek Normatov (Dastavchik #2)', 'courier', '+998 94 456 78 90', 'Labo', '01 555 XYZ'))

        # Kategoriyalar
        cats = [
            ('Standart Gilam', 'kv_m', 15000, 'Kvadrat metr hisobida tozalash va yuvish', '🧶'),
            ('Jun va Ipak Gilam (Premium)', 'kv_m', 25000, 'Ehtiyotkorlik bilan maxsus shampunlarda yuvish', '✨'),
            ('Adyol (1 kishilik)', 'dona', 35000, 'Dona hisobida chuqur antibakterial tozalash', '🛏️'),
            ('Adyol (2 kishilik / Og\'ir)', 'dona', 45000, 'Yumshoq parvarish va quritish', '🛋️'),
            ('Gilamcha (Yo\'lakcha / Oshxona)', 'dona', 20000, 'Kichik o\'lchamdagi gilamcha va oyoq osti', '🚪'),
            ('Parda va Tyul', 'kv_m', 12000, 'Dazmollash va nozik tozalash', '🪟'),
            ('Yostiq tozalash', 'dona', 25000, 'Par tozalash va yangi g\'ilof', '🪶')
        ]
        for cat in cats:
            c.execute("INSERT INTO categories (name, unit, price_per_unit, description, icon) VALUES (?, ?, ?, ?, ?)", cat)

        # Settings
        c.execute("INSERT INTO settings (key, value) VALUES (?, ?)", ('bot_token', ''))
        c.execute("INSERT INTO settings (key, value) VALUES (?, ?)", ('group_chat_id', ''))
        c.execute("INSERT INTO settings (key, value) VALUES (?, ?)", ('company_name', 'TOZA GILAM PROFESSIONAL YUVISH MARKAZI'))
        c.execute("INSERT INTO settings (key, value) VALUES (?, ?)", ('company_phone', '+998 71 200 55 44'))
        c.execute("INSERT INTO settings (key, value) VALUES (?, ?)", ('company_address', 'Toshkent sh., Chilonzor tumani, 19-mavze'))
        c.execute("INSERT INTO settings (key, value) VALUES (?, ?)", ('auto_send_telegram', 'false'))

        # Customers
        c1 = c.execute("INSERT INTO customers (full_name, phone, phone2, address, landmark) VALUES (?, ?, ?, ?, ?)",
                       ('Jamshid Aliyev', '+998 90 911 22 33', '+998 71 277 88 99', 'Chilonzor-9, 14-uy, 28-xonadon', 'Rayhon milliy taomlari orqasi')).lastrowid
        c2 = c.execute("INSERT INTO customers (full_name, phone, phone2, address, landmark) VALUES (?, ?, ?, ?, ?)",
                       ('Zilola Karimova', '+998 93 555 44 33', '', 'Yunusobod-13, 5-uy, 12-xonadon', 'Mega Planet yonida')).lastrowid
        c3 = c.execute("INSERT INTO customers (full_name, phone, phone2, address, landmark) VALUES (?, ?, ?, ?, ?)",
                       ('Bobur Saidov', '+998 97 777 88 99', '', 'Mirzo Ulug\'bek, TTZ-2, 45-uy', 'Diyora to\'yxonasi ro\'parasida')).lastrowid
        c4 = c.execute("INSERT INTO customers (full_name, phone, phone2, address, landmark) VALUES (?, ?, ?, ?, ?)",
                       ('Nodira Xolmatova', '+998 91 333 22 11', '', 'Yakkasaroy tumani, Shota Rustaveli 45', 'Birodarlik qabristoni yaqinida')).lastrowid

        # Orders
        o1 = c.execute('''
            INSERT INTO orders (order_number, customer_id, courier_pickup_id, courier_delivery_id, status, total_area, total_items, total_amount, discount, final_amount, paid_amount, payment_method, payment_status, pickup_date, target_delivery_date, courier_notes, admin_notes, latitude, longitude, defect_tags)
            VALUES (?, ?, ?, ?, 'yuvishda', 18.5, 3, 292500, 12500, 280000, 100000, 'naqd', 'qisman', '2026-10-01 10:30', '2026-10-04', '3-qavat lift yoq', 'Qahva dogi bor', 41.2856, 69.2034, '☕ Qahva/Choy dogi')
        ''', ('#GLM-1001', c1, 3, 3)).lastrowid

        c.execute("INSERT INTO order_items (order_id, category_id, item_type, barcode, length, width, area, quantity, unit_price, subtotal, notes) VALUES (?, 1, 'Standart Gilam', '#GLM1001-1', 4.0, 3.0, 12.0, 1, 15000, 180000, 'Qizil naqshli, qahva dogi')", (o1,))
        c.execute("INSERT INTO order_items (order_id, category_id, item_type, barcode, length, width, area, quantity, unit_price, subtotal, notes) VALUES (?, 1, 'Standart Gilam', '#GLM1001-2', 2.5, 2.6, 6.5, 1, 15000, 97500, 'Zal gilami')", (o1,))
        c.execute("INSERT INTO order_items (order_id, category_id, item_type, barcode, length, width, area, quantity, unit_price, subtotal, notes) VALUES (?, 5, 'Gilamcha (Yo''lakcha)', '#GLM1001-3', 0, 0, 0, 1, 20000, 20000, 'Yolakcha')", (o1,))

        o2 = c.execute('''
            INSERT INTO orders (order_number, customer_id, courier_pickup_id, courier_delivery_id, status, total_area, total_items, total_amount, discount, final_amount, paid_amount, payment_method, payment_status, pickup_date, target_delivery_date, courier_notes, admin_notes, latitude, longitude, defect_tags)
            VALUES (?, ?, ?, ?, 'yetkazilmoqda', 15.0, 2, 270000, 0, 270000, 0, 'click', 'kutilmoqda', '2026-09-29 14:00', '2026-10-02', 'Eshik kodi: 45k', 'Kechki 18:00 dan keyin yetkazilsin', 41.3654, 69.2891, '✂️ Chet qismi titilgan')
        ''', ('#GLM-1002', c2, 4, 4)).lastrowid

        c.execute("INSERT INTO order_items (order_id, category_id, item_type, barcode, length, width, area, quantity, unit_price, subtotal, notes) VALUES (?, 2, 'Jun va Ipak Gilam (Premium)', '#GLM1002-1', 5.0, 3.0, 15.0, 1, 25000, 375000, 'Qimmatbaho eron gilami')", (o2,))
        c.execute("INSERT INTO order_items (order_id, category_id, item_type, barcode, length, width, area, quantity, unit_price, subtotal, notes) VALUES (?, 4, 'Adyol (2 kishilik)', '#GLM1002-2', 0, 0, 0, 1, 45000, 45000, 'Sinteponli adyol')", (o2,))

        conn.commit()
    conn.close()

# Telegramga xabar yuborish
def send_telegram(text, parse_mode='HTML', lat=None, lon=None):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT value FROM settings WHERE key='bot_token'")
    row_token = c.fetchone()
    token = row_token['value'] if row_token else ''

    c.execute("SELECT value FROM settings WHERE key='group_chat_id'")
    row_chat = c.fetchone()
    chat_id = row_chat['value'] if row_chat else ''

    if not token or not chat_id:
        c.execute("INSERT INTO telegram_logs (chat_id, message, status) VALUES (?, ?, ?)",
                  (chat_id or 'NOT_CONFIGURED', text, 'simulated'))
        conn.commit()
        conn.close()
        return {"success": True, "simulated": True, "message": "Telegram Bot Token yoki Guruh ID kiritilmagan. Xabar tizim jurnalida (Simulyatsiya) saqlandi."}

    try:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        data = json.dumps({"chat_id": chat_id, "text": text, "parse_mode": parse_mode}).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            pass

        if lat and lon:
            loc_url = f"https://api.telegram.org/bot{token}/sendLocation"
            loc_data = json.dumps({"chat_id": chat_id, "latitude": lat, "longitude": lon}).encode('utf-8')
            loc_req = urllib.request.Request(loc_url, data=loc_data, headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(loc_req, timeout=10) as resp:
                pass

        c.execute("INSERT INTO telegram_logs (chat_id, message, status) VALUES (?, ?, ?)", (chat_id, text, 'sent'))
        conn.commit()
        conn.close()
        return {"success": True, "simulated": False}
    except Exception as e:
        c.execute("INSERT INTO telegram_logs (chat_id, message, status) VALUES (?, ?, ?)", (chat_id, text, f'failed: {str(e)}'))
        conn.commit()
        conn.close()
        return {"success": False, "error": str(e)}

def format_order_tg(order_id):
    conn = get_db()
    c = conn.cursor()
    order = c.execute('''
        SELECT o.*, c.full_name as customer_name, c.phone as customer_phone, c.address as customer_address, c.landmark,
               u1.full_name as courier_pickup_name, u1.phone as courier_pickup_phone,
               u2.full_name as courier_deliv_name, u2.phone as courier_deliv_phone
        FROM orders o
        JOIN customers c ON o.customer_id = c.id
        LEFT JOIN users u1 ON o.courier_pickup_id = u1.id
        LEFT JOIN users u2 ON o.courier_delivery_id = u2.id
        WHERE o.id = ?
    ''', (order_id,)).fetchone()

    if not order:
        conn.close()
        return None

    items = c.execute("SELECT * FROM order_items WHERE order_id = ?", (order_id,)).fetchall()
    conn.close()

    status_map = {
        'yangi': ('🆕', 'Yangi tushgan'),
        'qabul_qilindi': ('📦', 'Qabul qilindi (Kuryer oldi)'),
        'yuvishda': ('🧼', 'Yuvish jarayonida (Sexda)'),
        'quritishda': ('☀️', 'Quritish kamerasida'),
        'tayyor': ('✨', 'Yuvib tayyorlandi (Qadoqlangan)'),
        'yetkazilmoqda': ('🚚', 'Dastavchik yo\'lda (Yetkazilmoqda)'),
        'yetkazildi': ('✅', 'Mijozga yetkazib topshirildi'),
        'bekor_qilindi': ('❌', 'Bekor qilindi')
    }
    emoji, st_name = status_map.get(order['status'], ('📋', order['status']))

    msg = f"<b>{emoji} GILAM YUVISH BILDIRISHNOMASI</b>\n"
    msg += "━━━━━━━━━━━━━━━━━━━━━\n"
    msg += f"📋 <b>Buyurtma kodi:</b> <code>{order['order_number']}</code>\n"
    msg += f"⚡ <b>Hozirgi holat:</b> <b>{st_name}</b>\n\n"
    msg += f"👤 <b>Mijoz:</b> {order['customer_name']}\n"
    msg += f"📞 <b>Telefon:</b> <a href=\"tel:{order['customer_phone']}\">{order['customer_phone']}</a>\n"
    msg += f"📍 <b>Manzil:</b> {order['customer_address']}\n"
    if order['landmark']:
        msg += f"🏢 <b>Mo'ljal:</b> {order['landmark']}\n"

    if order['latitude'] and order['longitude']:
        y_nav = f"https://yandex.com/maps/?rtext=~{order['latitude']},{order['longitude']}&rtt=auto"
        g_map = f"https://www.google.com/maps/search/?api=1&query={order['latitude']},{order['longitude']}"
        msg += f"🗺️ <b>Navigator:</b> <a href=\"{y_nav}\">Yandex Navigator</a> | <a href=\"{g_map}\">Google Xarita</a>\n"

    if order['defect_tags']:
        msg += f"⚠️ <b>Maxsus belgilar:</b> <code>{order['defect_tags']}</code>\n"

    msg += f"\n🧺 <b>Buyumlar tafsiloti ({len(items)} ta):</b>\n"
    for idx, it in enumerate(items):
        if it['length'] > 0 and it['width'] > 0:
            sz = f"({it['length']}m × {it['width']}m = <b>{it['area']:.2f} m²</b>)"
        else:
            sz = f"(<b>{it['quantity']} dona</b>)"
        msg += f"  {idx + 1}. <b>{it['item_type']}</b> {sz} - {it['subtotal']:,.0f} so'm\n"
        if it['notes']:
            msg += f"     <i>Belgi: {it['notes']}</i>\n"

    msg += f"\n📐 <b>Jami maydon:</b> {order['total_area'] or 0:.2f} m²\n"
    msg += f"💰 <b>Jami summa:</b> {order['final_amount']:,.0f} so'm\n"
    pay_st = "🟢 To'langan" if order['payment_status'] == 'tolandi' else (f"🟡 Qisman ({order['paid_amount']:,.0f} so'm)" if order['paid_amount'] > 0 else "🔴 To'lanmagan")
    msg += f"💳 <b>To'lov holati:</b> {pay_st}\n"

    if order['courier_pickup_name'] or order['courier_deliv_name']:
        msg += "\n🛵 <b>Dastavchik:</b>\n"
        if order['courier_pickup_name']:
            msg += f"  • Olib keluvchi: <b>{order['courier_pickup_name']}</b> ({order['courier_pickup_phone'] or ''})\n"
        if order['courier_deliv_name']:
            msg += f"  • Yetkazib beruvchi: <b>{order['courier_deliv_name']}</b> ({order['courier_deliv_phone'] or ''})\n"

    if order['courier_notes']:
        msg += f"\n📝 <b>Kuryer izohi:</b> {order['courier_notes']}\n"
    if order['target_delivery_date']:
        msg += f"📅 <b>Yetkazish muddati:</b> {order['target_delivery_date']}\n"

    msg += "━━━━━━━━━━━━━━━━━━━━━\n"
    msg += f"⏰ <i>Vaqt: {datetime.now().strftime('%Y-%m-%d %H:%M')}</i>"

    return {"text": msg, "lat": order['latitude'], "lon": order['longitude']}

# HTTP Request Handler
class CarpetHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data, default=str).encode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        if path == '/api/stats':
            conn = get_db()
            c = conn.cursor()
            stats = c.execute('''
                SELECT 
                  COUNT(*) as total_orders,
                  SUM(CASE WHEN status = 'yangi' THEN 1 ELSE 0 END) as new_orders,
                  SUM(CASE WHEN status = 'yuvishda' THEN 1 ELSE 0 END) as washing_orders,
                  SUM(CASE WHEN status = 'yetkazilmoqda' THEN 1 ELSE 0 END) as delivering_orders,
                  SUM(CASE WHEN status = 'yetkazildi' THEN 1 ELSE 0 END) as completed_orders,
                  COALESCE(SUM(final_amount), 0) as total_revenue,
                  COALESCE(SUM(paid_amount), 0) as total_paid,
                  COALESCE(SUM(total_area), 0) as total_sqm,
                  COALESCE(SUM(total_items), 0) as total_items
                FROM orders
            ''').fetchone()
            courier_cnt = c.execute("SELECT COUNT(*) as count FROM users WHERE role='courier'").fetchone()['count']
            cust_cnt = c.execute("SELECT COUNT(*) as count FROM customers").fetchone()['count']
            res_dict = dict(stats)
            res_dict['debt_amount'] = res_dict['total_revenue'] - res_dict['total_paid']
            res_dict['couriersCount'] = courier_cnt
            res_dict['customersCount'] = cust_cnt
            conn.close()
            return self._send_json({"success": True, "data": res_dict})

        elif path == '/api/orders':
            conn = get_db()
            c = conn.cursor()
            orders = c.execute('''
                SELECT o.*, 
                  c.full_name as customer_name, c.phone as customer_phone, c.address as customer_address, c.landmark,
                  u1.full_name as courier_pickup_name, u2.full_name as courier_deliv_name
                FROM orders o
                JOIN customers c ON o.customer_id = c.id
                LEFT JOIN users u1 ON o.courier_pickup_id = u1.id
                LEFT JOIN users u2 ON o.courier_delivery_id = u2.id
                ORDER BY o.id DESC
            ''').fetchall()
            order_list = []
            for ord in orders:
                od = dict(ord)
                items = c.execute("SELECT * FROM order_items WHERE order_id = ?", (od['id'],)).fetchall()
                od['items'] = [dict(it) for it in items]
                order_list.append(od)
            conn.close()
            return self._send_json({"success": True, "data": order_list})

        elif path.startswith('/api/orders/') and not path.endswith('/send-telegram'):
            order_id = path.split('/')[-1]
            conn = get_db()
            c = conn.cursor()
            order = c.execute('''
                SELECT o.*, 
                  c.full_name as customer_name, c.phone as customer_phone, c.phone2, c.address as customer_address, c.landmark,
                  u1.full_name as courier_pickup_name, u1.phone as courier_pickup_phone,
                  u2.full_name as courier_deliv_name, u2.phone as courier_deliv_phone
                FROM orders o
                JOIN customers c ON o.customer_id = c.id
                LEFT JOIN users u1 ON o.courier_pickup_id = u1.id
                LEFT JOIN users u2 ON o.courier_delivery_id = u2.id
                WHERE o.id = ?
            ''', (order_id,)).fetchone()
            if not order:
                conn.close()
                return self._send_json({"success": False, "error": "Topilmadi"}, 404)
            od = dict(order)
            items = c.execute("SELECT * FROM order_items WHERE order_id = ?", (od['id'],)).fetchall()
            od['items'] = [dict(it) for it in items]
            conn.close()
            return self._send_json({"success": True, "data": od})

        elif path == '/api/categories':
            conn = get_db()
            cats = conn.cursor().execute("SELECT * FROM categories ORDER BY id ASC").fetchall()
            conn.close()
            return self._send_json({"success": True, "data": [dict(c) for c in cats]})

        elif path == '/api/users':
            conn = get_db()
            users = conn.cursor().execute("SELECT id, username, full_name, role, phone, car_model, car_number, status, created_at FROM users").fetchall()
            conn.close()
            return self._send_json({"success": True, "data": [dict(u) for u in users]})

        elif path == '/api/settings':
            conn = get_db()
            settings = conn.cursor().execute("SELECT * FROM settings").fetchall()
            conn.close()
            s_dict = {s['key']: s['value'] for s in settings}
            return self._send_json({"success": True, "data": s_dict})

        elif path == '/api/telegram/logs':
            conn = get_db()
            logs = conn.cursor().execute("SELECT * FROM telegram_logs ORDER BY id DESC LIMIT 50").fetchall()
            conn.close()
            return self._send_json({"success": True, "data": [dict(l) for l in logs]})

        # Static files fallback (SPA)
        super().do_GET()

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8')
        data = json.loads(body) if body else {}

        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == '/api/auth/login':
            username = data.get('username')
            password = data.get('password')
            conn = get_db()
            user = conn.cursor().execute(
                "SELECT id, username, full_name, role, phone, car_model, car_number, status FROM users WHERE username = ? AND password = ?",
                (username, password)
            ).fetchone()
            conn.close()
            if user:
                return self._send_json({"success": True, "user": dict(user)})
            else:
                return self._send_json({"success": False, "error": "Login yoki parol noto'g'ri"}, 401)

        elif path == '/api/orders':
            conn = get_db()
            c = conn.cursor()

            cust_name = data.get('customer_name')
            cust_phone = data.get('customer_phone')
            cust_phone2 = data.get('customer_phone2', '')
            cust_addr = data.get('customer_address')
            landmark = data.get('landmark', '')

            # Customer
            cust = c.execute("SELECT id FROM customers WHERE phone = ?", (cust_phone,)).fetchone()
            if cust:
                cust_id = cust['id']
                c.execute("UPDATE customers SET full_name=?, address=?, landmark=?, phone2=? WHERE id=?",
                          (cust_name, cust_addr, landmark, cust_phone2, cust_id))
            else:
                cust_id = c.execute("INSERT INTO customers (full_name, phone, phone2, address, landmark) VALUES (?, ?, ?, ?, ?)",
                                    (cust_name, cust_phone, cust_phone2, cust_addr, landmark)).lastrowid

            items = data.get('items', [])
            total_area = 0
            total_items = 0
            total_amount = 0

            for it in items:
                l = float(it.get('length') or 0)
                w = float(it.get('width') or 0)
                q = int(it.get('quantity') or 1)
                p = float(it.get('unit_price') or 0)
                if l > 0 and w > 0:
                    area = round(l * w * q, 2)
                    subtotal = round(area * p)
                    total_area += area
                else:
                    area = 0
                    subtotal = round(q * p)
                total_items += q
                total_amount += subtotal
                it['area'] = area
                it['subtotal'] = subtotal

            disc = float(data.get('discount') or 0)
            final_amount = max(0, total_amount - disc)
            paid = float(data.get('paid_amount') or 0)
            pay_status = 'tolandi' if paid >= final_amount else ('qisman' if paid > 0 else 'kutilmoqda')

            max_o = c.execute("SELECT id FROM orders ORDER BY id DESC LIMIT 1").fetchone()
            next_num = (max_o['id'] if max_o else 0) + 1001
            order_number = f"#GLM-{next_num}"

            order_id = c.execute('''
                INSERT INTO orders (
                    order_number, customer_id, courier_pickup_id, courier_delivery_id, status,
                    total_area, total_items, total_amount, discount, final_amount, paid_amount,
                    payment_method, payment_status, pickup_date, target_delivery_date, courier_notes,
                    latitude, longitude, defect_tags
                ) VALUES (?, ?, ?, ?, 'yangi', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                order_number, cust_id, data.get('courier_pickup_id') or None, data.get('courier_delivery_id') or None,
                total_area, total_items, total_amount, disc, final_amount, paid,
                data.get('payment_method', 'naqd'), pay_status,
                data.get('pickup_date', datetime.now().strftime('%Y-%m-%d')),
                data.get('target_delivery_date', ''), data.get('courier_notes', ''),
                data.get('latitude') or None, data.get('longitude') or None, data.get('defect_tags', '')
            )).lastrowid

            for idx, it in enumerate(items):
                bcode = f"{order_number}-{idx+1}"
                c.execute('''
                    INSERT INTO order_items (order_id, category_id, item_type, barcode, length, width, area, quantity, unit_price, subtotal, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    order_id, it.get('category_id', 1), it.get('item_type', 'Gilam'), bcode,
                    it.get('length', 0), it.get('width', 0), it.get('area', 0),
                    it.get('quantity', 1), it.get('unit_price', 0), it.get('subtotal', 0), it.get('notes', '')
                ))

            conn.commit()
            conn.close()

            # Telegram auto send
            tg_info = format_order_tg(order_id)
            if tg_info:
                send_telegram(tg_info['text'], 'HTML', tg_info['lat'], tg_info['lon'])

            return self._send_json({"success": True, "orderId": order_id, "orderNumber": order_number})

        elif path.endswith('/send-telegram'):
            order_id = path.split('/')[-2]
            tg_info = format_order_tg(order_id)
            if tg_info:
                res = send_telegram(tg_info['text'], 'HTML', tg_info['lat'], tg_info['lon'])
                return self._send_json(res)
            return self._send_json({"success": False, "error": "Topilmadi"}, 404)

        elif path == '/api/telegram/test':
            test_msg = f"🚀 <b>TOZA GILAM BOSHQARUV TIZIMI TEST XABARI</b>\n\nTelegram Bot va Guruh aloqasi muvaffaqiyatli ishlayapti!\nSana: {datetime.now().strftime('%Y-%m-%d %H:%M')}"
            res = send_telegram(test_msg)
            return self._send_json(res)

        elif path == '/api/settings':
            conn = get_db()
            c = conn.cursor()
            for k in ['bot_token', 'group_chat_id', 'company_name', 'company_phone', 'company_address', 'auto_send_telegram']:
                if k in data:
                    c.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (k, str(data[k])))
            conn.commit()
            conn.close()
            return self._send_json({"success": True})

        elif path == '/api/categories':
            conn = get_db()
            c = conn.cursor()
            new_id = c.execute("INSERT INTO categories (name, unit, price_per_unit, description, icon) VALUES (?, ?, ?, ?, ?)",
                              (data.get('name'), data.get('unit', 'kv_m'), float(data.get('price_per_unit', 0)), data.get('description', ''), data.get('icon', '🧺'))).lastrowid
            conn.commit()
            conn.close()
            return self._send_json({"success": True, "id": new_id})

        elif path == '/api/users':
            conn = get_db()
            c = conn.cursor()
            new_id = c.execute("INSERT INTO users (username, password, full_name, role, phone, car_model, car_number) VALUES (?, ?, ?, ?, ?, ?, ?)",
                              (data.get('username'), data.get('password', '123456'), data.get('full_name'), data.get('role', 'courier'), data.get('phone', ''), data.get('car_model', ''), data.get('car_number', ''))).lastrowid
            conn.commit()
            conn.close()
            return self._send_json({"success": True, "id": new_id})

    def do_PATCH(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8')
        data = json.loads(body) if body else {}

        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if '/status' in path:
            order_id = path.split('/')[3]
            status = data.get('status')
            paid_amount = data.get('paid_amount')
            courier_notes = data.get('courier_notes')

            conn = get_db()
            c = conn.cursor()
            order = c.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
            if not order:
                conn.close()
                return self._send_json({"success": False, "error": "Topilmadi"}, 404)

            up_paid = float(paid_amount) if paid_amount is not None else order['paid_amount']
            pay_st = 'tolandi' if up_paid >= order['final_amount'] else ('qisman' if up_paid > 0 else 'kutilmoqda')
            deliv_date = datetime.now().strftime('%Y-%m-%d %H:%M') if status == 'yetkazildi' else order['delivered_date']

            c.execute('''
                UPDATE orders 
                SET status = ?, courier_notes = COALESCE(?, courier_notes), 
                    delivered_date = ?, paid_amount = ?, payment_status = ?
                WHERE id = ?
            ''', (status, courier_notes, deliv_date, up_paid, pay_st, order_id))
            conn.commit()
            conn.close()

            tg_info = format_order_tg(order_id)
            if tg_info:
                send_telegram(tg_info['text'], 'HTML', tg_info['lat'], tg_info['lon'])

            return self._send_json({"success": True})

        elif '/assign-courier' in path:
            order_id = path.split('/')[3]
            conn = get_db()
            c = conn.cursor()
            c.execute('''
                UPDATE orders 
                SET courier_pickup_id = COALESCE(?, courier_pickup_id),
                    courier_delivery_id = COALESCE(?, courier_delivery_id)
                WHERE id = ?
            ''', (data.get('courier_pickup_id'), data.get('courier_delivery_id'), order_id))
            conn.commit()
            conn.close()
            return self._send_json({"success": True})

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path.startswith('/api/orders/'):
            order_id = path.split('/')[-1]
            conn = get_db()
            c = conn.cursor()
            c.execute("DELETE FROM order_items WHERE order_id = ?", (order_id,))
            c.execute("DELETE FROM transactions WHERE order_id = ?", (order_id,))
            c.execute("DELETE FROM orders WHERE id = ?", (order_id,))
            conn.commit()
            conn.close()
            return self._send_json({"success": True})

if __name__ == '__main__':
    node = shutil.which('node')
    if not node:
        raise SystemExit("Xavfsiz backend uchun Node.js talab qilinadi. Node.js o'rnatib, qayta urinib ko'ring.")
    server_path = os.path.join(os.path.dirname(__file__), 'server.js')
    result = subprocess.run([node, server_path], cwd=os.path.dirname(__file__))
    raise SystemExit(result.returncode)
