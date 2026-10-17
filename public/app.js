// app.js - Foydalanuvchi interfeysi, Avto-lokatsiya, Hisoblash va Login tizimi
let currentUser = null; // { id, username, full_name, role, phone, car_model, car_number }
let globalStaff = [];
let globalCategories = [];
let globalCouriers = [];
let globalOrders = [];
let globalWasherOrders = [];
let globalPackagerOrders = [];
let authenticatedDataLoaded = false;
let workflowRefreshTimer = null;
let ownerNotificationInitialized = false;
let latestOwnerNotificationId = 0;

function togglePasswordVisibility(inputId, button) {
  const input = document.getElementById(inputId || 'loginPassword');
  button = button || document.querySelector('.password-visibility-toggle');
  if (!input || !button) return;
  if (input.classList.contains('secret-masked')) {
    const visible = input.classList.toggle('secret-visible');
    button.innerHTML = `<i class="fa-solid ${visible ? 'fa-eye-slash' : 'fa-eye'}" aria-hidden="true"></i>`;
    button.setAttribute('aria-label', visible ? 'Tokenni yashirish' : 'Tokenni ko‘rsatish');
    button.title = visible ? 'Tokenni yashirish' : 'Tokenni ko‘rsatish';
    return;
  }
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
  if (!confirm('Ushbu xodimga yangi vaqtinchalik parol berilsinmi? Amaldagi parol ko‘rsatilmaydi. Eski qurilma sessiyalari bekor qilinadi.')) return;
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
  let activeTouchSurface = null;
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
    if (event.pointerType !== 'touch' || !activeTouchSurface) return;
    updateSurface(activeTouchSurface, event.clientX, event.clientY, 1.5);
    activeTouchSurface.classList.add('is-touching');
  });

  document.addEventListener('pointerdown', event => {
    if (event.target instanceof Element &&
        event.target.closest('.table-responsive, .items-table-wrapper, .nav-menu')) return;
    const surface = findSurface(event.target);
    if (!surface || event.pointerType !== 'touch') return;
    activeTouchSurface = surface;
    updateSurface(surface, event.clientX, event.clientY, 1.5);
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
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
      .catch(error => console.error('PWA service worker ro‘yxatdan o‘tmadi:', error));
  }

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

  if (['owner', 'admin', 'courier'].includes(currentUser.role)) await loadCategories();
  if (['owner', 'admin'].includes(currentUser.role)) {
    await loadStaff();
    await loadDashboardStats();
    if (currentUser.role === 'owner') await loadPayrollSummary();
  } else if (currentUser.role === 'courier') {
    const response = await fetch('/api/couriers');
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Kuryerlar ro‘yxati yuklanmadi');
    globalCouriers = result.data;
  }
  if (currentUser.role === 'washer') {
    await loadWasherOrders();
  } else if (currentUser.role === 'packager') {
    await loadPackagerOrders();
  } else {
    await loadOrders();
  }
  if (['courier', 'washer', 'packager'].includes(currentUser.role)) await loadMyPayroll();
  if (currentUser.role === 'owner') await loadTgSettings();

  if (['owner', 'admin', 'courier'].includes(currentUser.role)) {
    addNewItemRow();
    addNewItemRow();
    runQuickCalc();
  }
  if (currentUser.role === 'owner') await loadOwnerNotifications();
  if (workflowRefreshTimer) clearInterval(workflowRefreshTimer);
  workflowRefreshTimer = setInterval(() => {
    if (!currentUser) return;
    if (currentUser.role === 'washer') {
      if (!globalWasherOrders.some(order => order.status === 'olchayapti')) loadWasherOrders();
    }
    else if (currentUser.role === 'packager') loadPackagerOrders();
    else loadOrders();
    if (['courier', 'washer', 'packager'].includes(currentUser.role)) loadMyPayroll();
    if (currentUser.role === 'owner') loadOwnerNotifications();
  }, ['courier', 'packager'].includes(currentUser.role) ? 5000 : 30000);
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
    ownerNotificationInitialized = false;
    latestOwnerNotificationId = 0;
    if (workflowRefreshTimer) clearInterval(workflowRefreshTimer);
    workflowRefreshTimer = null;
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

function syncCourierDimensionVisibility() {
  const isCourier = currentUser?.role === 'courier';
  document.getElementById('orderItemsTable')?.classList.toggle('courier-intake', isCourier);
  document.querySelectorAll('.item-dimension-heading').forEach(el => {
    el.style.display = isCourier ? 'none' : '';
  });
  document.querySelectorAll('.item-dimension-cell').forEach(el => {
    el.style.display = isCourier ? 'none' : '';
  });
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
    'courier': `Dastavchik (${currentUser.car_model || 'Mashina'})`,
    'washer': 'Yuvuvchi',
    'packager': 'Qadoqlovchi'
  };
  document.getElementById('sidebarUserRoleBadge').innerText = roleNames[currentUser.role] || currentUser.role;

  const ownerElements = document.querySelectorAll('.owner-only');
  document.querySelectorAll('.nav-washer').forEach(el => el.style.display = currentUser.role === 'washer' ? 'flex' : 'none');
  document.querySelectorAll('.nav-packager').forEach(el => el.style.display = currentUser.role === 'packager' ? 'flex' : 'none');
  const notificationPanel = document.getElementById('ownerNotificationsPanel');
  if (notificationPanel) notificationPanel.style.display = currentUser.role === 'owner' ? 'block' : 'none';
  document.getElementById('orderItemsTable').classList.toggle('courier-intake', currentUser.role === 'courier');
  syncCourierDimensionVisibility();
  const orderItemsHeading = document.getElementById('orderItemsHeading');
  if (orderItemsHeading) {
    orderItemsHeading.innerHTML = currentUser.role === 'courier'
      ? '<i class="fa-solid fa-box"></i> Olib ketiladigan buyumlar'
      : '<i class="fa-solid fa-calculator"></i> Gilam o‘lchamlari va kalkulyator';
  }

  if (currentUser.role === 'courier') {
    ownerElements.forEach(el => el.style.display = 'none');
    document.getElementById('tab-new-order').style.display = '';
    document.querySelectorAll('.nav-dashboard, .nav-orders, .nav-reports').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.nav-new-order').forEach(el => el.style.display = 'flex');
    document.querySelectorAll('.nav-courier').forEach(el => el.style.display = 'flex');
    document.querySelectorAll('.courier-hidden-finance').forEach(el => el.style.display = 'none');
    document.getElementById('orderCourierAssignmentFields').style.display = 'none';
    
    // Dastavchik uchun sarlavha va default rejim
    const courierSelect = document.getElementById('courierActiveSelect');
    courierSelect.innerHTML = `<option value="${currentUser.id}">Mening buyurtmalarim</option>`;
    courierSelect.value = String(currentUser.id);
    courierSelect.disabled = true;
    document.getElementById('courierDashboardTitle').innerHTML = `<i class="fa-solid fa-truck"></i> Mening Buyurtmalarim`;

    switchTab('courier-mode');
  } else if (currentUser.role === 'washer') {
    ownerElements.forEach(el => el.style.display = 'none');
    document.querySelectorAll('.nav-dashboard, .nav-orders, .nav-new-order, .nav-courier, .nav-reports').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.courier-hidden-finance').forEach(el => el.style.display = 'none');
    document.getElementById('tab-new-order').style.display = 'none';
    switchTab('washer-mode');
  } else if (currentUser.role === 'packager') {
    ownerElements.forEach(el => el.style.display = 'none');
    document.querySelectorAll('.nav-dashboard, .nav-orders, .nav-new-order, .nav-courier, .nav-washer').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.courier-hidden-finance').forEach(el => el.style.display = 'none');
    document.getElementById('tab-new-order').style.display = 'none';
    switchTab('packager-mode');
  } else if (currentUser.role === 'admin') {
    ownerElements.forEach(el => el.style.display = 'none');
    document.querySelectorAll('.nav-washer').forEach(el => el.style.display = 'none');
    document.getElementById('tab-new-order').style.display = '';
    document.querySelectorAll('.nav-dashboard, .nav-orders, .nav-new-order, .nav-courier').forEach(el => el.style.display = 'flex');
    if (document.getElementById('courierActiveSelect')) document.getElementById('courierActiveSelect').disabled = false;
    switchTab('dashboard');
  } else {
    // Ega Admin
    ownerElements.forEach(el => el.style.display = 'flex');
    document.querySelectorAll('.nav-washer').forEach(el => el.style.display = 'none');
    document.getElementById('tab-new-order').style.display = '';
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
    'washer-mode': { title: "Yuvuvchi Ish Maydoni", sub: "Yuvishdan qadoqlashgacha va gilam o‘lchovlarini saqlash" },
    'packager-mode': { title: "Qadoqlovchi Ish Maydoni", sub: "Yuvilgan buyurtmalarni qadoqlab, dastavchikka topshiring" },
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
  if (tabId === 'washer-mode') renderWasherOrders();
  if (tabId === 'packager-mode') renderPackagerOrders();
  if (tabId === 'orders') loadOrders();
  if (tabId === 'reports') loadReceiptsList();
  if (tabId === 'telegram-config') {
    loadTgLogs();
    loadTelegramStatus();
    loadTelegramUsers();
  }
  if (tabId === 'sessions') loadActiveSessions();
  if (tabId === 'staff' && currentUser.role === 'owner') loadPayrollSummary();
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
      <td><span class="badge">${cat.unit === 'kv_m' ? 'Kvadrat metr (m²)' : cat.unit === 'kg' ? 'Kilogram (kg)' : 'Dona hisobi'}</span></td>
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
  const newPrice = prompt(`"${currentName}" xizmati uchun yangi 1 birlik narxini kiriting (so'm):`, currentPrice);
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
async function loadPayrollSummary(month = '') {
  const container = document.getElementById('payrollSummaryContainer');
  if (!container || currentUser?.role !== 'owner') return;
  const selectedMonth = month || document.getElementById('payrollMonth')?.value || '';
  const route = selectedMonth
    ? `/api/payroll/summary?month=${encodeURIComponent(selectedMonth)}`
    : '/api/payroll/summary';
  try {
    const response = await fetch(route);
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Oylik hisobini yuklab bo‘lmadi');
    const payroll = result.data;
    const monthInput = document.getElementById('payrollMonth');
    if (monthInput) monthInput.value = payroll.month;
    document.getElementById('payrollRateCourier').value = payroll.rates.courier;
    document.getElementById('payrollRateWasher').value = payroll.rates.washer;
    document.getElementById('payrollRatePackager').value = payroll.rates.packager;
    if (!payroll.workers.length) {
      container.innerHTML = '<p class="hint">Oylik hisoblash uchun faol dastavchik, yuvuvchi yoki qadoqlovchi topilmadi.</p>';
      return;
    }
    container.innerHTML = `
      <p class="hint">Shu oyda yetkazilgan buyurtmalar jami: <strong>${Number(payroll.order_revenue).toLocaleString()} so‘m</strong></p>
      <table class="table payroll-summary-table">
        <thead><tr>
          <th>Xodim</th><th>Lavozim / foiz</th><th>Hisoblangan oylik</th>
          <th>Avans va to‘lovlar</th><th>Qoldiq</th><th>To‘lov qaydi</th>
        </tr></thead>
        <tbody>${payroll.workers.map(worker => `
          <tr>
            <td><strong>${escapeHtml(worker.full_name)}</strong></td>
            <td>${escapeHtml(worker.role_label)} · ${Number(worker.rate)}%</td>
            <td>${Number(worker.earned_amount).toLocaleString()} so‘m</td>
            <td>${Number(worker.paid_amount).toLocaleString()} so‘m</td>
            <td><strong class="${worker.balance < 0 ? 'text-danger' : ''}">${Number(worker.balance).toLocaleString()} so‘m</strong></td>
            <td>
              <div class="payroll-payment-controls">
                <input type="number" id="payrollAmount-${Number(worker.id)}" min="1" max="1000000000000" step="1" placeholder="Summa" aria-label="${escapeHtml(worker.full_name)} uchun summa">
                <select id="payrollType-${Number(worker.id)}" aria-label="To‘lov turi">
                  <option value="advance">Avans</option><option value="salary">Oylik</option>
                </select>
                <input type="text" id="payrollDescription-${Number(worker.id)}" maxlength="300" placeholder="Izoh (ixtiyoriy)" aria-label="To‘lov izohi">
                <button class="btn btn-sm btn-primary" onclick="recordPayrollPayment(${Number(worker.id)})"><i class="fa-solid fa-money-bill-wave"></i> Qayd etish</button>
              </div>
            </td>
          </tr>
        `).join('')}</tbody>
      </table>
    `;
  } catch (error) {
    console.error('Oylik hisoboti xatosi:', error);
    container.innerHTML = `<p class="text-danger">${escapeHtml(error.message)}</p>`;
  }
}

async function savePayrollRates(event) {
  event.preventDefault();
  const rates = {
    courier: Number(document.getElementById('payrollRateCourier').value),
    washer: Number(document.getElementById('payrollRateWasher').value),
    packager: Number(document.getElementById('payrollRatePackager').value)
  };
  try {
    const response = await fetch('/api/payroll/rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rates })
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Foizlar saqlanmadi');
    showToast('Lavozimlar uchun oylik foizlari saqlandi');
    await loadPayrollSummary();
  } catch (error) {
    alert(error.message);
  }
}

async function recordPayrollPayment(userId) {
  const amountInput = document.getElementById(`payrollAmount-${Number(userId)}`);
  const typeInput = document.getElementById(`payrollType-${Number(userId)}`);
  const descriptionInput = document.getElementById(`payrollDescription-${Number(userId)}`);
  const amount = Number(amountInput?.value);
  if (!Number.isSafeInteger(amount) || amount < 1) {
    alert('To‘lov summasini butun so‘mda kiriting.');
    return;
  }
  try {
    const response = await fetch('/api/payroll/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: Number(userId),
        month: document.getElementById('payrollMonth').value,
        amount,
        payment_type: typeInput.value,
        description: descriptionInput.value.trim()
      })
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'To‘lov qayd etilmadi');
    showToast(result.message);
    await loadPayrollSummary(document.getElementById('payrollMonth').value);
  } catch (error) {
    alert(error.message);
  }
}

async function loadStaff() {
  try {
    const res = await fetch('/api/users');
    const json = await res.json();
    if (json.success) {
      const users = json.data;
      globalStaff = users;
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
    'courier': '<span class="status-pill status-yetkazilmoqda"><i class="fa-solid fa-truck-fast" aria-hidden="true"></i> Dastavchik</span>',
    'washer': '<span class="status-pill status-qadoqlayapti"><i class="fa-solid fa-soap" aria-hidden="true"></i> Yuvuvchi</span>',
    'packager': '<span class="status-pill status-qadoqlayapti"><i class="fa-solid fa-box-open" aria-hidden="true"></i> Qadoqlovchi</span>'
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
          : `<button class="btn btn-sm btn-outline" onclick="resetStaffPassword(${Number(u.id)})"><i class="fa-solid fa-key"></i> Yangi vaqtinchalik parol</button>`}
      </td>
      <td>
        ${Number(u.id) === currentUser.id || u.role === 'owner'
          ? '<small>O‘chirib bo‘lmaydi</small>'
          : `<button class="btn btn-sm btn-danger" onclick="deleteStaff(${Number(u.id)})"><i class="fa-solid fa-user-xmark"></i> O‘chirish</button>`}
      </td>
    </tr>
  `).join('');
}

async function deleteStaff(userId) {
  const user = globalStaff.find(staff => Number(staff.id) === Number(userId));
  if (!user) return;
  const confirmed = confirm(
    `${user.full_name} (${user.username}) xodimini butunlay o‘chirasizmi?\n\n` +
    'Uning tizimga kirishi va oylik/to‘lov tarixi ham o‘chadi. Bu amalni bekor qilib bo‘lmaydi.'
  );
  if (!confirmed) return;

  try {
    const response = await fetch(`/api/users/${Number(userId)}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Xodimni o‘chirib bo‘lmadi');
    showToast('Xodim va unga tegishli ma’lumotlar o‘chirildi');
    await loadStaff();
  } catch (error) {
    alert(error.message);
  }
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
      <div class="d-flex gap-2">
        ${currentUser?.role === 'admin'
          ? `<button class="btn btn-sm btn-outline" onclick="recordCourierPaymentFromAdmin(${Number(c.id)})" title="Dastavchikka berilgan pulni qayd etish"><i class="fa-solid fa-money-bill-wave"></i> Pul berish</button>`
          : ''}
        <a href="tel:${escapeHtml(c.phone)}" class="btn btn-sm btn-outline"><i class="fa-solid fa-phone"></i></a>
      </div>
    </div>
  `).join('');
}

async function recordCourierPaymentFromAdmin(courierId) {
  const courier = globalCouriers.find(item => Number(item.id) === Number(courierId));
  if (!courier || currentUser?.role !== 'admin') return;

  const amountInput = prompt(`${courier.full_name} dastavchikka berilgan summani so‘mda kiriting:`);
  if (amountInput === null) return;
  const amount = Number(amountInput.trim());
  if (!Number.isSafeInteger(amount) || amount < 1) {
    alert('Summani butun musbat so‘m miqdorida kiriting.');
    return;
  }
  const description = prompt('Izoh (ixtiyoriy):');
  if (description === null) return;

  try {
    const response = await fetch('/api/payroll/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: Number(courier.id),
        amount,
        payment_type: 'advance',
        description: description.trim()
      })
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Dastavchik to‘lovi qayd etilmadi');
    showToast(result.message || 'Dastavchik to‘lovi oyligidan ayrildi');
  } catch (error) {
    alert(error.message);
  }
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
    <td class="item-price-cell" style="width: 110px;">
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
  const isCourier = currentUser?.role === 'courier';

  if (defaultPrice) priceInput.value = defaultPrice;

  const shouldHideDimensions = isCourier || unit !== 'kv_m';
  lenInput.required = unit === 'kv_m' && !isCourier;
  widInput.required = unit === 'kv_m' && !isCourier;
  lenInput.disabled = shouldHideDimensions;
  widInput.disabled = shouldHideDimensions;
  row.querySelector('.item-price-cell').hidden = isCourier;
  row.querySelectorAll('.item-dimension-cell').forEach(cell => { cell.hidden = shouldHideDimensions; });

  if (shouldHideDimensions) {
    lenInput.value = '';
    widInput.value = '';
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

  if (currentUser?.role === 'courier') {
    metricSpan.innerText = '1 dona';
    if (unit === 'kg') metricSpan.innerText = 'Kg yuvishda kiritiladi';
    metricSpan.title = unit === 'kv_m'
      ? 'Gilam maydoni yuvuvchi tomonidan o‘lchanadi'
      : unit === 'kg' ? 'Parda og‘irligi yuvuvchi tomonidan kiritiladi' : '';
    subtotalEl.innerText = unit === 'kv_m' || unit === 'kg'
      ? 'Yuvilgach hisoblanadi'
      : `${Math.round(price).toLocaleString()} so‘m`;
    recalculateTotals();
    return;
  }

  let subtotal = 0;
  if (unit === 'kv_m') {
    const area = len * wid;
    metricSpan.innerText = `${area.toFixed(2)} m²`;
    subtotal = Math.round(area * price);
  } else if (unit === 'kg') {
    metricSpan.innerText = 'Kg yuvishda kiritiladi';
    subtotal = 0;
    subtotalEl.innerText = 'Yuvilgach hisoblanadi';
  } else {
    metricSpan.innerText = `1 dona`;
    subtotal = Math.round(price);
  }

  if (unit !== 'kg') subtotalEl.innerText = subtotal.toLocaleString() + " so'm";
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

    const len = currentUser.role === 'courier' ? 0 : parseFloat(r.querySelector('.item-len').value) || 0;
    const wid = currentUser.role === 'courier' ? 0 : parseFloat(r.querySelector('.item-wid').value) || 0;
    const price = parseFloat(r.querySelector('.item-price').value) || 0;

    sumItems += 1;
    if (unit === 'kv_m') {
      const area = len * wid;
      sumArea += area;
      sumPrice += area * price;
    } else if (unit === 'dona') {
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

async function loadMyPayroll() {
  const panelIds = {
    courier: 'courierPayrollPanel',
    washer: 'washerPayrollPanel',
    packager: 'packagerPayrollPanel'
  };
  const panel = document.getElementById(panelIds[currentUser?.role]);
  if (!panel) return;
  try {
    const response = await fetch('/api/payroll/me');
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Oylik ma’lumotlarini yuklab bo‘lmadi');
    const payroll = result.data;
    const payments = payroll.payments.length
      ? `<div class="table-responsive"><table class="table payroll-ledger-table">
          <thead><tr><th>Sana</th><th>Turi</th><th>Izoh</th><th>Berilgan</th></tr></thead>
          <tbody>${payroll.payments.map(payment => `
            <tr>
              <td>${escapeHtml(payment.created_at)}</td>
              <td>${payment.payment_type === 'advance' ? 'Avans' : 'Oylik to‘lovi'}</td>
              <td>${escapeHtml(payment.description || '-')}</td>
              <td><strong>${Number(payment.amount).toLocaleString()} so‘m</strong></td>
            </tr>
          `).join('')}</tbody>
        </table></div>`
      : '<p class="hint">Bu oy uchun avans yoki oylik to‘lovi qayd etilmagan.</p>';
    panel.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3><i class="fa-solid fa-wallet"></i> Oylik, kirim-chiqim (${escapeHtml(payroll.month)})</h3>
          <button class="btn btn-sm btn-outline" onclick="loadMyPayroll()"><i class="fa-solid fa-rotate"></i> Yangilash</button>
        </div>
        <div class="card-body">
          <div class="payroll-metrics">
            <div><span>Yetkazilgan buyurtmalar jami</span><strong>${Number(payroll.order_revenue).toLocaleString()} so‘m</strong></div>
            <div><span>Foiz (${Number(payroll.rate)}%) — hisoblangan daromad</span><strong>${Number(payroll.earned_amount).toLocaleString()} so‘m</strong></div>
            <div><span>Berilgan avans / oylik</span><strong class="text-danger">${Number(payroll.paid_amount).toLocaleString()} so‘m</strong></div>
            <div><span>Qolgan oylik</span><strong class="${payroll.balance < 0 ? 'text-danger' : 'text-success'}">${Number(payroll.balance).toLocaleString()} so‘m</strong></div>
          </div>
          ${currentUser.role === 'courier' ? `
            <form class="payroll-rates-form mt-3" onsubmit="recordCourierAdvance(event)">
              <label>Oy davomida olgan summangizni qayd eting (${escapeHtml(payroll.month)})
                <input type="number" name="amount" min="1" max="1000000000000" step="1" required placeholder="Masalan: 200000">
              </label>
              <label>Izoh (ixtiyoriy)
                <input type="text" name="description" maxlength="300" placeholder="Avans izohi">
              </label>
              <button class="btn btn-primary" type="submit"><i class="fa-solid fa-floppy-disk"></i> Olingan summani saqlash</button>
            </form>
          ` : ''}
          <h4 class="payroll-ledger-title">Kirim-chiqim tarixi</h4>
          ${payments}
        </div>
      </div>
    `;
  } catch (error) {
    console.error('Oylik ma’lumotlari xatosi:', error);
    panel.innerHTML = `<div class="card card-body text-danger">${escapeHtml(error.message)}</div>`;
  }
}

