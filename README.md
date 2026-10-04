# 🧼 TOZA GILAM - Professional Gilam Yuvish va Dastavka Boshqaruv Tizimi (ERP)

Mazkur tizim professional gilam yuvish korxonalari uchun maxsus ishlab chiqilgan bo'lib, buyurtmalarni qabul qilishdan boshlab yuvish, quritish, qadoqlash hamda dastavchiklar (kuryerlar) orqali mijozga yetkazib berishgacha bo'lgan barcha jarayonlarni to'liq avtomatlashtiradi.

---

## 🚀 Asosiy Imkoniyatlar va Tuzilishi

### 1. 👥 Ko'p Rollik Boshqaruv Tizimi (RBAC)
- **👑 Ega Admin (Owner):**
  - Korxonaning barcha moliyaviy hisobotlari, tushumlar, qarzdorliklar va kassa holatini to'liq ko'rish.
  - Xizmatlar narxlarini (gilam, adyol, parda, gilamcha) o'zgartirish va yangi kategoriyalar qo'shish.
  - Xodimlar (operatorlar va haydovchi-kuryerlar) ro'yxatini boshqarish.
  - Telegram bot va guruh sozlamalarini nazorat qilish.
- **💼 Admin / Operator:**
  - Mijozlardan yangi buyurtmalarni qabul qilish.
  - Gilam o'lchamlarini (uzunligi, eni, m² hisobi) va adyol/gilamchalarni donalab kiritish.
  - Buyurtmalarni kuryerlarga biriktirish va buyurtma holatini nazorat qilish.
- **🚚 Dastavchik (Kuryer):**
  - Mijozdan olgan gilam, to'shak va boshqa buyumlar uchun yangi buyurtmani o'zi kiritish.
  - Olingan buyurtmani sexga topshirganini tasdiqlash.
  - O'ziga biriktirilgan tayyor buyurtmalarni yetkazish ro'yxatida ko'rish.
  - Mijoz telefoniga 1 tugma bilan qo'ng'iroq qilish, manzil va mo'ljalni ko'rish.
  - Holatni tezkor o'zgartirish (*"Yetkazishga chiqdim"*, *"Yetkazdim va pulni oldim"*).

---

### 2. 🧺 Gilam, Adyol va Gilamchalar Kalkulyatori
- **Gilamlar:** Uzunligi (m) va eni (m) bo'yicha kvadrat metr ($m^2$) avtomatik hisoblanadi.
- **Adyol va Yorganlar:** 1 kishilik yoki 2 kishilik dona hisobida tozalash.
- **Gilamchalar va Yo'lakchalar:** Kichik o'lchamlar uchun maxsus dona yoki metr hisobidagi tariflar.
- Har bir buyum uchun **dog'i, yirtig'i yoki alohida belgilari** qayd etiladi.

---

