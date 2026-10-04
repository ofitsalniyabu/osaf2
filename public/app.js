// app.js - Foydalanuvchi interfeysi, Avto-lokatsiya, Hisoblash va Login tizimi
let currentUser = null; // { id, username, full_name, role, phone, car_model, car_number }
let globalCategories = [];
let globalCouriers = [];
let globalOrders = [];
let authenticatedDataLoaded = false;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

// Boshlang'ich yuklash
document.addEventListener('DOMContentLoaded', async () => {
  // Bugungi sanani yangi buyurtmaga qo'yish
  const today = new Date().toISOString().slice(0, 10);
  const target = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (document.getElementById('orderPickupDate')) document.getElementById('orderPickupDate').value = today;
  if (document.getElementById('orderTargetDate')) document.getElementById('orderTargetDate').value = target;

  try {
    const response = await fetch('/api/auth/me');
    const json = await response.json();
    if (json.success) {
      currentUser = json.user;
      applyUserSession();
      await initializeAuthenticatedApp();
    }
  } catch (error) {
    console.error('Sessiyani tekshirishda xato:', error);
  }
});

// ================= LOGIN & AUTH =================
async function initializeAuthenticatedApp() {
  if (authenticatedDataLoaded) return;
  authenticatedDataLoaded = true;

  await loadCategories();
  if (currentUser.role !== 'courier') {
    await loadStaff();
    await loadDashboardStats();
  }
  await loadOrders();
  if (currentUser.role === 'owner') await loadTgSettings();

  if (currentUser.role !== 'courier') {
    addNewItemRow();
    addNewItemRow();
    runQuickCalc();
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const json = await res.json();
    if (json.success) {
      currentUser = json.user;
      applyUserSession();
      await initializeAuthenticatedApp();
      showToast(`Xush kelibsiz, ${currentUser.full_name}!`);
    } else {
      alert("Xatolik: " + (json.error || "Login yoki parol noto'g'ri"));
    }
  } catch (err) {
    alert("Serverga ulanishda xato yuz berdi");
  } finally {
    document.getElementById('loginPassword').value = '';
  }
}

async function handleLogout() {
  if (confirm("Rostdan ham profilingizdan chiqmoqchimisiz?")) {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      console.error('Tizimdan chiqishda xato:', error);
    }
    currentUser = null;
    authenticatedDataLoaded = false;
    document.getElementById('mainAppLayout').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
    showToast("Tizimdan muvaffaqiyatli chiqildi", "info");
  }
}

function openPasswordModal() {
  document.getElementById('currentPassword').value = '';
  document.getElementById('newPassword').value = '';
  document.getElementById('confirmNewPassword').value = '';
  document.getElementById('passwordModal').classList.add('show');
}

async function changePassword() {
  const current_password = document.getElementById('currentPassword').value;
  const new_password = document.getElementById('newPassword').value;
  if (new_password !== document.getElementById('confirmNewPassword').value) {
    alert('Yangi parollar mos kelmadi');
    return;
  }
  try {
    const response = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password, new_password })
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Parol almashtirilmadi');
    closeModal('passwordModal');
    showToast(result.message);
  } catch (error) {
    alert(error.message);
  }
}

function applyUserSession() {
  if (!currentUser) return;

  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('mainAppLayout').style.display = 'flex';

  // Sidebar profil ma'lumotlari
  document.getElementById('sidebarUserName').innerText = currentUser.full_name;
  
  const roleNames = {
    'owner': "👑 Ega Admin",
    'admin': "💼 Admin Operator",
    'courier': `🚚 Dastavchik (${currentUser.car_model || 'Mashina'})`
  };
  document.getElementById('sidebarUserRoleBadge').innerText = roleNames[currentUser.role] || currentUser.role;

  const ownerElements = document.querySelectorAll('.owner-only');

  if (currentUser.role === 'courier') {
    ownerElements.forEach(el => el.style.display = 'none');
    document.querySelectorAll('.nav-dashboard, .nav-orders, .nav-reports').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.courier-hidden-finance').forEach(el => el.style.display = 'none');
    document.getElementById('orderCourierAssignmentFields').style.display = 'none';
    
    // Dastavchik uchun sarlavha va default rejim
    const courierSelect = document.getElementById('courierActiveSelect');
    courierSelect.innerHTML = `<option value="${currentUser.id}">Mening buyurtmalarim</option>`;
    courierSelect.value = String(currentUser.id);
    courierSelect.disabled = true;
    document.getElementById('courierDashboardTitle').innerHTML = `<i class="fa-solid fa-truck"></i> Mening Buyurtmalarim`;

    switchTab('courier-mode');
  } else if (currentUser.role === 'admin') {
    ownerElements.forEach(el => el.style.display = 'none');
    document.querySelectorAll('.nav-dashboard, .nav-orders, .nav-new-order, .nav-courier').forEach(el => el.style.display = 'flex');
    if (document.getElementById('courierActiveSelect')) document.getElementById('courierActiveSelect').disabled = false;
    switchTab('dashboard');
  } else {
    // Ega Admin
    ownerElements.forEach(el => el.style.display = 'flex');
    document.querySelectorAll('.nav-dashboard, .nav-orders, .nav-new-order, .nav-courier').forEach(el => el.style.display = 'flex');
    if (document.getElementById('courierActiveSelect')) document.getElementById('courierActiveSelect').disabled = false;
    switchTab('dashboard');
  }
}

// Bo'limlarni almashtirish
function switchTab(tabId) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

  const targetPane = document.getElementById(`tab-${tabId}`);
  if (targetPane) targetPane.classList.add('active');

  const navBtns = document.querySelectorAll('.nav-item');
  navBtns.forEach(btn => {
    if (btn.getAttribute('onclick')?.includes(tabId)) {
      btn.classList.add('active');
    }
  });

  const titleMap = {
    'dashboard': { title: "Boshqaruv Paneli", sub: "Gilam, adyol, gilamcha va dastavka jarayonlari monitoringi" },
    'orders': { title: "Buyurtmalar Ro'yxati", sub: "Barcha qabul qilingan, yuvilayotgan va yetkazilgan gilamlar" },
    'new-order': { title: "Yangi Buyurtma Qabul Qilish", sub: currentUser.role === 'courier' ? "Mijozdan olgan gilam, to‘shak va buyumlarni ro‘yxatdan o‘tkazing" : "Gilam o'lchamlari (uzunlik, eni, m²), adyol va gilamchalar hisobi" },
    'courier-mode': { title: "Dastavchik Ish Maydoni", sub: "Olingan buyurtmalarni sexga topshiring va tayyorlarini yetkazib bering" },
    'pricing': { title: "Kategoriya va Xizmat Narxlari", sub: "Gilam, adyol, parda va buyumlar narxlarini belgilash" },
    'staff': { title: "Xodimlar va Dastavchiklar", sub: "Adminlar, operatorlar va mashinali kuryerlar ro'yxati" },
    'reports': { title: "Excel va Word Hisobotlar", sub: "Moliya, kassa, yuvilgan maydonlar va shartnoma-kvitansiyalar" },
    'telegram-config': { title: "Telegram Guruh Integratsiyasi", sub: "Buyurtmalarni guruhga avtomatik tashlab beruvchi bot sozlamasi" }
  };

  if (titleMap[tabId]) {
    document.getElementById('pageTitle').innerText = titleMap[tabId].title;
    document.getElementById('pageSubtitle').innerText = titleMap[tabId].sub;
  }

  if (tabId === 'courier-mode') renderCourierDeliveries();
  if (tabId === 'orders') loadOrders();
  if (tabId === 'reports') loadReceiptsList();
  if (tabId === 'telegram-config') loadTgLogs();
}