async function recordCourierAdvance(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('button[type="submit"]');
  const originalText = submitButton.innerHTML;
  const formData = new FormData(form);
  const amount = Number(formData.get('amount'));
  if (!Number.isSafeInteger(amount) || amount < 1) {
    alert('Olingan summani butun musbat so‘m miqdorida kiriting.');
    return;
  }

  submitButton.disabled = true;
  submitButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saqlanmoqda...';
  try {
    const response = await fetch('/api/payroll/me/advance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount,
        description: String(formData.get('description') || '').trim()
      })
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Avansni qayd etib bo‘lmadi');
    showToast(result.message || 'Olingan summa qayd etildi');
    await loadMyPayroll();
  } catch (error) {
    alert(error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = originalText;
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
      if (currentUser.role !== 'courier') loadReceiptsList();
    }
  } catch (err) {
    console.error("Orders error:", err);
  }
}

async function loadWasherOrders() {
  try {
    const response = await fetch('/api/washer/orders');
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Yuvish buyurtmalarini yuklab bo‘lmadi');
    globalWasherOrders = result.data;
    renderWasherOrders();
  } catch (error) {
    console.error('Washer orders error:', error);
  }
}

async function loadPackagerOrders() {
  try {
    const response = await fetch('/api/packager/orders');
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Qadoqlash buyurtmalarini yuklab bo‘lmadi');
    globalPackagerOrders = result.data;
    renderPackagerOrders();
  } catch (error) {
    console.error('Packager orders error:', error);
  }
}

