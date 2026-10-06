// app.js - Foydalanuvchi interfeysi, Avto-lokatsiya, Hisoblash va Login tizimi
let currentUser = null; // { id, username, full_name, role, phone, car_model, car_number }
let globalCategories = [];
let globalCouriers = [];
let globalOrders = [];
let authenticatedDataLoaded = false;

function togglePasswordVisibility() {
  const input = document.getElementById('loginPassword');
  const button = document.querySelector('.password-visibility-toggle');
  if (!input || !button) return;
  const showPassword = input.type === 'password';
  input.type = showPassword ? 'text' : 'password';
  button.innerHTML = `<i class="fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'}" aria-hidden="true"></i>`;
  button.setAttribute('aria-label', showPassword ? 'Parolni yashirish' : 'Parolni ko‘rsatish');
  button.title = showPassword ? 'Parolni yashirish' : 'Parolni ko‘rsatish';
}

function applyTheme(theme) {
  const activeTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = activeTheme;
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    const nextTheme = activeTheme === 'dark' ? 'light' : 'dark';
    const label = nextTheme === 'light' ? 'Kunduzgi rejim' : 'Tungi rejim';
    const icon = button.querySelector('i');
    if (icon) icon.className = `fa-solid ${nextTheme === 'light' ? 'fa-sun' : 'fa-moon'}`;
    button.setAttribute('aria-label', `${label}ga o'tish`);
    button.title = `${label}ga o'tish`;
    const labelElement = button.querySelector('[data-theme-label]');
    if (labelElement) labelElement.textContent = label;
  });
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = activeTheme === 'dark' ? '#09090d' : '#f4f6fb';
}

async function resetStaffPassword(userId) {
  if (!confirm('Ushbu xodim uchun yangi vaqtinchalik parol yaratilsinmi? Eski sessiyalari tizimdan chiqariladi.')) return;
  try {
    const response = await fetch(`/api/users/${userId}/reset-password`, { method: 'POST' });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Parolni yangilab bo‘lmadi');
    alert(`${result.message}\n\nVaqtinchalik parol:\n${result.temporary_password}`);
  } catch (error) {
    alert(error.message);
  }
}

async function loadActiveSessions() {
  const container = document.getElementById('activeSessionsContainer');
  if (!container) return;
  container.innerHTML = '<p class="text-muted">Faol qurilmalar yuklanmoqda...</p>';
  try {
    const response = await fetch('/api/sessions');
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Sessiyalarni yuklab bo‘lmadi');
    if (!result.data.length) {
      container.innerHTML = '<p class="text-muted">Hozir faol qurilma yo‘q.</p>';
      return;
    }
    container.innerHTML = `
      <table class="table">
        <thead><tr><th>Xodim</th><th>Rol</th><th>Qurilma / brauzer</th><th>IP</th><th>Kirilgan vaqt</th><th>Amal</th></tr></thead>
        <tbody>${result.data.map(session => `
          <tr>
            <td><strong>${escapeHtml(session.full_name)}</strong><br><small>${escapeHtml(session.username)}</small></td>
            <td>${escapeHtml(session.role)}</td>
            <td>${escapeHtml(session.user_agent || 'Noma’lum qurilma')}</td>
            <td><code>${escapeHtml(session.ip_address || '-')}</code></td>
            <td>${escapeHtml(session.created_at || '-')}</td>
            <td><button class="btn btn-sm btn-outline" onclick="revokeSession('${escapeHtml(session.session_id)}')"><i class="fa-solid fa-right-from-bracket"></i> Chiqaring</button></td>
          </tr>
        `).join('')}</tbody>
      </table>
      <button class="btn btn-danger btn-sm mt-2" onclick="revokeAllUserSessions()"><i class="fa-solid fa-user-slash"></i> Barcha xodimlarni chiqarish</button>
    `;
  } catch (error) {
    container.innerHTML = `<p class="text-danger">${escapeHtml(error.message)}</p>`;
  }
}

async function revokeSession(sessionId) {
  if (!confirm('Ushbu qurilmani tizimdan chiqarasizmi?')) return;
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Qurilmani chiqarib bo‘lmadi');
    await loadActiveSessions();
    showToast(result.message);
  } catch (error) {
    alert(error.message);
  }
}