// ================= LOKATSIYANI AUTO OLISH =================
function detectAutoLocation() {
  const statusEl = document.getElementById('locationStatusText');
  const btn = document.getElementById('btnGetLocation');

  if (!navigator.geolocation) {
    statusEl.innerHTML = `<span style="color: var(--danger);"><i class="fa-solid fa-triangle-exclamation"></i> Qurilmangizda Geolocation qo'llab-quvvatlanmaydi</span>`;
    return;
  }

  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Aniqlanmoqda...`;
  statusEl.innerHTML = `<i class="fa-solid fa-satellite-dish"></i> GPS koordinatalar olinmoqda...`;

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude.toFixed(6);
      const lng = position.coords.longitude.toFixed(6);

      document.getElementById('custLat').value = lat;
      document.getElementById('custLng').value = lng;

      btn.innerHTML = `<i class="fa-solid fa-check"></i> Yangilash`;
      statusEl.innerHTML = `<span style="color: var(--success); font-weight: 600;"><i class="fa-solid fa-circle-check"></i> Aniqlangan lokatsiya: ${lat}, ${lng}</span>`;

      // Xarita havolalarini ko'rsatish
      const previewWrap = document.getElementById('mapPreviewLinkWrap');
      const previewLink = document.getElementById('mapPreviewLink');
      if (previewWrap && previewLink) {
        previewWrap.style.display = 'block';
        previewLink.href = `https://yandex.com/maps/?rtext=~${lat},${lng}&rtt=auto`;
      }

      showToast("📍 Lokatsiya koordinatalari avtomatik olindi!");
    },
    (error) => {
      btn.innerHTML = `<i class="fa-solid fa-satellite-dish"></i> Qayta urinish`;
      let msg = "GPS ruxsati berilmadi yoki qamrov mavjud emas";
      if (error.code === 1) msg = "Brauzer lokatsiyaga ruxsat bermadi. Ruxsat berib qayta bosing.";
      statusEl.innerHTML = `<span style="color: var(--danger);"><i class="fa-solid fa-circle-exclamation"></i> ${escapeHtml(msg)}</span>`;
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

// ================= MUKAMMAL BELGILASH: CHIPS (MAXSUS BELGILAR) =================
function toggleTagChip(chipEl) {
  chipEl.classList.toggle('active');
}

function getSelectedDefectTags() {
  const chips = document.querySelectorAll('#defectTagsWrap .tag-chip.active');
  const tags = [];
  chips.forEach(c => tags.push(c.innerText.trim()));
  return tags.join(', ');
}

// ================= STATISTIKA VA DASHBOARD =================
async function loadDashboardStats() {
  try {
    const res = await fetch('/api/stats');
    const json = await res.json();
    if (!json.success) return;

    const d = json.data;
    document.getElementById('statTotalOrders').innerText = d.total_orders || 0;
    document.getElementById('statWashingOrders').innerText = d.washing_orders || 0;
    document.getElementById('statDeliveringOrders').innerText = d.delivering_orders || 0;
    document.getElementById('statCompletedOrders').innerText = d.completed_orders || 0;
    document.getElementById('statTotalSqm').innerText = `${(d.total_sqm || 0).toFixed(1)} m²`;
    document.getElementById('statTotalPaid').innerText = `${(d.total_paid || 0).toLocaleString()} so'm`;
    document.getElementById('statTotalRevenue').innerText = `${(d.total_revenue || 0).toLocaleString()} so'm`;
    document.getElementById('statDebtAmount').innerText = `${(d.debt_amount || 0).toLocaleString()} so'm`;
    
    document.getElementById('badgeTotalOrders').innerText = d.total_orders || 0;
  } catch (err) {
    console.error("Stats load error:", err);
  }
}

// ================= KATEGORIYALAR VA XIZMATLAR =================
async function loadCategories() {
  try {
    const res = await fetch('/api/categories');
    const json = await res.json();
    if (json.success) {
      globalCategories = json.data;
      renderPricingTable();
      populateQuickCalcSelect();
    }
  } catch (e) {
    console.error(e);
  }
}

function renderPricingTable() {
  const tbody = document.getElementById('pricingTableBody');
  if (!tbody) return;

  tbody.innerHTML = globalCategories.map(cat => `
    <tr>
      <td style="font-size: 20px;">${escapeHtml(cat.icon || '🧺')}</td>
      <td><strong>${escapeHtml(cat.name)}</strong></td>
      <td><span class="badge">${cat.unit === 'kv_m' ? 'Kvadrat metr (m²)' : 'Dona hisobi'}</span></td>
      <td><strong class="text-primary">${cat.price_per_unit.toLocaleString()} so'm</strong></td>
      <td><small class="text-muted">${escapeHtml(cat.description || '-')}</small></td>
      <td>
        <button class="btn btn-sm btn-outline" data-category-name="${escapeHtml(cat.name)}" onclick="editCategoryPrompt(${cat.id}, this.dataset.categoryName, ${Number(cat.price_per_unit)})">
          <i class="fa-solid fa-pen"></i> Narxni o'zgartirish
        </button>
      </td>
    </tr>
  `).join('');
}

function openNewCategoryModal() {
  document.getElementById('categoryModal').classList.add('show');
}

async function saveNewCategory() {
  const name = document.getElementById('newCatName').value;
  const unit = document.getElementById('newCatUnit').value;
  const price_per_unit = document.getElementById('newCatPrice').value;
  const description = document.getElementById('newCatDesc').value;
  const icon = document.getElementById('newCatIcon').value;

  if (!name || !price_per_unit) {
    alert("Iltimos, xizmat nomi va narxini kiriting");
    return;
  }

  const res = await fetch('/api/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, unit, price_per_unit, description, icon })
  });

  const json = await res.json();
  if (json.success) {
    showToast("Yangi kategoriya saqlandi!");
    closeModal('categoryModal');
    loadCategories();
  }
}