function renderPackagerOrders() {
  const container = document.getElementById('packagerOrdersContainer');
  if (!container) return;
  if (!globalPackagerOrders.length) {
    container.innerHTML = `<div class="card p-4 text-center" style="grid-column: 1/-1; padding: 40px; color: var(--text-muted);">
      <i class="fa-solid fa-box-open" style="font-size: 40px; margin-bottom: 12px; color: #cbd5e1;"></i>
      <h3>Qadoqlash uchun buyurtma yo‘q</h3>
      <p>Yuvuvchi o‘lcham va narxlarni saqlagach buyurtma shu yerda ko‘rinadi.</p>
    </div>`;
    return;
  }
  container.innerHTML = globalPackagerOrders.map(order => {
    const items = (order.items || []).map(item => {
      const dimensions = item.unit === 'kg'
        ? `${Number(item.weight_kg).toFixed(2)} kg`
        : Number(item.area) > 0
          ? `${Number(item.length).toFixed(2)} × ${Number(item.width).toFixed(2)} m (${Number(item.area).toFixed(2)} m²)`
          : `${Number(item.quantity)} dona`;
      const defaultPrice = Number(item.admin_price);
      const measure = item.unit === 'kv_m' ? Number(item.area)
        : item.unit === 'kg' ? Number(item.weight_kg) : Number(item.quantity);
      const quantityLabel = item.unit === 'kv_m' ? 'm²' : item.unit === 'kg' ? 'kg' : 'dona';
      const priceControl = item.unit === 'kg'
        ? `<span>Admin narxi / kg: <strong>${defaultPrice.toLocaleString()} so‘m</strong></span>`
        : `<label>Narx / ${quantityLabel}
            <input type="number" min="0" max="1000000000" step="500"
              id="packager-price-${Number(item.id)}"
              data-quantity="${measure}"
              value="${Number.isFinite(defaultPrice) ? defaultPrice : 0}"
              oninput="previewPackagerOrderTotal(${Number(order.id)})">
          </label>`;
      return `<div class="washer-measurement-row packager-price-row">
        <div><strong>${escapeHtml(item.item_type)}</strong><br><small>${dimensions}${item.notes ? ` · ${escapeHtml(item.notes)}` : ''}</small></div>
        ${priceControl}
        <strong id="packager-subtotal-${Number(item.id)}">${Number(defaultPrice * measure).toLocaleString()} so‘m</strong>
      </div>`;
    }).join('');
    return `<article class="card washer-order-card">
      <div class="card-header">
        <h3>${escapeHtml(order.order_number)}</h3>
        <span class="status-pill status-qadoqlayapti">Qadoqlash navbatida</span>
      </div>
      <div class="card-body">
        <p><strong>Mijoz:</strong> ${escapeHtml(order.customer_name || '—')}</p>
        <p class="hint">Kilogramm tarifi administrator tomonidan belgilanadi. Boshqa buyumlar narxini kerak bo‘lsa shu yerda tahrirlash mumkin.</p>
        <div class="washer-items-list">${items || '<p>Buyumlar topilmadi</p>'}</div>
        <div class="packager-total">
          <div>Buyumlar jami: <strong id="packager-total-${Number(order.id)}">0 so‘m</strong></div>
          <div>Chegirma: <strong>${Number(order.discount || 0).toLocaleString()} so‘m</strong></div>
          <div>To‘lanadi: <strong id="packager-final-${Number(order.id)}">0 so‘m</strong></div>
          <small>Oldindan to‘langan: ${Number(order.paid_amount || 0).toLocaleString()} so‘m</small>
        </div>
        <div class="washer-order-actions">
          <button class="btn btn-success" onclick="markOrderPacked(${Number(order.id)})">
            <i class="fa-solid fa-box-open"></i> Qadoqlandi — dastavchikka berish
          </button>
        </div>
      </div>
    </article>`;
  }).join('');
  globalPackagerOrders.forEach(order => previewPackagerOrderTotal(order.id));
}