async function revokeAllUserSessions() {
  if (!confirm('Barcha xodimlarning faol qurilmalarini chiqarasizmi?')) return;
  try {
    const response = await fetch('/api/sessions', { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Qurilmalarni chiqarib bo‘lmadi');
    await loadActiveSessions();
    showToast(`${result.revoked} ta faol sessiya bekor qilindi`);
  } catch (error) {
    alert(error.message);
  }
}

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('osaf-theme', nextTheme);
  applyTheme(nextTheme);
}

function enableHorizontalScroll() {
  document.querySelectorAll('.table-responsive, .items-table-wrapper').forEach(scroller => {
    scroller.tabIndex = 0;
    scroller.setAttribute('aria-label', 'Jadvalni gorizontal surish mumkin');
  });

  document.addEventListener('wheel', event => {
    const scroller = event.target.closest('.table-responsive, .items-table-wrapper, .nav-menu');
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

    const maxScroll = scroller.scrollWidth - scroller.clientWidth;
    if ((event.deltaY < 0 && scroller.scrollLeft <= 0) ||
        (event.deltaY > 0 && scroller.scrollLeft >= maxScroll)) return;

    scroller.scrollLeft += event.deltaY;
    event.preventDefault();
  }, { passive: false });

  let dragState = null;
  const suppressClick = new WeakSet();

  document.querySelectorAll('.table-responsive, .items-table-wrapper').forEach(scroller => {
    scroller.addEventListener('mousedown', event => {
      if (event.button !== 0 || event.target.closest('a, button, input, select, textarea, label')) return;
      dragState = { scroller, startX: event.clientX, startScroll: scroller.scrollLeft, moved: false };
    });

    scroller.addEventListener('click', event => {
      if (!suppressClick.has(scroller)) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick.delete(scroller);
    }, true);
  });

  document.addEventListener('mousemove', event => {
    if (!dragState) return;
    const distance = event.clientX - dragState.startX;
    if (Math.abs(distance) > 5 && !dragState.moved) {
      dragState.moved = true;
      dragState.scroller.classList.add('is-dragging');
    }
    if (dragState.moved) {
      dragState.scroller.scrollLeft = dragState.startScroll - distance;
      event.preventDefault();
    }
  });

  document.addEventListener('mouseup', () => {
    if (!dragState) return;
    const { scroller, moved } = dragState;
    scroller.classList.remove('is-dragging');
    if (moved) {
      suppressClick.add(scroller);
      setTimeout(() => suppressClick.delete(scroller), 0);
    }
    dragState = null;
  });
}

function enable3dEffects() {
  const selector = '.stat-card, .card, .courier-card, .report-box, .login-card, .btn, .theme-toggle, .nav-item';
  let activeSurface = null;
  let activeTouchSurface = null;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const findSurface = target => target instanceof Element ? target.closest(selector) : null;

  const resetSurface = surface => {
    if (!surface) return;
    surface.style.removeProperty('--tilt-x');
    surface.style.removeProperty('--tilt-y');
    surface.style.removeProperty('--light-x');
    surface.style.removeProperty('--light-y');
    surface.style.removeProperty('--shadow-x');
    surface.style.removeProperty('--shadow-y');
    surface.style.removeProperty('--shadow-wide-x');
    surface.style.removeProperty('--shadow-wide-y');
    surface.classList.remove('is-3d-active', 'is-touching');
  };

  const updateSurface = (surface, clientX, clientY, strength) => {
    const rect = surface.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(-1, Math.min(1, ((clientX - rect.left) / rect.width - 0.5) * 2));
    const y = Math.max(-1, Math.min(1, ((clientY - rect.top) / rect.height - 0.5) * 2));
    const tilt = strength;
    surface.style.setProperty('--tilt-x', `${-y * tilt}deg`);
    surface.style.setProperty('--tilt-y', `${x * tilt}deg`);
    surface.style.setProperty('--light-x', `${(x + 1) * 50}%`);
    surface.style.setProperty('--light-y', `${(y + 1) * 50}%`);
    surface.style.setProperty('--shadow-x', `${-x * 5}px`);
    surface.style.setProperty('--shadow-y', `${Math.max(7, 12 + y * 5)}px`);
    surface.style.setProperty('--shadow-wide-x', `${-x * 8}px`);
    surface.style.setProperty('--shadow-wide-y', `${Math.max(12, 18 + y * 8)}px`);
    surface.classList.add('is-3d-active');
  };

  document.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' && activeTouchSurface) {
      updateSurface(activeTouchSurface, event.clientX, event.clientY, 4);
      activeTouchSurface.classList.add('is-touching');
      return;
    }
    if (!finePointer.matches || event.pointerType !== 'mouse') return;
    const surface = findSurface(event.target);
    if (activeSurface && activeSurface !== surface) resetSurface(activeSurface);
    activeSurface = surface;
    if (surface) updateSurface(surface, event.clientX, event.clientY, 5);
  });

  document.addEventListener('pointerdown', event => {
    if (event.target instanceof Element &&
        event.target.closest('.table-responsive, .items-table-wrapper, .nav-menu')) return;
    const surface = findSurface(event.target);
    if (!surface || event.pointerType !== 'touch') return;
    activeTouchSurface = surface;
    updateSurface(surface, event.clientX, event.clientY, 2.5);
    surface.classList.add('is-touching');
  });

  const releaseTouch = event => {
    if (event.pointerType !== 'touch') return;
    const surface = activeTouchSurface || findSurface(event.target);
    if (!surface) return;
    activeTouchSurface = null;
    surface.classList.remove('is-touching');
    setTimeout(() => resetSurface(surface), 180);
  };
  document.addEventListener('pointerup', releaseTouch);
  document.addEventListener('pointercancel', releaseTouch);
  document.addEventListener('pointerout', event => {
    if (!finePointer.matches || event.pointerType !== 'mouse') return;
    const nextSurface = findSurface(event.relatedTarget);
    if (nextSurface) return;
    resetSurface(activeSurface);
    activeSurface = null;
  });
}

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
  applyTheme(localStorage.getItem('osaf-theme') || 'dark');
  enableHorizontalScroll();
  enable3dEffects();
  await loadLoginCaptcha();

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
async function loadLoginCaptcha() {
  try {
    const response = await fetch('/api/auth/captcha');
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Tekshirish rasmini yuklab bo‘lmadi');
    document.getElementById('loginCaptchaImage').src = result.data.image;
    document.getElementById('loginCaptchaId').value = result.data.id;
    document.getElementById('loginCaptchaAnswer').value = '';
  } catch (error) {
    console.error('CAPTCHA yuklash xatosi:', error);
    const hint = document.getElementById('loginCaptchaHint');
    if (hint) hint.textContent = error.message;
  }
}