function editCategoryPrompt(id, currentName, currentPrice) {
  const newPrice = prompt(`"${currentName}" xizmati uchun yangi 1 birlik (m² yoki dona) narxini kiriting (so'm):`, currentPrice);
  if (newPrice && !isNaN(newPrice)) {
    const cat = globalCategories.find(c => c.id === id);
    fetch(`/api/categories/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...cat, price_per_unit: parseFloat(newPrice) })
    }).then(() => {
      showToast("Narx yangilandi!");
      loadCategories();
      runQuickCalc();
    });
  }
}

// ================= XODIMLAR VA DASTAVCHIKLAR =================
async function loadStaff() {
  try {
    const res = await fetch('/api/users');
    const json = await res.json();
    if (json.success) {
      const users = json.data;
      globalCouriers = users.filter(u => u.role === 'courier');

      populateCourierSelects();
      renderStaffTable(users);
      renderDashboardCouriersMini();
    }
  } catch (e) {
    console.error(e);
  }
}

function populateCourierSelects() {
  const pickupSel = document.getElementById('orderPickupCourier');
  const delivSel = document.getElementById('orderDeliveryCourier');
  const filterSel = document.getElementById('courierFilter');
  const activeSel = document.getElementById('courierActiveSelect');

  const optionsHtml = globalCouriers.map(c => `
    <option value="${c.id}">${escapeHtml(c.full_name)} (${escapeHtml(c.car_model || 'Mashinasiz')} ${escapeHtml(c.car_number || '')})</option>
  `).join('');

  if (pickupSel) pickupSel.innerHTML = '<option value="">-- Dastavchik tanlang --</option>' + optionsHtml;
  if (delivSel) delivSel.innerHTML = '<option value="">-- Dastavchik tanlang --</option>' + optionsHtml;
  if (filterSel) filterSel.innerHTML = '<option value="all">Barcha dastavchiklar</option>' + optionsHtml;
  if (activeSel) activeSel.innerHTML = '<option value="all">🚚 Barcha Kuryerlar Ishlari</option>' + optionsHtml;
}

function renderStaffTable(users) {
  const tbody = document.getElementById('staffTableBody');
  if (!tbody) return;

  const roleLabels = {
    'owner': '<span class="status-pill status-yetkazildi">👑 Ega Admin</span>',
    'admin': '<span class="status-pill status-yangi">💼 Operator / Admin</span>',
    'courier': '<span class="status-pill status-yetkazilmoqda">🚚 Dastavchik</span>'
  };

  tbody.innerHTML = users.map(u => `
    <tr>
      <td><strong>${escapeHtml(u.full_name)}</strong></td>
      <td><code>${escapeHtml(u.username)}</code></td>
      <td>${roleLabels[u.role] || escapeHtml(u.role)}</td>
      <td><a href="tel:${escapeHtml(u.phone)}">${escapeHtml(u.phone || '-')}</a></td>
      <td>${u.car_model ? `<b>${escapeHtml(u.car_model)}</b> (${escapeHtml(u.car_number || '')})` : '-'}</td>
      <td><span class="status-pill status-tayyor">Faol</span></td>
      <td><small class="text-muted">${u.created_at ? u.created_at.slice(0, 10) : '-'}</small></td>
    </tr>
  `).join('');
}

function renderDashboardCouriersMini() {
  const box = document.getElementById('couriersMiniList');
  if (!box) return;

  box.innerHTML = globalCouriers.map(c => `
    <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px dashed var(--border-color); font-size: 13px;">
      <div>
        <strong>${escapeHtml(c.full_name)}</strong>
        <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(c.car_model || 'Mashina')} • ${escapeHtml(c.car_number || '-')}</div>
      </div>
      <a href="tel:${escapeHtml(c.phone)}" class="btn btn-sm btn-outline"><i class="fa-solid fa-phone"></i></a>
    </div>
  `).join('');
}

function openNewStaffModal() {
  document.getElementById('staffModal').classList.add('show');
}

async function saveNewStaff() {
  const full_name = document.getElementById('newStaffName').value;
  const username = document.getElementById('newStaffLogin').value;
  const password = document.getElementById('newStaffPass').value;
  const role = document.getElementById('newStaffRole').value;
  const phone = document.getElementById('newStaffPhone').value;
  const car_model = document.getElementById('newStaffCar').value;
  const car_number = document.getElementById('newStaffPlate').value;

  if (!full_name || !/^[a-zA-Z0-9_.-]{3,40}$/.test(username) || password.length < 8) {
    alert("Ismni kiriting, login 3–40 belgidan iborat bo'lsin va parol kamida 8 belgidan tashkil topsin");
    return;
  }

  const res = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name, username, password, role, phone, car_model, car_number })
  });

  const json = await res.json();
  if (json.success) {
    showToast("Yangi xodim / dastavchik qo'shildi!");
    closeModal('staffModal');
    loadStaff();
  }
}

// ================= YANGI BUYURTMA KALKULYATORI VA QATORLAR =================
function addNewItemRow() {
  const tbody = document.getElementById('itemsTableBody');
  if (!tbody) return;

  const rowId = 'row_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);

  const catOptions = globalCategories.map(c => `
    <option value="${Number(c.id)}" data-unit="${escapeHtml(c.unit)}" data-price="${Number(c.price_per_unit)}">
      ${escapeHtml(c.icon || '🧺')} ${escapeHtml(c.name)}
    </option>
  `).join('');

  const tr = document.createElement('tr');
  tr.id = rowId;
  tr.innerHTML = `
    <td style="min-width: 170px;">
      <select class="item-cat-select" onchange="onItemCategoryChange('${rowId}')">
        ${catOptions}
      </select>
    </td>
    <td style="width: 85px;">
      <input type="number" class="item-len" step="0.05" min="0" required oninput="calculateRow('${rowId}')" placeholder="Uzunligi">
    </td>
    <td style="width: 85px;">
      <input type="number" class="item-wid" step="0.05" min="0" required oninput="calculateRow('${rowId}')" placeholder="Eni">
    </td>
    <td style="width: 100px;">
      <span class="item-calc-metric" style="font-weight: 600;">6.00 m²</span>
    </td>
    <td style="width: 110px;">
      <input type="number" class="item-price" step="500" value="15000" readonly aria-label="Katalogdagi xizmat narxi">
    </td>
    <td style="width: 110px;">
      <strong class="item-subtotal text-primary">90 000</strong>
    </td>
    <td>
      <input type="text" class="item-notes" placeholder="Qahva dog'i, cheti titilgan">
    </td>
    <td style="width: 30px; text-align: center;">
      <button type="button" class="btn-remove-row" onclick="removeRow('${rowId}')"><i class="fa-solid fa-trash-can"></i></button>
    </td>
  `;

  tbody.appendChild(tr);
  onItemCategoryChange(rowId);
}

function removeRow(rowId) {
  const row = document.getElementById(rowId);
  if (row) {
    row.remove();
    recalculateTotals();
  }
}

function onItemCategoryChange(rowId) {
  const row = document.getElementById(rowId);
  if (!row) return;

  const select = row.querySelector('.item-cat-select');
  const selectedOption = select.options[select.selectedIndex];
  if (!selectedOption) return;

  const unit = selectedOption.getAttribute('data-unit');
  const defaultPrice = selectedOption.getAttribute('data-price');

  const lenInput = row.querySelector('.item-len');
  const widInput = row.querySelector('.item-wid');
  const priceInput = row.querySelector('.item-price');

  if (defaultPrice) priceInput.value = defaultPrice;

  if (unit === 'dona') {
    lenInput.disabled = true;
    widInput.disabled = true;
    lenInput.value = '';
    widInput.value = '';
  } else {
    lenInput.disabled = false;
    widInput.disabled = false;
  }

  calculateRow(rowId);
}

function calculateRow(rowId) {
  const row = document.getElementById(rowId);
  if (!row) return;

  const select = row.querySelector('.item-cat-select');
  const selectedOption = select.options[select.selectedIndex];
  const unit = selectedOption ? selectedOption.getAttribute('data-unit') : 'kv_m';

  const len = parseFloat(row.querySelector('.item-len').value) || 0;
  const wid = parseFloat(row.querySelector('.item-wid').value) || 0;
  const price = parseFloat(row.querySelector('.item-price').value) || 0;
  const metricSpan = row.querySelector('.item-calc-metric');
  const subtotalEl = row.querySelector('.item-subtotal');

  let subtotal = 0;
  if (unit === 'kv_m') {
    const area = len * wid;
    metricSpan.innerText = `${area.toFixed(2)} m²`;
    subtotal = Math.round(area * price);
  } else {
    metricSpan.innerText = `1 dona`;
    subtotal = Math.round(price);
  }

  subtotalEl.innerText = subtotal.toLocaleString() + " so'm";
  recalculateTotals();
}

function recalculateTotals() {
  const rows = document.querySelectorAll('#itemsTableBody tr');
  let sumArea = 0;
  let sumItems = 0;
  let sumPrice = 0;

  rows.forEach(r => {
    const select = r.querySelector('.item-cat-select');
    const selectedOption = select ? select.options[select.selectedIndex] : null;
    const unit = selectedOption ? selectedOption.getAttribute('data-unit') : 'kv_m';

    const len = parseFloat(r.querySelector('.item-len').value) || 0;
    const wid = parseFloat(r.querySelector('.item-wid').value) || 0;
    const price = parseFloat(r.querySelector('.item-price').value) || 0;

    sumItems += 1;
    if (unit === 'kv_m') {
      const area = len * wid;
      sumArea += area;
      sumPrice += area * price;
    } else {
      sumPrice += price;
    }
  });

  const discount = parseFloat(document.getElementById('orderDiscount').value) || 0;
  const finalAmount = Math.max(0, Math.round(sumPrice - discount));

  document.getElementById('calcTotalArea').innerText = `${sumArea.toFixed(2)} m²`;
  document.getElementById('calcTotalItems').innerText = `${sumItems} dona`;
  document.getElementById('calcSubtotal').innerText = `${Math.round(sumPrice).toLocaleString()} so'm`;
  document.getElementById('calcFinalAmount').innerText = `${finalAmount.toLocaleString()} so'm`;
}

// Yangi buyurtmani serverga yuborish
async function submitNewOrder(e) {
  e.preventDefault();

  const customer_name = document.getElementById('custName').value.trim();
  const customer_phone = document.getElementById('custPhone').value.trim();
  const customer_phone2 = document.getElementById('custPhone2').value.trim();
  const customer_address = document.getElementById('custAddress').value.trim();
  const landmark = document.getElementById('custLandmark').value.trim();
  const latitude = document.getElementById('custLat').value.trim();
  const longitude = document.getElementById('custLng').value.trim();
  const defect_tags = getSelectedDefectTags();

  const courier_pickup_id = document.getElementById('orderPickupCourier').value;
  const courier_delivery_id = document.getElementById('orderDeliveryCourier').value;
  const pickup_date = document.getElementById('orderPickupDate').value;
  const target_delivery_date = document.getElementById('orderTargetDate').value;
  const courier_notes = document.getElementById('orderCourierNotes').value.trim();
  const discount = document.getElementById('orderDiscount').value;
  const paid_amount = document.getElementById('orderPaid').value;
  const payment_method = document.getElementById('orderPaymentMethod').value;

  const rows = document.querySelectorAll('#itemsTableBody tr');
  if (rows.length === 0) {
    alert("Iltimos, kamida bitta gilam yoki buyum qo'shing!");
    return;
  }

  const submitButton = e.submitter || document.querySelector('#newOrderForm button[type="submit"]');
  const originalButtonHtml = submitButton ? submitButton.innerHTML : '';
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Buyurtma yuborilmoqda...';
  }

  const items = [];
  rows.forEach(r => {
    const select = r.querySelector('.item-cat-select');
    const catId = select.value;
    const catName = select.options[select.selectedIndex].text.split('(')[0].trim();
    const len = parseFloat(r.querySelector('.item-len').value) || 0;
    const wid = parseFloat(r.querySelector('.item-wid').value) || 0;
    const price = parseFloat(r.querySelector('.item-price').value) || 0;
    const notes = r.querySelector('.item-notes').value.trim();

    items.push({
      category_id: catId,
      item_type: catName,
      length: len,
      width: wid,
      quantity: 1,
      unit_price: price,
      notes: notes
    });
  });

  const payload = {
    customer_name,
    customer_phone,
    customer_phone2,
    customer_address,
    landmark,
    latitude: latitude ? parseFloat(latitude) : null,
    longitude: longitude ? parseFloat(longitude) : null,
    defect_tags,
    courier_pickup_id: currentUser.role === 'courier' ? currentUser.id : (courier_pickup_id || null),
    courier_delivery_id: currentUser.role === 'courier' ? null : (courier_delivery_id || null),
    pickup_date,
    target_delivery_date,
    courier_notes,
    discount,
    paid_amount,
    payment_method,
    items
  };

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const json = await res.json();
    if (json.success) {
      const orderCreatedMessage = `Buyurtma ${json.orderNumber} yaratildi${currentUser.role === 'courier' ? ' va sizga biriktirildi' : ''}`;
      if (json.telegram?.success && !json.telegram.simulated) {
        showToast(`🎉 ${orderCreatedMessage} va Telegram guruhiga yuborildi!`);
      } else if (json.telegram?.simulated) {
        showToast(`${orderCreatedMessage}, lekin Telegram bot yoki guruh sozlanmagan.`, 'info');
      } else {
        const telegramError = json.telegram?.error || 'Telegram xabari yuborilmadi';
        alert(`${orderCreatedMessage}, ammo guruhga yuborishda xato: ${telegramError}`);
      }
      document.getElementById('newOrderForm').reset();
      document.getElementById('itemsTableBody').innerHTML = '';
      document.querySelectorAll('#defectTagsWrap .tag-chip').forEach(c => c.classList.remove('active'));
      document.getElementById('mapPreviewLinkWrap').style.display = 'none';

      addNewItemRow();
      addNewItemRow();
      recalculateTotals();

      await loadDashboardStats();
      await loadOrders();
      switchTab(currentUser.role === 'courier' ? 'courier-mode' : 'orders');
    } else {
      alert("Xatolik: " + json.error);
    }
  } catch (err) {
    console.error(err);
    alert(`Buyurtmani rasmiylashtirishda xatolik: ${err.message || 'Serverga ulanishda muammo yuz berdi'}`);
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.innerHTML = originalButtonHtml;
    }
  }
}