function previewPackagerOrderTotal(orderId) {
  const order = globalPackagerOrders.find(item => Number(item.id) === Number(orderId));
  if (!order) return;
  let total = 0;
  for (const item of order.items || []) {
    const input = document.getElementById(`packager-price-${Number(item.id)}`);
    const price = item.unit === 'kg' ? Number(item.admin_price) : Number(input?.value);
    const quantity = item.unit === 'kg'
      ? Number(item.weight_kg)
      : Number(input?.dataset.quantity);
    const subtotal = Math.round(price * quantity);
    if (Number.isFinite(price) && price >= 0 && Number.isFinite(quantity) && subtotal >= 0) {
      total += subtotal;
      const subtotalElement = document.getElementById(`packager-subtotal-${Number(item.id)}`);
      if (subtotalElement) subtotalElement.textContent = `${subtotal.toLocaleString()} so‘m`;
    }
  }
  const discount = Number(order.discount || 0);
  const totalElement = document.getElementById(`packager-total-${Number(order.id)}`);
  const finalElement = document.getElementById(`packager-final-${Number(order.id)}`);
  if (totalElement) totalElement.textContent = `${total.toLocaleString()} so‘m`;
  if (finalElement) finalElement.textContent = `${Math.max(0, total - discount).toLocaleString()} so‘m`;
}