### 3. 📊 Excel va Word Formatida Hisobotlar
- **Microsoft Excel (.xlsx):**
  - *1-varaq:* Barcha buyurtmalar, mijozlar, to'lovlar, qoldiq qarzlar va kuryerlar ro'yxati.
  - *2-varaq:* Har bir gilam va adyolning o'lchamlari ($m^2$, uzunlik, eni, narxi) kesimidagi batafsil ro'yxat.
  - *3-varaq:* Kassa kirim va chiqimlari (kimyoviy vositalar, yoqilg'i, oyliklar).
- **Microsoft Word (.docx):**
  - Har bir buyurtma uchun mijozga beriladigan rasmiy **Kvitansiya va Chek**.
  - Korxona rahbariyati uchun **Davriy Jamlama Hisobot**.

---

### 4. ✈️ Telegram Bot va Guruh Integratsiyasi
- Admin panel aytgan guruh yoki kanalga har bir buyurtma haqida to'liq hisobot tashlab turiladi:
  - Har bir buyurtma va uning holat xabarlari bir xil ketma-ket raqamni oladi (`#1`, `#2`, `#3`); mavjud GLM buyurtma kodi ham saqlanadi.
  - Buyurtma kodi va yangi holati (🆕 Yangi $\to$ 🧼 Yuvishda $\to$ ☀️ Quritishda $\to$ ✨ Tayyor $\to$ 🚚 Yetkazilmoqda $\to$ ✅ Yetkazildi);
  - Mijoz ismi, telefon raqami, yetkazish manzili va mo'ljali;
  - Qabul qilingan gilam va adyollarning o'lchamlari va soni;
  - Umumiy summa, to'langan mablag' va olinishi kerak bo'lgan qoldiq;
  - Biriktirilgan dastavchik ismi va telefon raqami.

---

## 🛠️ O'rnatish va Ishga Tushirish

```bash
npm install
npm start
```

Mahalliy server `https://localhost:3000` manzilida ishga tushadi. `npm test` avtomatlashtirilgan tekshiruvlarni bajaradi. Mahalliy ishlab chiqishda SQLite ishlatiladi; Vercel’da esa doimiy PostgreSQL ma’lumotlar bazasi majburiy.
Eski ishga tushirish odati uchun `python server.py` ham HTTPS himoyali Node.js serverini ishga tushiradi; mustaqil, eski Python API endi so'rov qabul qilmaydi.

### HTTPS va mahalliy sertifikat

Birinchi ishga tushishda localhost uchun bir yillik o'z-o'zini imzolagan HTTPS sertifikati avtomatik yaratiladi va `%USERPROFILE%\.toza-gilam\localhost-cert.pem` hamda `localhost-key.pem` fayllarida saqlanadi. Brauzer sertifikatni tanimagani sababli mahalliy sahifada ogohlantirish ko'rsatishi mumkin; faqat o'zingizning ushbu kompyuteringizda ochayotgan `https://localhost:3000` sahifasi uchun sertifikatni tekshirib davom eting. Tashqi serverga mo'ljallangan ishonchli sertifikat uchun `TLS_CERT_PATH` va `TLS_KEY_PATH` muhit o'zgaruvchilarini ikkalasini ham belgilang.

### Birinchi ishga tushirish

Bo'sh ishlab chiqarish bazasida egasining akkaunti yaratiladi; bo'sh mahalliy bazada login va tasodifiy vaqtinchalik parol konsolda ko'rsatiladi. Sinov muhiti alohida sinov foydalanuvchilarini yaratadi. Parollarni xavfsiz joyda saqlang; ular manba kodiga yozilmaydi. Eski standart parollar topilsa, tasodifiy parolga almashtiriladi.

Xodim qo'shishda kamida 8 belgili alohida parol kiriting. Parollar bazada scrypt bilan xeshlangan holda saqlanadi. Kirish sessiyasi `HttpOnly` va `SameSite=Strict` cookie orqali yuritiladi; parol va sessiya identifikatori JavaScript kira oladigan `localStorage`da saqlanmaydi. Har bir foydalanuvchi profil yonidagi kalit tugmasi orqali o'z parolini almashtira oladi.

### Rollar va ma'lumotlar xavfsizligi

- Egasi moliyaviy hisobotlar, xodimlar, xizmat tariflari, Telegram sozlamalari va barcha buyurtmalarni boshqaradi.
- Operator buyurtmalarni ko'radi va boshqaradi, lekin moliyaviy hisobot yoki egaga tegishli sozlamalarga kira olmaydi.
- Kuryer yangi buyurtma kirita oladi; tizim uni avtomatik o'sha kuryerga biriktiradi. Kuryer buyurtmani faqat "Yangi"dan "Qabul qilindi"ga, ya'ni sexga topshirilganga o'tkazishi mumkin. Chegirma va oldindan to'lovni kuryer belgilay olmaydi.
- Kuryer faqat o'ziga biriktirilgan buyurtmalarni ko'radi; tayyor buyurtmani yetkazish holatiga o'tkazadi va to'liq to'lov bilan topshirishni tasdiqlaydi.
- API har bir so'rovda sessiya va rolni server tomonida tekshiradi. Buyurtmadagi narxlar xizmatlar katalogidan olinadi.

Mavjud o'rnatmada eski parollar server ilk bor yangilangan kodek bilan ishga tushganda bir marta almashtirilishi mumkin. Bunday holatda yangi parollar server konsolida chiqadi. Mahalliy boshqa test bazasidan foydalanish uchun `CARPET_DB_PATH` muhit o'zgaruvchisini belgilang. Ishlab chiqarish muhitida faqat HTTPS ortidan ishga tushiring (`NODE_ENV=production`); sessiya cookie'si `Secure` bayrog'i bilan beriladi.

### Vercel va doimiy PostgreSQL

Vercel serverless muhitida mahalliy SQLite fayli doimiy saqlanmaydi. Loyiha Vercel'da `POSTGRES_URL`, `DATABASE_URL` yoki `POSTGRES_PRISMA_URL` orqali ulangan PostgreSQL'dan foydalanadi; ulardan bittasini Vercel Storage/Marketplace PostgreSQL provayderidan olingan ulanish manzili bilan `Production`, `Preview` va kerakli muhitlarda sozlang. Vercel'da TLS tekshiruvi majburiy; parolni URL ichida qo'lda yozish o'rniga Vercel Environment Variables sahifasidan kiriting.

1. Git repository'ni Vercel'ga ulang va root papkasi sifatida ushbu loyihani tanlang. Express ilovasi `server.js` dan eksport qilinadi; Vercel `public/` ichidagi fayllarni CDN orqali xizmat qiladi.
2. Vercel Storage/Marketplace'dan PostgreSQL baza yarating va ulanish URL'sini yuqoridagi muhit o'zgaruvchilaridan biriga ulang.
3. Yangi baza uchun `OWNER_USERNAME` va kamida 8 belgili `OWNER_PASSWORD` muhit o'zgaruvchilarini Vercel'da maxfiy saqlang. Hozirgi lokal owner loginidan foydalanmoqchi bo'lsangiz, `OWNER_USERNAME=abdulhamid09` qilib, o'zingizning parolingizni Vercel sozlamasiga kiriting; parolni kodga yoki chatga yozmang.
4. Loyihani qayta deploy qiling. Ma'lumotlar bazasi sxemasi idempotent tarzda ishga tushadi, standart xizmat kategoriyalari sozlanadi, lekin namuna mijoz/buyurtmalar ishlab chiqarish bazasiga qo'shilmaydi. Birinchi ishga tushishdan keyin `/api/health` `{"success":true,"database":"postgres"}` javobini berishi kerak.
5. Telegram bot va guruh sozlamalarini tizimga kirgandan keyin ilovadan kiriting. Lokal SQLite bazasi va Vercel PostgreSQL alohida saqlanadi; ularni bog'lash yoki ko'chirish uchun alohida import/export amali kerak.

Serverless so'rovlar orasida login sessiyalari PostgreSQL'da xeshlangan ko'rinishda saqlanadi, shuning uchun alohida function nusxalari bir sessiyani tanishi mumkin. Buyurtma, buyum, mijoz va avans yozuvlari bitta tranzaksiyada saqlanadi; tartib raqami ma'lumotlar bazasining atomar hisoblagichidan olinadi. PostgreSQL ulanish havzasi function nusxasida kichik (`PG_POOL_MAX=1`) saqlanadi; faqat provayder ulanish limiti yetarli bo'lsa o'zgartiring. PostgreSQL provayderining backup/PITR imkoniyatlarini alohida yoqing.