// ================= BUYURTMALAR RO'YXATI =================
async function loadOrders() {
  try {
    const res = await fetch('/api/orders');
    const json = await res.json();
    if (json.success) {
      globalOrders = json.data;
      renderOrdersTable(globalOrders);
      renderDashboardRecentTable(globalOrders.slice(0, 5));
      renderCourierDeliveries();
      loadReceiptsList();
    }
  } catch (err) {
    console.error("Orders error:", err);
  }
}

function filterOrders() {
  const query = document.getElementById('orderSearchInput').value.toLowerCase().trim();
  const status = document.getElementById('statusFilter').value;
  const courierId = document.getElementById('courierFilter').value;

  const filtered = globalOrders.filter(o => {
    const matchQuery = !query || 
      o.order_number.toLowerCase().includes(query) ||
      o.customer_name.toLowerCase().includes(query) ||
      o.customer_phone.toLowerCase().includes(query) ||
      o.customer_address.toLowerCase().includes(query);

    const matchStatus = status === 'all' || o.status === status;
    const matchCourier = courierId === 'all' || 
      String(o.courier_pickup_id) === courierId || 
      String(o.courier_delivery_id) === courierId;

    return matchQuery && matchStatus && matchCourier;
  });

  renderOrdersTable(filtered);
}