async function markOrderPacked(orderId) {
  const order = globalPackagerOrders.find(item => Number(item.id) === Number(orderId));
  if (!order) return;
  const prices = order.items.map(item => ({
    id: Number(item.id),
    unit_price: item.unit === 'kg'
      ? Number(item.admin_price)
      : Number(document.getElementById(`packager-price-${Number(item.id)}`)?.value)
  }));
  if (prices.some(item => !Number.isFinite(item.unit_price) || item.unit_price < 0 || item.unit_price > 1000000000)) {
    alert('Har bir buyum uchun 0 dan 1 000 000 000 so‘mgacha narx kiriting.');
    return;
  }
  if (!confirm('Adminning kilogramm tarifi va boshqa kiritilgan narxlar bilan yakuniy summani saqlab, buyurtmani qadoqlangan deb belgilaysizmi?')) return;
  try {
    const response = await fetch(`/api/packager/orders/${orderId}/packed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prices })
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Buyurtmani qadoqlangan deb belgilab bo‘lmadi');
    showToast(result.message || 'Buyurtma barcha dastavchiklarning yetkazish ro‘yxatiga chiqarildi');
    if (result.telegram_warning) showToast(result.telegram_warning, 'info');
    await loadPackagerOrders();
  } catch (error) {
    alert(error.message);
  }
}

function renderWasherOrders() {
  const container = document.getElementById('washerOrdersContainer');
  if (!container) return;
  if (!globalWasherOrders.length) {
    container.innerHTML = `<div class="card p-4 text-center" style="grid-column: 1/-1; padding: 40px; color: var(--text-muted);">
      <i class="fa-solid fa-soap" style="font-size: 40px; margin-bottom: 12px; color: #cbd5e1;"></i>
      <h3>Yuvish uchun yangi buyurtma yo‘q</h3>
      <p>Sexga topshirilgan buyurtmalar shu yerda ko‘rinadi.</p>
    </div>`;
    return;
  }

  const stages = {
    qabul_qilindi: { label: 'Sexga qabul qilindi', next: 'yuvishda', nextLabel: 'Yuvishni boshlash', icon: 'fa-play' },
    yuvishda: { label: 'Yuvishda', next: 'quritishda', nextLabel: 'Quritishga o‘tkazish', icon: 'fa-fan' },
    quritishda: { label: 'Quritishda', next: 'olchayapti', nextLabel: 'O‘lcham va narx kiritish', icon: 'fa-ruler-combined' },
    olchayapti: { label: 'O‘lcham va narx kiritish', next: null, nextLabel: null, icon: 'fa-ruler-combined' }
  };
  container.innerHTML = globalWasherOrders.map(order => {
    const stage = stages[order.status];
    const itemsHtml = order.items.map(item => {
        const editable = order.status === 'olchayapti';
      if (item.unit === 'kv_m') {
        return `<div class="washer-measurement-row">
          <strong>${escapeHtml(item.item_type)}</strong>
          <label>Uzunligi (m)
              <input type="number" min="0.01" max="100" step="0.01" id="washer-length-${Number(item.id)}" value="${Number(item.length) || ''}" ${editable ? '' : 'disabled'} oninput="previewWasherOrderTotal(${Number(order.id)})">
          </label>
          <label>Eni (m)
              <input type="number" min="0.01" max="100" step="0.01" id="washer-width-${Number(item.id)}" value="${Number(item.width) || ''}" ${editable ? '' : 'disabled'} oninput="previewWasherOrderTotal(${Number(order.id)})">
          </label>
            <label>Narx / m²
              <input type="number" min="0" max="1000000000" step="500" id="washer-price-${Number(item.id)}" value="${Number(item.unit_price)}" ${editable ? '' : 'disabled'} oninput="previewWasherOrderTotal(${Number(order.id)})">
            </label>
            <span>${Number(item.quantity)} dona${item.notes ? ` · ${escapeHtml(item.notes)}` : ''}</span>
          </div>`;
        }
        if (item.unit === 'kg') {
          return `<div class="washer-measurement-row">
            <strong>${escapeHtml(item.item_type)}</strong>
            <label>Og‘irligi (kg)
              <input type="number" min="0.01" max="100000" step="0.01" id="washer-weight-${Number(item.id)}" value="${Number(item.weight_kg) || ''}" ${editable ? '' : 'disabled'} oninput="previewWasherOrderTotal(${Number(order.id)})">
            </label>
            <span>Admin narxi / kg: <strong>${Number(item.admin_price).toLocaleString()} so‘m</strong></span>
            <span>${Number(item.quantity)} dona${item.notes ? ` · ${escapeHtml(item.notes)}` : ''}</span>
          </div>`;
        }
        return `<div class="washer-measurement-row">
          <strong>${escapeHtml(item.item_type)}</strong>
          <label>Narx / dona
            <input type="number" min="0" max="1000000000" step="500" id="washer-price-${Number(item.id)}" value="${Number(item.unit_price)}" ${editable ? '' : 'disabled'} oninput="previewWasherOrderTotal(${Number(order.id)})">
          </label>
          <span>${Number(item.quantity)} dona${item.notes ? ` · ${escapeHtml(item.notes)}` : ''}</span>
        </div>`;
    }).join('');
    const action = stage.next
      ? `<button class="btn btn-primary" onclick="advanceWasherOrder(${Number(order.id)}, '${stage.next}')"><i class="fa-solid ${stage.icon}"></i> ${stage.nextLabel}</button>`
      : `<button class="btn btn-success" onclick="saveWasherMeasurements(${Number(order.id)})"><i class="fa-solid fa-floppy-disk"></i> Saqlash va qadoqlovchiga topshirish</button>`;
    return `<article class="card washer-order-card">
      <div class="card-header">
        <h3>${escapeHtml(order.order_number)}</h3>
        <span class="status-pill status-${order.status}">${stage.label}</span>
      </div>
      <div class="card-body">
        <div class="washer-items-list">${itemsHtml || '<p class="hint">Buyumlar topilmadi</p>'}</div>
        ${order.status === 'olchayapti' ? '<p class="hint">O‘lcham va narxni saqlaganingizda buyurtma qadoqlovchiga o‘tadi. Dastavchik faqat qadoqlovchi tasdiqlagandan so‘ng uni ko‘radi.</p><strong id="washer-total-preview-' + Number(order.id) + '">Jami: hisoblanmoqda</strong>' : ''}
        <div class="washer-order-actions">${action}</div>
      </div>
    </article>`;
  }).join('');
  globalWasherOrders.filter(order => order.status === 'olchayapti')
    .forEach(order => previewWasherOrderTotal(order.id));
}

async function advanceWasherOrder(orderId, status) {
  try {
    const response = await fetch(`/api/washer/orders/${orderId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Jarayon bosqichi saqlanmadi');
    showToast('Buyurtma keyingi bosqichga o‘tkazildi');
    await loadWasherOrders();
  } catch (error) {
    alert(error.message);
  }
}

async function saveWasherMeasurements(orderId) {
  const order = globalWasherOrders.find(item => Number(item.id) === Number(orderId));
  if (!order) return;
  const measurements = order.items.map(item => ({
    id: Number(item.id),
    length: item.unit === 'kv_m' ? Number(document.getElementById(`washer-length-${Number(item.id)}`).value) : 0,
    width: item.unit === 'kv_m' ? Number(document.getElementById(`washer-width-${Number(item.id)}`).value) : 0,
    weight_kg: item.unit === 'kg' ? Number(document.getElementById(`washer-weight-${Number(item.id)}`).value) : 0,
    unit_price: item.unit === 'kg'
      ? Number(item.admin_price)
      : Number(document.getElementById(`washer-price-${Number(item.id)}`).value)
  }));
  if (measurements.some(item => !Number.isFinite(item.length) || !Number.isFinite(item.width) ||
      !Number.isFinite(item.weight_kg) ||
      !Number.isFinite(item.unit_price) || item.unit_price < 0 ||
      (item.length === 0) !== (item.width === 0) ||
      order.items.find(source => Number(source.id) === item.id)?.unit === 'kv_m' && (item.length <= 0 || item.width <= 0) ||
      order.items.find(source => Number(source.id) === item.id)?.unit === 'kg' && (item.weight_kg <= 0 || item.weight_kg > 100000))) {
    alert('Gilam o‘lchami, parda og‘irligi va barcha buyumlar narxini tekshiring.');
    return;
  }
  try {
    const response = await fetch(`/api/washer/orders/${orderId}/measurements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ measurements })
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'O‘lchamlarni saqlab bo‘lmadi');
    showToast(`O‘lcham va narxlar saqlandi: ${Number(result.total_area).toFixed(2)} m², ${Number(result.total_weight_kg).toFixed(2)} kg, ${Number(result.total_amount).toLocaleString()} so‘m.`);
    await loadWasherOrders();
  } catch (error) {
    alert(error.message);
  }

}

function previewWasherOrderTotal(orderId) {
  const order = globalWasherOrders.find(item => Number(item.id) === Number(orderId));
  const preview = document.getElementById(`washer-total-preview-${Number(orderId)}`);
  if (!order || !preview) return;
  let areaTotal = 0;
  let weightTotal = 0;
  let amountTotal = 0;
  for (const item of order.items) {
    const unitPrice = item.unit === 'kg'
      ? Number(item.admin_price)
      : Number(document.getElementById(`washer-price-${Number(item.id)}`).value) || 0;
    if (item.unit === 'kv_m') {
      const length = Number(document.getElementById(`washer-length-${Number(item.id)}`).value) || 0;
      const width = Number(document.getElementById(`washer-width-${Number(item.id)}`).value) || 0;
      const area = Math.round(length * width * Number(item.quantity || 1) * 100) / 100;
      areaTotal += area;
      amountTotal += Math.round(unitPrice * area);
    } else if (item.unit === 'kg') {
      const weight = Number(document.getElementById(`washer-weight-${Number(item.id)}`).value) || 0;
      weightTotal += weight;
      amountTotal += Math.round(unitPrice * weight);
    } else {
      amountTotal += Math.round(unitPrice * Number(item.quantity || 1));
    }
  }
  preview.textContent = `Jami: ${areaTotal.toFixed(2)} m² · ${weightTotal.toFixed(2)} kg · ${Math.round(amountTotal).toLocaleString()} so‘m`;
}

async function loadOwnerNotifications() {
  if (currentUser?.role !== 'owner') return;
  try {
    const response = await fetch('/api/owner-notifications');
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Bildirishnomalarni yuklab bo‘lmadi');
    const notifications = result.data || [];
    const unread = notifications.filter(item => !item.is_read);
    const newestId = notifications.reduce((latest, item) => Math.max(latest, Number(item.id)), 0);
    document.getElementById('ownerNotificationCount').textContent = `${unread.length} ta yangi`;
    const container = document.getElementById('ownerNotificationsList');
    container.innerHTML = notifications.length
      ? notifications.map(item => `<div class="owner-notification ${item.is_read ? 'is-read' : ''}">
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.message)}</p>
          <small>${escapeHtml(item.created_at)}</small>
          <button class="btn btn-sm btn-outline" onclick="viewOrderDetails(${Number(item.order_id)})">Buyurtmani ko‘rish</button>
        </div>`).join('')
      : '<p class="hint">Hozircha sexdan olingan buyurtmalar haqida xabar yo‘q.</p>';
    if (ownerNotificationInitialized && newestId > latestOwnerNotificationId) {
      const newest = notifications.find(item => Number(item.id) === newestId);
      if (newest) showToast(newest.title, 'info');
    }
    ownerNotificationInitialized = true;
    latestOwnerNotificationId = Math.max(latestOwnerNotificationId, newestId);
  } catch (error) {
    console.error('Owner notifications error:', error);
  }
}

async function markOwnerNotificationsRead() {
  try {
    const response = await fetch('/api/owner-notifications/read', { method: 'POST' });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Bildirishnomalar yangilanmadi');
    await loadOwnerNotifications();
  } catch (error) {
    alert(error.message);
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
    'olchayapti': { label: 'O‘lcham kiritilmoqda', icon: 'fa-ruler-combined', cls: 'status-olchayapti' },
    'qadoqlayapti': { label: 'Qadoqlayapti', icon: 'fa-box', cls: 'status-qadoqlayapti' },
    'qadoqlandi': { label: 'Qadoqlandi — yetkazishga tayyor', icon: 'fa-box-open', cls: 'status-tayyor' },
    'tayyor': { label: 'Tayyor (Qadoqlangan)', icon: 'fa-box-open', cls: 'status-tayyor' },
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
      const dim = i.unit === 'kg'
        ? `(${Number(i.weight_kg || 0).toFixed(2)} kg)`
        : (i.length && i.width) ? `(${i.length}x${i.width}m)` : `(${i.quantity} dona)`;
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
          <strong>${ord.total_area ? ord.total_area.toFixed(1) : 0} m²${ord.total_weight_kg ? ` · ${Number(ord.total_weight_kg).toFixed(1)} kg` : ''}</strong>
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
      <td><b>${ord.total_area ? ord.total_area.toFixed(1) : 0} m²${ord.total_weight_kg ? ` · ${Number(ord.total_weight_kg).toFixed(1)} kg` : ''}</b> (${ord.total_items} ta)</td>
      <td><strong>${ord.final_amount.toLocaleString()} so'm</strong></td>
      <td>${getStatusPill(ord.status)}</td>
      <td>
        <button class="btn btn-sm btn-primary" title="Yetkazib berish ma'lumotlari" onclick="viewOrderDetails(${Number(ord.id)})">
          <i class="fa-solid fa-truck"></i> Yetkazib berish
        </button>
      </td>
    </tr>
  `).join('');
}

// ================= DASTAVCHIK ISH MAYDONI =================
function renderCourierDeliveries() {
  const container = document.getElementById('courierOrdersContainer');
  if (!container) return;

  const courierFilter = document.getElementById('courierActiveSelect') ? document.getElementById('courierActiveSelect').value : 'all';

  const matchingOrders = globalOrders.filter(o => {
    if (currentUser.role !== 'courier' && courierFilter !== 'all') {
      return String(o.courier_pickup_id) === courierFilter || String(o.courier_delivery_id) === courierFilter;
    }
    return true;
  });
  const orders = currentUser.role === 'courier'
    ? matchingOrders
      .filter(order => !['yetkazildi', 'bekor_qilindi'].includes(order.status))
      .sort((left, right) => {
        const leftDeliveryReady = Number(left.courier_delivery_id) === Number(currentUser.id) &&
          ['qadoqlandi', 'tayyor', 'yetkazilmoqda'].includes(left.status);
        const rightDeliveryReady = Number(right.courier_delivery_id) === Number(currentUser.id) &&
          ['qadoqlandi', 'tayyor', 'yetkazilmoqda'].includes(right.status);
        return Number(rightDeliveryReady) - Number(leftDeliveryReady) || right.id - left.id;
      })
    : matchingOrders;

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
    if (['qadoqlandi', 'tayyor'].includes(ord.status)) borderClass = 'border-left-ready';
    const canManageDelivery = currentUser.role !== 'courier' ||
      ['qadoqlandi', 'tayyor'].includes(ord.status) ||
      Number(ord.courier_delivery_id) === Number(currentUser.id);
    let deliveryAction = '';
    if (currentUser.role === 'courier' &&
        Number(ord.courier_pickup_id) === Number(currentUser.id) &&
        ord.status === 'yangi') {
      deliveryAction = `
        <button class="btn btn-primary" style="flex: 1.2;" onclick="quickUpdateStatus(${Number(ord.id)}, 'qabul_qilindi')">
          <i class="fa-solid fa-warehouse"></i> Sexga topshirdim
        </button>
      `;
    } else if (canManageDelivery && ['qadoqlandi', 'tayyor'].includes(ord.status)) {
      const deliveryClick = currentUser.role === 'courier'
        ? `quickUpdateStatus(${Number(ord.id)}, 'yetkazilmoqda')`
        : `viewOrderDetails(${Number(ord.id)})`;
      deliveryAction = `
        <button class="btn btn-primary" style="flex: 1.2;" onclick="${deliveryClick}">
          <i class="fa-solid fa-truck"></i> Yetkazib berish
        </button>
      `;
    } else if (canManageDelivery && ord.status === 'yetkazilmoqda') {
      deliveryAction = `
        <button class="btn btn-success" style="flex: 1.2;" onclick="${currentUser.role === 'courier'
          ? `quickUpdateStatus(${Number(ord.id)}, 'yetkazildi', ${Number(ord.final_amount)})`
          : `viewOrderDetails(${Number(ord.id)})`}">
          <i class="fa-solid ${currentUser.role === 'courier' ? 'fa-circle-check' : 'fa-circle-info'}"></i>
          ${currentUser.role === 'courier' ? 'Yetkazildi va to‘lov olindi' : 'Yetkazish tafsilotlari'}
        </button>
      `;
    }
    const itemsListHtml = (ord.items || []).map(i => {
      const measure = i.unit === 'kg'
        ? `${Number(i.weight_kg || 0).toFixed(2)} kg`
        : (i.length && i.width) ? `${i.length}x${i.width}m (${i.area}m²)` : `${i.quantity} dona`;
      return `<li>• <strong>${escapeHtml(i.item_type)}</strong>: ${measure} ${i.notes ? `<i class="text-muted">(${escapeHtml(i.notes)})</i>` : ''}</li>`;
    }).join('');

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
          <div style="font-weight: 600; margin-bottom: 4px;">Yuklar (${ord.total_items} ta, ${ord.total_area ? ord.total_area.toFixed(1) : 0} m²${ord.total_weight_kg ? ` · ${Number(ord.total_weight_kg).toFixed(1)} kg` : ''}):</div>
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
    showToast(newStatus === 'yetkazildi'
      ? 'Buyurtma yetkazildi va to‘lov qayd etildi'
      : 'Buyurtma holati yangilandi');
    if (json.notification_warning) showToast(json.notification_warning, 'info');
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
    if (!res.ok || !json.success) throw new Error(json.error || 'Buyurtma ma’lumotlarini yuklab bo‘lmadi');

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
        <td>${i.unit === 'kg' ? '-' : (i.length && i.width) ? `${i.length} × ${i.width} m` : '-'}</td>
        <td>${i.unit === 'kg' ? `${Number(i.weight_kg).toFixed(2)} kg` : i.area > 0 ? `${i.area} m²` : `${i.quantity} dona`}</td>
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

    const contactPhones = [ord.customer_phone, ord.phone2].filter(Boolean);
    const customerPhoneLinks = contactPhones.length
      ? contactPhones.map((phone, index) => `
          <a href="tel:${escapeHtml(phone)}" class="order-detail-phone">${index === 1 ? 'Qo‘shimcha: ' : ''}${escapeHtml(phone)}</a>
        `).join('<br>')
      : '-';
    const extraNotes = [
      ord.courier_notes ? `<div><strong>Kuryer / yetkazish izohi:</strong> ${escapeHtml(ord.courier_notes)}</div>` : '',
      currentUser?.role !== 'courier' && ord.admin_notes
        ? `<div><strong>Ichki izoh:</strong> ${escapeHtml(ord.admin_notes)}</div>`
        : ''
    ].filter(Boolean).join('');

    const bodyHtml = `
      <section class="order-delivery-summary">
        <div class="order-delivery-ids">
          <span><small>Buyurtma ID</small><strong>#${Number(ord.id)}</strong></span>
          <span><small>Buyurtma raqami</small><strong>${escapeHtml(ord.order_number || '-')}</strong></span>
          <span><small>Mijoz ID</small><strong>#${escapeHtml(ord.customer_id ?? '-')}</strong></span>
        </div>
        <div class="order-delivery-grid">
          <div class="order-delivery-field">
            <small>Qabul qiluvchi</small>
            <strong>${escapeHtml(ord.customer_name || '-')}</strong>
          </div>
          <div class="order-delivery-field">
            <small>Telefon raqami</small>
            <div>${customerPhoneLinks}</div>
          </div>
          <div class="order-delivery-field">
            <small>Gilam olingan sana</small>
            <strong>${escapeHtml(ord.pickup_date || ord.created_at || '-')}</strong>
          </div>
          <div class="order-delivery-field">
            <small>Yetkazish muddati</small>
            <strong>${escapeHtml(ord.target_delivery_date || '-')}</strong>
          </div>
          <div class="order-delivery-field order-delivery-field-wide">
            <small>Yetkazish manzili</small>
            <strong>${escapeHtml(ord.customer_address || '-')}</strong>
            ${ord.landmark ? `<span>Mo‘ljal: ${escapeHtml(ord.landmark)}</span>` : ''}
            ${navSection}
          </div>
          <div class="order-delivery-field">
            <small>Yetkazuvchi</small>
            <strong>${escapeHtml(ord.courier_deliv_name || 'Biriktirilmagan')}</strong>
            ${ord.courier_deliv_phone ? `<a href="tel:${escapeHtml(ord.courier_deliv_phone)}">${escapeHtml(ord.courier_deliv_phone)}</a>` : ''}
          </div>
          <div class="order-delivery-field">
            <small>Buyurtma holati</small>
            ${getStatusPill(ord.status)}
          </div>
          <div class="order-delivery-field order-delivery-field-wide">
            <small>Qo‘shimcha izoh</small>
            ${extraNotes || '<span>Izoh yo‘q</span>'}
            ${ord.defect_tags ? `<span class="text-danger">Buyumdagi belgi: ${escapeHtml(ord.defect_tags)}</span>` : ''}
          </div>
        </div>
      </section>
      <div style="display: flex; flex-wrap: wrap; gap: 12px 24px; margin-bottom: 18px;">
        <span><strong>Yetkazilgan sana:</strong> ${escapeHtml(ord.delivered_date || '-')}</span>
        <span><strong>Jami maydon:</strong> ${ord.total_area ? ord.total_area.toFixed(2) : 0} m² (${ord.total_items} ta buyum)</span>
        <span><strong>To‘lov turi:</strong> ${escapeHtml(ord.payment_method || '-')}</span>
        <span><strong>To‘lov holati:</strong> ${escapeHtml(ord.payment_status || '-')}</span>
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

      ${currentUser?.role !== 'courier' ? `<hr style="margin-bottom: 16px; border: none; border-top: 1px solid var(--border-color);">

      <h4>Boshqarish va Holatni o'zgartirish:</h4>
      <div class="form-row mt-2">
        <div class="form-group col-6">
          <label>Holatini yangilash:</label>
          <select id="modalUpdateStatus">
            <option value="yangi" ${ord.status === 'yangi' ? 'selected' : ''}>🆕 Yangi tushgan</option>
            <option value="qabul_qilindi" ${ord.status === 'qabul_qilindi' ? 'selected' : ''}>Qabul qilindi (Kuryer oldi)</option>
            <option value="yuvishda" ${ord.status === 'yuvishda' ? 'selected' : ''}>Yuvish jarayonida</option>
            <option value="quritishda" ${ord.status === 'quritishda' ? 'selected' : ''}>Quritish kamerasida</option>
            <option value="olchayapti" ${ord.status === 'olchayapti' ? 'selected' : ''}>Gilam o‘lchanmoqda</option>
            <option value="qadoqlayapti" ${ord.status === 'qadoqlayapti' ? 'selected' : ''}>Qadoqlayapti</option>
            <option value="qadoqlandi" ${ord.status === 'qadoqlandi' ? 'selected' : ''}>Qadoqlandi (Yetkazishga tayyor)</option>
            <option value="tayyor" ${ord.status === 'tayyor' ? 'selected' : ''}>Tayyor (Qadoqlangan)</option>
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
      ` : ''}
    `;

    document.getElementById('modalOrderBody').innerHTML = bodyHtml;

    const courierDeliveryActions = currentUser?.role === 'courier' &&
      (['qadoqlandi', 'tayyor'].includes(ord.status) ||
       Number(ord.courier_delivery_id) === Number(currentUser.id))
      ? ['tayyor', 'qadoqlandi'].includes(ord.status)
        ? `<button class="btn btn-primary" onclick="updateDeliveryFromDetails(${Number(ord.id)}, 'yetkazilmoqda')"><i class="fa-solid fa-truck"></i> Yetkazishga chiqish</button>`
        : ord.status === 'yetkazilmoqda'
          ? `<button class="btn btn-success" onclick="updateDeliveryFromDetails(${Number(ord.id)}, 'yetkazildi', ${Number(ord.final_amount)})"><i class="fa-solid fa-check"></i> Yetkazildi va to‘lov olindi</button>`
          : ''
      : '';
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
      ${courierDeliveryActions}
      ${currentUser?.role !== 'courier' ? `<button class="btn btn-primary" onclick="saveOrderDetailsChanges(${Number(ord.id)})">
        <i class="fa-solid fa-floppy-disk"></i> O'zgarishlarni Saqlash
      </button>` : ''}
    `;

    document.getElementById('orderModal').classList.add('show');
  } catch (err) {
    console.error(err);
    alert(err.message || 'Buyurtma tafsilotlarini yuklab bo‘lmadi');
  }
}

async function updateDeliveryFromDetails(orderId, status, autoPayAmount = null) {
  closeOrderModal();
  await quickUpdateStatus(orderId, status, autoPayAmount);
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

async function persistTelegramSettings() {
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

  const result = await res.json();
  if (!res.ok || !result.success) throw new Error(result.error || 'Sozlamalarni saqlashda xatolik yuz berdi');
}

async function saveTgSettings(event) {
  event.preventDefault();
  try {
    await persistTelegramSettings();
    showToast('Telegram sozlamalari saqlandi');
    await loadTelegramStatus();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function setupTelegramWebhook() {
  try {
    await persistTelegramSettings();
    const response = await fetch('/api/telegram/setup', { method: 'POST' });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Telegram botni ulab bo‘lmadi');
    showToast('Sozlamalar saqlandi, bot ulandi. Endi Telegramda botga /start yuboring.');
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
      ${status.bot?.username ? `<p><a href="https://t.me/${encodeURIComponent(status.bot.username)}" target="_blank" rel="noopener noreferrer">Telegramda @${escapeHtml(status.bot.username)} botini ochish</a></p>` : ''}
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
      ${escapeHtml(c.name)} (${Number(c.price_per_unit).toLocaleString()} so'm / ${c.unit === 'kv_m' ? 'm²' : c.unit === 'kg' ? 'kg' : 'dona'})
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
  const singleAreaLabel = document.getElementById('quickCalcSingleLabel');
  const totalMeasureLabel = document.getElementById('quickCalcTotalLabel');
  const quantityLabel = document.getElementById('quickCalcQuantityLabel');
  const unitPriceLabel = document.getElementById('quickResUnitPriceLabel');
  const isAreaBased = unit === 'kv_m';
  const isWeightBased = unit === 'kg';
  if (dimensions) dimensions.hidden = !isAreaBased;
  if (presets) presets.hidden = !isAreaBased;
  if (singleAreaRow) singleAreaRow.hidden = !isAreaBased;
  if (singleAreaLabel) singleAreaLabel.textContent = isAreaBased
    ? '1 ta gilam maydoni:'
    : isWeightBased ? 'Og‘irligi:' : 'Buyum soni:';
  if (totalMeasureLabel) totalMeasureLabel.textContent = isAreaBased
    ? 'Jami maydon:'
    : isWeightBased ? 'Jami og‘irlik:' : 'Jami buyumlar:';
  if (quantityLabel) quantityLabel.textContent = isAreaBased ? 'Gilamlar soni' : isWeightBased ? 'Og‘irligi (kg)' : 'Buyumlar soni';
  if (unitPriceLabel) unitPriceLabel.textContent = isAreaBased ? '1 m² uchun admin narxi:' : isWeightBased ? '1 kg uchun admin narxi:' : '1 dona uchun admin narxi:';
  const quantityInput = document.getElementById('quickCalcQty');
  if (quantityInput) {
    quantityInput.min = isWeightBased ? '0.01' : '1';
    quantityInput.step = isWeightBased ? '0.01' : '1';
  }

  const len = parseFloat(document.getElementById('quickCalcLen').value) || 0;
  const wid = parseFloat(document.getElementById('quickCalcWid').value) || 0;
  const qty = isWeightBased
    ? parseFloat(document.getElementById('quickCalcQty').value) || 0
    : parseInt(document.getElementById('quickCalcQty').value) || 1;

  let singleArea = 0;
  let totalArea = 0;
  let total = 0;

  if (isAreaBased) {
    singleArea = parseFloat((len * wid).toFixed(2));
    totalArea = parseFloat((singleArea * qty).toFixed(2));
    total = Math.round(totalArea * price);

    document.getElementById('quickResSingleArea').innerText = `${len} × ${wid} = ${singleArea} m²`;
    document.getElementById('quickResArea').innerText = `${totalArea} m² (${qty} dona)`;
  } else if (isWeightBased) {
    document.getElementById('quickResSingleArea').innerText = `${qty} kg`;
    document.getElementById('quickResArea').innerText = `${qty} kg`;
    total = Math.round(qty * price);
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