async function initializeAuthenticatedApp() {
  if (authenticatedDataLoaded) return;
  authenticatedDataLoaded = true;

  await loadCategories();
  if (currentUser.role !== 'courier') {
    await loadStaff();
    await loadDashboardStats();
  } else {
    const response = await fetch('/api/couriers');
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Kuryerlar ro‘yxati yuklanmadi');
    globalCouriers = result.data;
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
  const captcha_id = document.getElementById('loginCaptchaId').value;
  const captcha_answer = document.getElementById('loginCaptchaAnswer').value.trim();

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, captcha_id, captcha_answer })
    });

    const json = await res.json();
    if (json.success) {
      currentUser = json.user;
      applyUserSession();
      await initializeAuthenticatedApp();
      showToast(`Xush kelibsiz, ${currentUser.full_name}!`);
    } else {
      alert("Xatolik: " + (json.error || "Login yoki parol noto'g'ri"));
      await loadLoginCaptcha();
    }
  } catch (err) {
    alert("Serverga ulanishda xato yuz berdi");
    await loadLoginCaptcha();
  } finally {
    document.getElementById('loginPassword').value = '';
    document.getElementById('loginCaptchaAnswer').value = '';
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
    'owner': 'Ega Admin',
    'admin': 'Operator / Admin',
    'courier': `Dastavchik (${currentUser.car_model || 'Mashina'})`
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
    'sessions': { title: "Faol qurilmalar", sub: "Tizimga kirgan qurilmalarni ko‘ring va shubhali sessiyalarni bekor qiling" },
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
  if (tabId === 'telegram-config') {
    loadTgLogs();
    loadTelegramStatus();
    loadTelegramUsers();
  }
  if (tabId === 'sessions') loadActiveSessions();
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

      showToast("Lokatsiya koordinatalari avtomatik olindi!");
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
      <td><span class="category-icon"><i class="fa-solid fa-rug" aria-hidden="true"></i></span></td>
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
  if (!name || !price_per_unit) {
    alert("Iltimos, xizmat nomi va narxini kiriting");
    return;
  }

  const res = await fetch('/api/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, unit, price_per_unit, description })
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
  if (activeSel) activeSel.innerHTML = '<option value="all">Barcha kuryerlar ishlari</option>' + optionsHtml;
}

function renderStaffTable(users) {
  const tbody = document.getElementById('staffTableBody');
  if (!tbody) return;

  const roleLabels = {
    'owner': '<span class="status-pill status-yetkazildi"><i class="fa-solid fa-user-shield" aria-hidden="true"></i> Ega Admin</span>',
    'admin': '<span class="status-pill status-yangi"><i class="fa-solid fa-user-gear" aria-hidden="true"></i> Operator / Admin</span>',
    'courier': '<span class="status-pill status-yetkazilmoqda"><i class="fa-solid fa-truck-fast" aria-hidden="true"></i> Dastavchik</span>'
  };

  tbody.innerHTML = users.map(u => `
    <tr>
      <td><strong>${escapeHtml(u.full_name)}</strong></td>
      <td><code>${escapeHtml(u.username)}</code></td>
      <td>${roleLabels[u.role] || escapeHtml(u.role)}</td>
      <td><a href="tel:${escapeHtml(u.phone)}">${escapeHtml(u.phone || '-')}</a></td>
      <td>${u.car_model ? `<b>${escapeHtml(u.car_model)}</b> (${escapeHtml(u.car_number || '')})` : '-'}</td>
      <td><span class="status-pill status-tayyor">Faol</span></td>
      <td>
        ${Number(u.id) === currentUser.id
          ? '<small>O‘z parolingizni profil orqali almashtiring</small>'
          : `<button class="btn btn-sm btn-outline" onclick="resetStaffPassword(${Number(u.id)})"><i class="fa-solid fa-key"></i> Parolni tiklash</button>`}
      </td>
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
      ${escapeHtml(c.name)}
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
    <td class="item-dimension-cell" style="width: 85px;">
      <input type="number" class="item-len" step="0.05" min="0" required oninput="calculateRow('${rowId}')" placeholder="Uzunligi">
    </td>
    <td class="item-dimension-cell" style="width: 85px;">
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
    row.querySelectorAll('.item-dimension-cell').forEach(cell => { cell.hidden = true; });
  } else {
    lenInput.disabled = false;
    widInput.disabled = false;
    row.querySelectorAll('.item-dimension-cell').forEach(cell => { cell.hidden = false; });
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
        showToast(`${orderCreatedMessage} va Telegram guruhiga yuborildi!`);
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
    'yangi': { label: 'Yangi tushgan', icon: 'fa-sparkles', cls: 'status-yangi' },
    'qabul_qilindi': { label: 'Qabul qilindi', icon: 'fa-box-open', cls: 'status-qabul_qilindi' },
    'yuvishda': { label: 'Yuvishda', icon: 'fa-soap', cls: 'status-yuvishda' },
    'quritishda': { label: 'Quritishda', icon: 'fa-fan', cls: 'status-quritishda' },
    'tayyor': { label: 'Tayyor (Qadoqda)', icon: 'fa-box', cls: 'status-tayyor' },
    'yetkazilmoqda': { label: 'Yetkazilmoqda', icon: 'fa-truck-fast', cls: 'status-yetkazilmoqda' },
    'yetkazildi': { label: 'Yetkazildi', icon: 'fa-circle-check', cls: 'status-yetkazildi' },
    'bekor_qilindi': { label: 'Bekor qilindi', icon: 'fa-circle-xmark', cls: 'status-bekor_qilindi' }
  };
  const item = map[status] || { label: escapeHtml(status), cls: 'status-yangi' };
  const icon = item.icon ? `<i class="fa-solid ${item.icon}" aria-hidden="true"></i>` : '';
  return `<span class="status-pill ${item.cls}">${icon}${item.label}</span>`;
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
    const pickupHandoff = currentUser.role === 'courier' &&
      ord.courier_pickup_id === currentUser.id &&
      ['yangi', 'qabul_qilindi'].includes(ord.status)
      ? renderCourierHandoffControl(ord.id, 'pickup', 'Olib ketishni topshirish')
      : '';
    const deliveryHandoff = currentUser.role === 'courier' &&
      ord.courier_delivery_id === currentUser.id &&
      ['qabul_qilindi', 'yuvishda', 'quritishda', 'tayyor', 'yetkazilmoqda'].includes(ord.status)
      ? renderCourierHandoffControl(ord.id, 'delivery', 'Yetkazishni topshirish')
      : '';

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
        ${pickupHandoff || deliveryHandoff ? `
          <div class="courier-handoff-controls">
            <strong><i class="fa-solid fa-arrows-turn-to-dots"></i> Boshqa kuryerga topshirish</strong>
            ${pickupHandoff}
            ${deliveryHandoff}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function renderCourierHandoffControl(orderId, assignment, label) {
  const options = globalCouriers
    .filter(courier => courier.id !== currentUser.id)
    .map(courier => `<option value="${Number(courier.id)}">${escapeHtml(courier.full_name)}</option>`)
    .join('');
  return `
    <div class="courier-handoff-row">
      <label for="handoff-${orderId}-${assignment}">${label}</label>
      <div>
        <select id="handoff-${orderId}-${assignment}">
          <option value="">Kuryerni tanlang</option>${options}
        </select>
        <button class="btn btn-sm btn-outline-primary" onclick="handoffOrder(${Number(orderId)}, '${assignment}')">
          <i class="fa-solid fa-share"></i> Topshirish
        </button>
      </div>
    </div>
  `;
}

async function handoffOrder(orderId, assignment) {
  const courierSelect = document.getElementById(`handoff-${orderId}-${assignment}`);
  const to_courier_id = courierSelect ? courierSelect.value : '';
  if (!to_courier_id) {
    alert('Buyurtmani oladigan kuryerni tanlang');
    return;
  }
  const notes = prompt('Topshirishga qisqa izoh yozing (ixtiyoriy):') || '';
  try {
    const response = await fetch(`/api/orders/${orderId}/handoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignment, to_courier_id: Number(to_courier_id), notes })
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Buyurtmani topshirib bo‘lmadi');
    showToast(result.message);
    if (result.notification_warning) {
      showToast(`Buyurtma topshirildi, ammo Telegram xabari yuborilmadi: ${result.notification_warning}`, 'info');
    } else if (result.notifications?.some(notification => !notification.success)) {
      showToast('Buyurtma topshirildi, Telegramda ayrim kuryerlarga xabar bormadi.', 'info');
    }
    await loadOrders();
  } catch (error) {
    alert(error.message);
  }
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

      ${(ord.handoffs || []).length ? `
        <div class="order-handoff-history">
          <h4><i class="fa-solid fa-clock-rotate-left"></i> Kuryerlar topshirish tarixi</h4>
          ${(ord.handoffs || []).map(handoff => `
            <p><strong>${handoff.assignment === 'pickup' ? 'Olib ketish' : 'Yetkazish'}:</strong>
              ${escapeHtml(handoff.from_courier_name)} → ${escapeHtml(handoff.to_courier_name)}
              <small>${escapeHtml(handoff.created_at || '')}</small>
              ${handoff.notes ? `<br><span>${escapeHtml(handoff.notes)}</span>` : ''}
            </p>
          `).join('')}
        </div>
      ` : ''}

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
            <option value="qabul_qilindi" ${ord.status === 'qabul_qilindi' ? 'selected' : ''}>Qabul qilindi (Kuryer oldi)</option>
            <option value="yuvishda" ${ord.status === 'yuvishda' ? 'selected' : ''}>Yuvish jarayonida</option>
            <option value="quritishda" ${ord.status === 'quritishda' ? 'selected' : ''}>Quritish kamerasida</option>
            <option value="tayyor" ${ord.status === 'tayyor' ? 'selected' : ''}>Tayyorlandi (Qadoqlangan)</option>
            <option value="yetkazilmoqda" ${ord.status === 'yetkazilmoqda' ? 'selected' : ''}>Kuryer yo'lda (Yetkazilmoqda)</option>
            <option value="yetkazildi" ${ord.status === 'yetkazildi' ? 'selected' : ''}>Yetkazib topshirildi</option>
            <option value="bekor_qilindi" ${ord.status === 'bekor_qilindi' ? 'selected' : ''}>Bekor qilindi</option>
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
        showToast("Buyurtma va lokatsiya Telegram guruhga yuborildi!");
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
        showToast("Guruhga test xabari yetib bordi!");
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
      if (document.getElementById('tgAdminId')) document.getElementById('tgAdminId').value = s.telegram_admin_id || '';
      if (document.getElementById('tgAppUrl')) document.getElementById('tgAppUrl').value = s.app_url || 'https://osaf.vercel.app';
      if (document.getElementById('tgAutoSend')) document.getElementById('tgAutoSend').checked = s.auto_send_telegram === 'true';
      if (document.getElementById('compName')) document.getElementById('compName').value = s.company_name || '';
      if (document.getElementById('orderNumberStart')) document.getElementById('orderNumberStart').value = s.order_number_start || '1000';
      if (document.getElementById('compPhone')) document.getElementById('compPhone').value = s.company_phone || '';
      if (document.getElementById('compAddress')) document.getElementById('compAddress').value = s.company_address || '';
      await Promise.all([loadTelegramStatus(), loadTelegramUsers()]);
    }
  } catch (e) {
    console.error(e);
  }
}

async function saveTgSettings(e) {
  e.preventDefault();
  const bot_token = document.getElementById('tgBotToken').value.trim();
  const group_chat_id = document.getElementById('tgChatId').value.trim();
  const telegram_admin_id = document.getElementById('tgAdminId').value.trim();
  const app_url = document.getElementById('tgAppUrl').value.trim();
  const auto_send_telegram = document.getElementById('tgAutoSend').checked;
  const company_name = document.getElementById('compName').value.trim();
  const order_number_start = document.getElementById('orderNumberStart').value.trim();
  const company_phone = document.getElementById('compPhone').value.trim();
  const company_address = document.getElementById('compAddress').value.trim();

  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bot_token, group_chat_id, telegram_admin_id, app_url, auto_send_telegram, company_name, order_number_start, company_phone, company_address })
  });

  const json = await res.json();
  if (json.success) {
    showToast("Telegram va korxona sozlamalari saqlandi!");
    await loadTelegramStatus();
  } else {
    showToast(json.error || 'Sozlamalarni saqlashda xatolik yuz berdi!', 'error');
  }
}

async function setupTelegramWebhook() {
  try {
    const response = await fetch('/api/telegram/setup', { method: 'POST' });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Telegram botni ulab bo‘lmadi');
    showToast('Bot webhook o‘rnatildi va buyruqlar faollashtirildi');
    await loadTelegramStatus();
  } catch (error) {
    alert(error.message);
  }
}

async function loadTelegramStatus() {
  const container = document.getElementById('tgBotStatus');
  if (!container) return;
  container.innerHTML = '<p>Bot va webhook tekshirilmoqda...</p>';
  try {
    const response = await fetch('/api/telegram/status');
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Bot holatini olib bo‘lmadi');
    const status = result.data;
    container.innerHTML = `
      <p><strong>Bot token:</strong> ${status.configured ? 'Sozlangan' : 'Kiritilmagan'}</p>
      <p><strong>Bot:</strong> ${status.bot ? `@${escapeHtml(status.bot.username || '')} (${escapeHtml(status.bot.first_name || '')})` : 'Tekshirilmagan'}</p>
      <p><strong>Webhook:</strong> ${status.webhook?.url ? escapeHtml(status.webhook.url) : 'Ulanmagan'}</p>
      <p><strong>Guruh / ega chat:</strong> ${status.group_chat_configured ? 'Guruh sozlangan' : 'Guruh yo‘q'} / ${status.admin_chat_configured ? 'Ega ID sozlangan' : 'Ega ID yo‘q'}</p>
      <p><strong>Botga bog‘langan xodimlar:</strong> ${Number(status.linked_users)}</p>
      ${status.webhook ? `<p><strong>Kutilayotgan update:</strong> ${Number(status.webhook.pending_update_count)}${status.webhook.last_error_message ? ` · <span class="text-danger">${escapeHtml(status.webhook.last_error_message)}</span>` : ''}</p>` : ''}
      ${status.error ? `<p class="text-danger"><strong>Telegram xatosi:</strong> ${escapeHtml(status.error)}</p>` : ''}
    `;
  } catch (error) {
    container.innerHTML = `<p class="text-danger">${escapeHtml(error.message)}</p>`;
  }
}

async function loadTelegramUsers() {
  const container = document.getElementById('tgLinkedUsers');
  if (!container) return;
  try {
    const response = await fetch('/api/telegram/users');
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Telegram profillarini yuklab bo‘lmadi');
    container.innerHTML = `
      <table class="table">
        <thead><tr><th>Xodim</th><th>Rol</th><th>Telegram ID</th><th></th></tr></thead>
        <tbody>${result.data.map(user => `
          <tr>
            <td>${escapeHtml(user.full_name)} <small>@${escapeHtml(user.username)}</small></td>
            <td>${escapeHtml(user.role)}</td>
            <td><input id="telegram-user-${Number(user.id)}" inputmode="numeric" value="${escapeHtml(user.telegram_id || '')}" placeholder="/start dan olgan ID"></td>
            <td><button class="btn btn-sm btn-outline-primary" onclick="saveTelegramUser(${Number(user.id)})">Saqlash</button></td>
          </tr>
        `).join('')}</tbody>
      </table>
    `;
  } catch (error) {
    container.innerHTML = `<p class="text-danger">${escapeHtml(error.message)}</p>`;
  }
}

async function saveTelegramUser(userId) {
  const input = document.getElementById(`telegram-user-${userId}`);
  try {
    const response = await fetch(`/api/telegram/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id: input.value.trim() })
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Telegram ID saqlanmadi');
    showToast(result.message);
    await loadTelegramStatus();
  } catch (error) {
    alert(error.message);
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
async function downloadExcel() {
  showToast('Yangi buyurtmalar Excel fayli tayyorlanmoqda...', 'info');
  try {
    const response = await fetch('/api/reports/excel');
    if (response.status === 204) {
      showToast('Yangi eksport qilinmagan buyurtmalar yo‘q.', 'info');
      return;
    }
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || 'Excel hisoboti tayyorlanmadi');
    }
    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `OSAF_Buyurtmalar_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    const telegramSent = response.headers.get('X-Telegram-Sent') === 'true';
    const exportedCount = response.headers.get('X-Exported-Orders') || '0';
    showToast(`${exportedCount} ta yangi buyurtma yuklandi${telegramSent ? ' va Telegramga yuborildi' : ' (Telegram qabul qiluvchi sozlanmagan)'}.`, telegramSent ? 'success' : 'info');
  } catch (error) {
    alert(error.message);
  }
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
      ${escapeHtml(c.name)} (${Number(c.price_per_unit).toLocaleString()} so'm / ${c.unit === 'kv_m' ? 'm²' : 'dona'})
    </option>
  `).join('');
  runQuickCalc();
}

function setQuickCalcSize(length, width) {
  document.getElementById('quickCalcLen').value = length;
  document.getElementById('quickCalcWid').value = width;
  runQuickCalc();
}

function runQuickCalc() {
  const sel = document.getElementById('quickCalcCategory');
  if (!sel || !sel.options[sel.selectedIndex]) return;

  const opt = sel.options[sel.selectedIndex];
  const unit = opt.getAttribute('data-unit');
  const price = parseFloat(opt.getAttribute('data-price')) || 0;
  const dimensions = document.getElementById('quickCalcDimensionFields');
  const presets = document.getElementById('quickCalcSizePresets');
  const singleAreaRow = document.getElementById('quickCalcSingleAreaRow');
  const quantityLabel = document.getElementById('quickCalcQuantityLabel');
  const unitPriceLabel = document.getElementById('quickResUnitPriceLabel');
  const isAreaBased = unit === 'kv_m';
  if (dimensions) dimensions.hidden = !isAreaBased;
  if (presets) presets.hidden = !isAreaBased;
  if (singleAreaRow) singleAreaRow.hidden = !isAreaBased;
  if (quantityLabel) quantityLabel.textContent = isAreaBased ? 'Gilamlar soni' : 'Buyumlar soni';
  if (unitPriceLabel) unitPriceLabel.textContent = isAreaBased ? '1 m² uchun admin narxi:' : '1 dona uchun admin narxi:';

  const len = parseFloat(document.getElementById('quickCalcLen').value) || 0;
  const wid = parseFloat(document.getElementById('quickCalcWid').value) || 0;
  const qty = parseInt(document.getElementById('quickCalcQty').value) || 1;

  let singleArea = 0;
  let totalArea = 0;
  let total = 0;

  if (isAreaBased) {
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