function getStatusPill(status) {
  const map = {
    'yangi': { label: '🆕 Yangi tushgan', cls: 'status-yangi' },
    'qabul_qilindi': { label: '📦 Qabul qilindi', cls: 'status-qabul_qilindi' },
    'yuvishda': { label: '🧼 Yuvishda', cls: 'status-yuvishda' },
    'quritishda': { label: '☀️ Quritishda', cls: 'status-quritishda' },
    'tayyor': { label: '✨ Tayyor (Qadoqda)', cls: 'status-tayyor' },
    'yetkazilmoqda': { label: '🚚 Yetkazilmoqda', cls: 'status-yetkazilmoqda' },
    'yetkazildi': { label: '✅ Yetkazildi', cls: 'status-yetkazildi' },
    'bekor_qilindi': { label: '❌ Bekor qilindi', cls: 'status-bekor_qilindi' }
  };
  const item = map[status] || { label: escapeHtml(status), cls: 'status-yangi' };
  return `<span class="status-pill ${item.cls}">${item.label}</span>`;
}

function renderOrdersTable(orders) {
  const tbody = document.getElementById('ordersTableBody');
  if (!tbody) return;

  if (orders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 24px; color: var(--text-muted);">Buyurtmalar topilmadi</td></tr>`;
    return;
  }

  tbody.innerHTML = orders.map(ord => {
    const itemsPreview = (ord.items || []).map(i => {
      const dim = (i.length && i.width) ? `(${i.length}x${i.width}m)` : `(${i.quantity} dona)`;
      return `${i.item_type} ${dim}`;
    }).join(', ');

    const courier = escapeHtml(ord.courier_deliv_name || ord.courier_pickup_name || 'Biriktirilmagan');

    // Lokatsiya tugmasi
    let locBtn = '';
    if (ord.latitude && ord.longitude) {
      locBtn = `<a href="https://yandex.com/maps/?rtext=~${ord.latitude},${ord.longitude}&rtt=auto" target="_blank" class="btn btn-sm btn-outline" style="padding: 2px 6px; font-size: 11px; margin-top: 3px;" title="Yandex Navigator">
        <i class="fa-solid fa-diamond-turn-right text-danger"></i> Nav
      </a>`;
    }

    return `
      <tr>
        <td><strong class="order-code-badge" style="cursor: pointer;" onclick="viewOrderDetails(${Number(ord.id)})">${escapeHtml(ord.order_number)}</strong></td>
        <td>
          <strong>${escapeHtml(ord.customer_name)}</strong>
          <div style="font-size: 12px; color: var(--text-muted);"><a href="tel:${escapeHtml(ord.customer_phone)}">${escapeHtml(ord.customer_phone)}</a></div>
        </td>
        <td>
          <div style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(ord.customer_address)}">
            <i class="fa-solid fa-location-dot text-muted"></i> ${escapeHtml(ord.customer_address)}
          </div>
          ${ord.landmark ? `<small class="text-muted">Mo'ljal: ${escapeHtml(ord.landmark)}</small><br>` : ''}
          ${locBtn}
        </td>
        <td>
          <div style="max-width: 220px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(itemsPreview)}">
            ${escapeHtml(itemsPreview || '-')}
          </div>
          ${ord.defect_tags ? `<small class="text-danger">● ${escapeHtml(ord.defect_tags)}</small>` : ''}
        </td>
        <td>
          <strong>${ord.total_area ? ord.total_area.toFixed(1) : 0} m²</strong>
          <small class="text-muted">(${ord.total_items} ta)</small>
        </td>
        <td>
          <strong>${ord.final_amount.toLocaleString()} so'm</strong>
          <div style="font-size: 11.5px;">
            ${ord.payment_status === 'tolandi' ? '<span class="text-success">● To\'langan</span>' : `<span class="text-danger">● Qoldiq: ${(ord.final_amount - ord.paid_amount).toLocaleString()}</span>`}
          </div>
        </td>
        <td>
          <div style="font-size: 12.5px;">${courier}</div>
        </td>
        <td>${getStatusPill(ord.status)}</td>
        <td>
          <div style="display: flex; gap: 4px;">
            <button class="btn btn-sm btn-outline" title="Batafsil / Holatni o'zgartirish" onclick="viewOrderDetails(${Number(ord.id)})">
              <i class="fa-solid fa-eye"></i>
            </button>
            <button class="btn btn-sm btn-telegram" title="TG Guruhga Yuborish" onclick="sendOrderToTg(${Number(ord.id)})">
              <i class="fa-brands fa-telegram"></i>
            </button>
            <button class="btn btn-sm btn-outline" title="Word Kvitansiya" onclick="downloadWordReceipt(${Number(ord.id)})">
              <i class="fa-solid fa-file-word text-primary"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderDashboardRecentTable(orders) {
  const tbody = document.querySelector('#dashboardRecentTable tbody');
  if (!tbody) return;

  tbody.innerHTML = orders.map(ord => `
    <tr>
      <td><strong class="order-code-badge" style="cursor: pointer;" onclick="viewOrderDetails(${Number(ord.id)})">${escapeHtml(ord.order_number)}</strong></td>
      <td><strong>${escapeHtml(ord.customer_name)}</strong><br><small class="text-muted">${escapeHtml(ord.customer_phone)}</small></td>
      <td><small>${escapeHtml(ord.customer_address)}</small></td>
      <td><b>${ord.total_area ? ord.total_area.toFixed(1) : 0} m²</b> (${ord.total_items} ta)</td>
      <td><strong>${ord.final_amount.toLocaleString()} so'm</strong></td>
      <td>${getStatusPill(ord.status)}</td>
      <td>
        <button class="btn btn-sm btn-outline" onclick="viewOrderDetails(${Number(ord.id)})">Ko'rish</button>
      </td>
    </tr>
  `).join('');
}

// ================= DASTAVCHIK ISH MAYDONI =================
function renderCourierDeliveries() {
  const container = document.getElementById('courierOrdersContainer');
  if (!container) return;

  const courierFilter = document.getElementById('courierActiveSelect') ? document.getElementById('courierActiveSelect').value : 'all';

  const orders = globalOrders.filter(o => {
    if (courierFilter !== 'all') {
      return String(o.courier_pickup_id) === courierFilter || String(o.courier_delivery_id) === courierFilter;
    }
    return true;
  });

  if (orders.length === 0) {
    container.innerHTML = `<div class="card p-4 text-center" style="grid-column: 1/-1; padding: 40px; color: var(--text-muted);">
      <i class="fa-solid fa-truck" style="font-size: 40px; margin-bottom: 12px; color: #cbd5e1;"></i>
      <h3>Hozircha sizga biriktirilgan buyurtmalar yo'q</h3>
    </div>`;
    return;
  }

  container.innerHTML = orders.map(ord => {
    let borderClass = 'border-left-delivering';
    if (ord.status === 'yuvishda' || ord.status === 'quritishda') borderClass = 'border-left-washing';
    if (ord.status === 'tayyor') borderClass = 'border-left-ready';
    const canManageDelivery = currentUser.role !== 'courier' || ord.courier_delivery_id === currentUser.id;
    let deliveryAction = '';
    if (currentUser.role === 'courier' &&
        ord.courier_pickup_id === currentUser.id &&
        ord.status === 'yangi') {
      deliveryAction = `
        <button class="btn btn-primary" style="flex: 1.2;" onclick="quickUpdateStatus(${Number(ord.id)}, 'qabul_qilindi')">
          <i class="fa-solid fa-warehouse"></i> Sexga topshirdim
        </button>
      `;
    } else if (canManageDelivery && ord.status === 'tayyor') {
      deliveryAction = `
        <button class="btn btn-primary" style="flex: 1.2;" onclick="quickUpdateStatus(${Number(ord.id)}, 'yetkazilmoqda')">
          <i class="fa-solid fa-truck"></i> Yetkazishga chiqdim
        </button>
      `;
    } else if (canManageDelivery && ord.status === 'yetkazilmoqda') {
      deliveryAction = `
        <button class="btn btn-success" style="flex: 1.2;" onclick="quickUpdateStatus(${Number(ord.id)}, 'yetkazildi', ${Number(ord.final_amount)})">
          <i class="fa-solid fa-check"></i> Yetkazdim va pulni oldim
        </button>
      `;
    }

    const itemsListHtml = (ord.items || []).map(i => `
      <li>• <strong>${escapeHtml(i.item_type)}</strong>: ${(i.length && i.width) ? `${i.length}x${i.width}m (${i.area}m²)` : `${i.quantity} dona`} ${i.notes ? `<i class="text-muted">(${escapeHtml(i.notes)})</i>` : ''}</li>
    `).join('');

    // Avto lokatsiya bo'yicha navigator havolasi
    let navLinksHtml = '';
    if (ord.latitude && ord.longitude) {
      navLinksHtml = `
        <div style="display: flex; gap: 6px; margin: 4px 0;">
          <a href="https://yandex.com/maps/?rtext=~${ord.latitude},${ord.longitude}&rtt=auto" target="_blank" class="btn btn-sm btn-outline-primary" style="flex: 1;">
            <i class="fa-solid fa-diamond-turn-right"></i> Yandex Navigator
          </a>
          <a href="https://www.google.com/maps/search/?api=1&query=${ord.latitude},${ord.longitude}" target="_blank" class="btn btn-sm btn-outline" style="flex: 1;">
            <i class="fa-brands fa-google"></i> Google Maps
          </a>
        </div>
      `;
    }

    return `
      <div class="courier-card ${borderClass}">
        <div class="courier-card-head">
          <span class="order-code-badge">${escapeHtml(ord.order_number)}</span>
          ${getStatusPill(ord.status)}
        </div>

        <div class="courier-card-info">
          <h4>${escapeHtml(ord.customer_name)}</h4>
          <p><i class="fa-solid fa-phone text-primary"></i> <a href="tel:${escapeHtml(ord.customer_phone)}"><b>${escapeHtml(ord.customer_phone)}</b></a></p>
          <p><i class="fa-solid fa-location-dot text-danger"></i> <span>${escapeHtml(ord.customer_address)}</span></p>
          ${ord.landmark ? `<p><i class="fa-solid fa-map-pin text-warning"></i> Mo'ljal: ${escapeHtml(ord.landmark)}</p>` : ''}
          ${navLinksHtml}
          ${ord.defect_tags ? `<p><i class="fa-solid fa-tags text-danger"></i> <b>${escapeHtml(ord.defect_tags)}</b></p>` : ''}
          ${ord.courier_notes ? `<p><i class="fa-solid fa-comment-dots"></i> <i>"${escapeHtml(ord.courier_notes)}"</i></p>` : ''}
        </div>

        <div class="courier-items-list">
          <div style="font-weight: 600; margin-bottom: 4px;">Yuklar (${ord.total_items} ta, ${ord.total_area ? ord.total_area.toFixed(1) : 0} m²):</div>
          <ul>${itemsListHtml}</ul>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; padding: 8px 12px; border-radius: 6px;">
          <div>Jami: <strong>${ord.final_amount.toLocaleString()} so'm</strong></div>
          <div>${ord.payment_status === 'tolandi' ? '<b class="text-success">To\'langan</b>' : `<b class="text-danger">Undirish: ${(ord.final_amount - ord.paid_amount).toLocaleString()} so'm</b>`}</div>
        </div>

        <div class="courier-card-actions">
          <button class="btn btn-outline" style="flex: 1;" onclick="viewOrderDetails(${Number(ord.id)})">
            <i class="fa-solid fa-circle-info"></i> Ko'rish
          </button>
          ${deliveryAction}
          <button class="btn btn-telegram" title="Guruhga hisobot berish" onclick="sendOrderToTg(${ord.id})">
            <i class="fa-brands fa-telegram"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function quickUpdateStatus(orderId, newStatus, autoPayAmount = null) {
  const payload = { status: newStatus };
  if (autoPayAmount !== null) {
    payload.paid_amount = autoPayAmount;
    payload.payment_status = 'tolandi';
  }

  try {
    const res = await fetch(`/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Buyurtma holatini yangilab bo‘lmadi');
    showToast('Buyurtma holati yangilandi');
    if (currentUser.role !== 'courier') await loadDashboardStats();
    await loadOrders();
  } catch (error) {
    alert(error.message);
  }
}

// ================= BUYURTMA BATAFSIL MODALI =================
async function viewOrderDetails(orderId) {
  try {
    const res = await fetch(`/api/orders/${orderId}`);
    const json = await res.json();
    if (!json.success) return;

    const ord = json.data;
    document.getElementById('modalOrderTitle').innerText = `${ord.order_number} - Buyurtma Tafsilotlari`;

    const courierPickupOptions = globalCouriers.map(c => `
      <option value="${Number(c.id)}" ${ord.courier_pickup_id === c.id ? 'selected' : ''}>${escapeHtml(c.full_name)}</option>
    `).join('');

    const courierDelivOptions = globalCouriers.map(c => `
      <option value="${Number(c.id)}" ${ord.courier_delivery_id === c.id ? 'selected' : ''}>${escapeHtml(c.full_name)}</option>
    `).join('');

    const itemsRows = (ord.items || []).map((i, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td><strong>${escapeHtml(i.item_type)}</strong></td>
        <td>${(i.length && i.width) ? `${i.length} × ${i.width} m` : '-'}</td>
        <td>${i.area > 0 ? `${i.area} m²` : `${i.quantity} dona`}</td>
        <td>${i.unit_price.toLocaleString()} so'm</td>
        <td><strong>${i.subtotal.toLocaleString()} so'm</strong></td>
        <td><small>${escapeHtml(i.notes || '-')}</small></td>
      </tr>
    `).join('');

    let navSection = '';
    if (ord.latitude && ord.longitude) {
      navSection = `
        <div style="margin-top: 6px;">
          <a href="https://yandex.com/maps/?rtext=~${ord.latitude},${ord.longitude}&rtt=auto" target="_blank" class="btn btn-sm btn-outline-primary">
            <i class="fa-solid fa-diamond-turn-right"></i> Yandex Navigator
          </a>
          <a href="https://www.google.com/maps/search/?api=1&query=${ord.latitude},${ord.longitude}" target="_blank" class="btn btn-sm btn-outline">
            <i class="fa-brands fa-google"></i> Google Maps
          </a>
        </div>
      `;
    }

    const bodyHtml = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
        <div>
          <h4>Mijoz: ${escapeHtml(ord.customer_name)}</h4>
          <p>Telefon: <a href="tel:${escapeHtml(ord.customer_phone)}">${escapeHtml(ord.customer_phone)}</a> ${ord.phone2 ? `(${escapeHtml(ord.phone2)})` : ''}</p>
          <p>Manzil: ${escapeHtml(ord.customer_address)}</p>
          <p>Mo'ljal: ${escapeHtml(ord.landmark || 'Yo\'q')}</p>
          ${navSection}
          ${ord.defect_tags ? `<p style="margin-top: 6px;"><span class="status-pill status-bekor_qilindi">Belgilar: ${escapeHtml(ord.defect_tags)}</span></p>` : ''}
        </div>
        <div>
          <h4>Buyurtma ma'lumotlari:</h4>
          <p>Qabul qilingan sana: ${escapeHtml(ord.pickup_date || '-')}</p>
          <p>Yetkazish muddati: <b>${escapeHtml(ord.target_delivery_date || '-')}</b></p>
          <p>Jami maydon: <b>${ord.total_area ? ord.total_area.toFixed(2) : 0} m²</b> (${ord.total_items} ta buyum)</p>
          <p>Hozirgi holati: ${getStatusPill(ord.status)}</p>
        </div>
      </div>

      <h4>Buyumlar tarkibi:</h4>
      <div class="table-responsive mt-2 mb-3">
        <table class="table">
          <thead>
            <tr>
              <th>№</th>
              <th>Nomi</th>
              <th>O'lchami</th>
              <th>Maydon/Soni</th>
              <th>Narx</th>
              <th>Jami</th>
              <th>Izoh</th>
            </tr>
          </thead>
          <tbody>${itemsRows}</tbody>
        </table>
      </div>

      <div style="background: #f8fafc; padding: 14px; border-radius: 8px; margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between;">
          <span>Buyurtma umumiy summasi:</span>
          <strong>${ord.total_amount.toLocaleString()} so'm</strong>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span>Chegirma:</span>
          <span>${ord.discount.toLocaleString()} so'm</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 16px; font-weight: 700; color: var(--primary); margin: 6px 0;">
          <span>Jami to'lanishi kerak:</span>
          <span>${ord.final_amount.toLocaleString()} so'm</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span>To'langan mablag':</span>
          <span class="text-success">${ord.paid_amount.toLocaleString()} so'm</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span>Qolgan qarzdorlik:</span>
          <span class="text-danger">${(ord.final_amount - ord.paid_amount).toLocaleString()} so'm</span>
        </div>
      </div>

      <hr style="margin-bottom: 16px; border: none; border-top: 1px solid var(--border-color);">

      <h4>Boshqarish va Holatni o'zgartirish:</h4>
      <div class="form-row mt-2">
        <div class="form-group col-6">
          <label>Holatini yangilash:</label>
          <select id="modalUpdateStatus">
            <option value="yangi" ${ord.status === 'yangi' ? 'selected' : ''}>🆕 Yangi tushgan</option>
            <option value="qabul_qilindi" ${ord.status === 'qabul_qilindi' ? 'selected' : ''}>📦 Qabul qilindi (Kuryer oldi)</option>
            <option value="yuvishda" ${ord.status === 'yuvishda' ? 'selected' : ''}>🧼 Yuvish jarayonida</option>
            <option value="quritishda" ${ord.status === 'quritishda' ? 'selected' : ''}>☀️ Quritish kamerasida</option>
            <option value="tayyor" ${ord.status === 'tayyor' ? 'selected' : ''}>✨ Tayyorlandi (Qadoqlangan)</option>
            <option value="yetkazilmoqda" ${ord.status === 'yetkazilmoqda' ? 'selected' : ''}>🚚 Kuryer yo'lda (Yetkazilmoqda)</option>
            <option value="yetkazildi" ${ord.status === 'yetkazildi' ? 'selected' : ''}>✅ Yetkazib topshirildi</option>
            <option value="bekor_qilindi" ${ord.status === 'bekor_qilindi' ? 'selected' : ''}>❌ Bekor qilindi</option>
          </select>
        </div>
        <div class="form-group col-6">
          <label>To'langan summa (so'm):</label>
          <input type="number" id="modalUpdatePaid" value="${Number(ord.paid_amount)}">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group col-6">
          <label>Olib keluvchi kuryer:</label>
          <select id="modalUpdatePickupCourier">
            <option value="">-- Tanlang --</option>
            ${courierPickupOptions}
          </select>
        </div>
        <div class="form-group col-6">
          <label>Yetkazib beruvchi kuryer:</label>
          <select id="modalUpdateDelivCourier">
            <option value="">-- Tanlang --</option>
            ${courierDelivOptions}
          </select>
        </div>
      </div>

      <div class="form-group">
        <label>Kuryer / Admin izohi:</label>
        <input type="text" id="modalUpdateNotes" value="${escapeHtml(ord.courier_notes || '')}" placeholder="Izoh qo'shish...">
      </div>
    `;

    document.getElementById('modalOrderBody').innerHTML = bodyHtml;

    document.getElementById('modalOrderFooter').innerHTML = `
      ${currentUser && currentUser.role === 'owner' ? `
        <button class="btn btn-outline" style="color: var(--danger); margin-right: auto;" onclick="deleteOrderConfirm(${Number(ord.id)})">
          <i class="fa-solid fa-trash"></i> O'chirish
        </button>
      ` : ''}
      <button class="btn btn-telegram" onclick="sendOrderToTg(${Number(ord.id)})">
        <i class="fa-brands fa-telegram"></i> TG Guruhga Tashlash
      </button>
      <button class="btn btn-outline" onclick="downloadWordReceipt(${Number(ord.id)})">
        <i class="fa-solid fa-file-word text-primary"></i> Word Kvitansiya
      </button>
      <button class="btn btn-primary" onclick="saveOrderDetailsChanges(${Number(ord.id)})">
        <i class="fa-solid fa-floppy-disk"></i> O'zgarishlarni Saqlash
      </button>
    `;

    document.getElementById('orderModal').classList.add('show');
  } catch (err) {
    console.error(err);
  }
}

async function saveOrderDetailsChanges(orderId) {
  const status = document.getElementById('modalUpdateStatus').value;
  const paid_amount = document.getElementById('modalUpdatePaid').value;
  const courier_notes = document.getElementById('modalUpdateNotes').value;
  const courier_pickup_id = document.getElementById('modalUpdatePickupCourier').value;
  const courier_delivery_id = document.getElementById('modalUpdateDelivCourier').value;

  try {
    const statusResponse = await fetch(`/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, paid_amount, courier_notes })
    });
    const statusResult = await statusResponse.json();
    if (!statusResponse.ok || !statusResult.success) {
      throw new Error(statusResult.error || 'Buyurtma yangilanmadi');
    }

    if (currentUser.role !== 'courier') {
      const courierResponse = await fetch(`/api/orders/${orderId}/assign-courier`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courier_pickup_id, courier_delivery_id })
      });
      const courierResult = await courierResponse.json();
      if (!courierResponse.ok || !courierResult.success) {
        throw new Error(courierResult.error || 'Kuryer tayinlanmadi');
      }
    }

    showToast('Buyurtma muvaffaqiyatli yangilandi');
    closeOrderModal();
    if (currentUser.role !== 'courier') await loadDashboardStats();
    await loadOrders();
  } catch (error) {
    alert(error.message);
  }
}

function closeOrderModal() {
  document.getElementById('orderModal').classList.remove('show');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('show');
}

async function deleteOrderConfirm(orderId) {
  if (confirm("Haqiqatan ham bu buyurtmani butunlay o'chirmoqchimisiz?")) {
    const res = await fetch(`/api/orders/${orderId}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      showToast("Buyurtma o'chirildi");
      closeOrderModal();
      await loadDashboardStats();
      await loadOrders();
    }
  }
}

// ================= TELEGRAM GURUHGA YUBORISH =================
async function sendOrderToTg(orderId) {
  showToast("Telegram guruhiga yuborilmoqda...", "info");
  try {
    const res = await fetch(`/api/orders/${orderId}/send-telegram`, { method: 'POST' });
    const json = await res.json();
    if (json.success) {
      if (json.simulated) {
        showToast("ℹ️ Xabar tizim jurnalida saqlandi (Simulyatsiya rejimida).");
      } else {
        showToast("✈️ Buyurtma va lokatsiya Telegram guruhga tashlandi!");
      }
      loadTgLogs();
    } else {
      alert("Telegram xatolik: " + json.error);
    }
  } catch (err) {
    alert("Telegram serveriga ulanishda xato");
  }
}

async function sendTestTelegram() {
  showToast("Test xabari guruhga yuborilmoqda...", "info");
  try {
    const res = await fetch('/api/telegram/test', { method: 'POST' });
    const json = await res.json();
    if (json.success) {
      if (json.simulated) {
        alert("Bot Token yoki Guruh ID kiritilmagani sababli simulyatsiya jurnali yangilandi. 'Telegram Guruh Boti' bo'limida token va chat ID ni kiriting.");
      } else {
        showToast("🚀 Guruhga test xabari yetib bordi!");
      }
      loadTgLogs();
    } else {
      alert("Telegram xatolik: " + json.error);
    }
  } catch (e) {
    console.error(e);
  }
}

async function loadTgSettings() {
  try {
    const res = await fetch('/api/settings');
    const json = await res.json();
    if (json.success) {
      const s = json.data;
      if (document.getElementById('tgBotToken')) document.getElementById('tgBotToken').value = s.bot_token || '';
      if (document.getElementById('tgChatId')) document.getElementById('tgChatId').value = s.group_chat_id || '';
      if (document.getElementById('tgAutoSend')) document.getElementById('tgAutoSend').checked = s.auto_send_telegram === 'true';
      if (document.getElementById('compName')) document.getElementById('compName').value = s.company_name || '';
      if (document.getElementById('compPhone')) document.getElementById('compPhone').value = s.company_phone || '';
      if (document.getElementById('compAddress')) document.getElementById('compAddress').value = s.company_address || '';
    }
  } catch (e) {
    console.error(e);
  }
}

async function saveTgSettings(e) {
  e.preventDefault();
  const bot_token = document.getElementById('tgBotToken').value.trim();
  const group_chat_id = document.getElementById('tgChatId').value.trim();
  const auto_send_telegram = document.getElementById('tgAutoSend').checked;
  const company_name = document.getElementById('compName').value.trim();
  const company_phone = document.getElementById('compPhone').value.trim();
  const company_address = document.getElementById('compAddress').value.trim();

  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bot_token, group_chat_id, auto_send_telegram, company_name, company_phone, company_address })
  });

  const json = await res.json();
  if (json.success) {
    showToast("Telegram va korxona sozlamalari saqlandi!");
  }
}

async function loadTgLogs() {
  try {
    const res = await fetch('/api/telegram/logs');
    const json = await res.json();
    const container = document.getElementById('tgLogsContainer');
    if (!container) return;

    if (json.data.length === 0) {
      container.innerHTML = '<p class="text-muted" style="padding: 10px;">Xabarlar jurnali bo\'sh</p>';
      return;
    }

    container.innerHTML = json.data.map(l => `
      <div class="tg-log-item">
        <div style="font-weight: 600; margin-bottom: 2px;">
          Guruh/Chat: <code>${escapeHtml(l.chat_id)}</code> | Holat: <b class="${l.status === 'sent' ? 'text-success' : ''}">${escapeHtml(l.status)}</b>
        </div>
        <div style="white-space: pre-wrap; font-family: monospace; font-size: 11px; background: #fff; padding: 6px; border-radius: 4px; border: 1px solid #e2e8f0;">${escapeHtml(l.message)}</div>
        <small>${escapeHtml(l.created_at)}</small>
      </div>
    `).join('');
  } catch (e) {
    console.error(e);
  }
}

// ================= HISOBOTLARNI EXCEL VA WORD YUKLASH =================
function downloadExcel() {
  showToast("Excel fayli shakllantirilmoqda...", "info");
  window.location.href = '/api/reports/excel';
}

function downloadWordSummary() {
  showToast("Umumiy Word hisobot yuklanmoqda...", "info");
  window.location.href = '/api/reports/word-summary';
}

function downloadWordReceipt(orderId) {
  showToast(`Buyurtma #${orderId} kvitansiyasi Word formatida yuklanmoqda...`, "info");
  window.location.href = `/api/reports/word/${orderId}`;
}

function loadReceiptsList() {
  const tbody = document.querySelector('#receiptReportsTable tbody');
  if (!tbody) return;

  tbody.innerHTML = globalOrders.map(ord => `
    <tr>
      <td><strong class="order-code-badge">${escapeHtml(ord.order_number)}</strong></td>
      <td><strong>${escapeHtml(ord.customer_name)}</strong></td>
      <td>${escapeHtml(ord.customer_phone)}</td>
      <td><strong>${ord.final_amount.toLocaleString()} so'm</strong></td>
      <td>${getStatusPill(ord.status)}</td>
      <td>
        <button class="btn btn-sm btn-outline-primary" onclick="downloadWordReceipt(${Number(ord.id)})">
          <i class="fa-solid fa-file-word"></i> Word Chek (.docx)
        </button>
      </td>
    </tr>
  `).join('');
}

// ================= INTERAKTIV ADMIN KALKULYATORI (1.30 x 2.60 bo'lsa m² va admin narxida hisoblash) =================
function populateQuickCalcSelect() {
  const sel = document.getElementById('quickCalcCategory');
  if (!sel) return;

  sel.innerHTML = globalCategories.map(c => `
    <option value="${Number(c.id)}" data-unit="${escapeHtml(c.unit)}" data-price="${Number(c.price_per_unit)}">
      ${escapeHtml(c.icon || '🧺')} ${escapeHtml(c.name)} (${Number(c.price_per_unit).toLocaleString()} so'm / ${c.unit === 'kv_m' ? 'm²' : 'dona'})
    </option>
  `).join('');
}

function runQuickCalc() {
  const sel = document.getElementById('quickCalcCategory');
  if (!sel || !sel.options[sel.selectedIndex]) return;

  const opt = sel.options[sel.selectedIndex];
  const unit = opt.getAttribute('data-unit');
  const price = parseFloat(opt.getAttribute('data-price')) || 0;

  const len = parseFloat(document.getElementById('quickCalcLen').value) || 0;
  const wid = parseFloat(document.getElementById('quickCalcWid').value) || 0;
  const qty = parseInt(document.getElementById('quickCalcQty').value) || 1;

  let singleArea = 0;
  let totalArea = 0;
  let total = 0;

  if (unit === 'kv_m') {
    singleArea = parseFloat((len * wid).toFixed(2));
    totalArea = parseFloat((singleArea * qty).toFixed(2));
    total = Math.round(totalArea * price);

    document.getElementById('quickResSingleArea').innerText = `${len} × ${wid} = ${singleArea} m²`;
    document.getElementById('quickResArea').innerText = `${totalArea} m² (${qty} dona)`;
  } else {
    document.getElementById('quickResSingleArea').innerText = `1 dona`;
    document.getElementById('quickResArea').innerText = `${qty} dona`;
    total = Math.round(qty * price);
  }

  document.getElementById('quickResUnitPrice').innerText = `${price.toLocaleString()} so'm`;
  document.getElementById('quickResTotal').innerText = `${total.toLocaleString()} so'm`;
}

// Toast
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;

  let icon = '<i class="fa-solid fa-check-circle" style="color: #10b981;"></i>';
  if (type === 'info') icon = '<i class="fa-solid fa-circle-info" style="color: #3b82f6;"></i>';

  toast.innerHTML = `${icon} <span>${escapeHtml(message)}</span>`;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 4000);
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
