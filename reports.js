// reports.js - Excel va Word formatida hisobotlarni generatsiya qilish
const ExcelJS = require('exceljs');
const docx = require('docx');
const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, WidthType, AlignmentType } = docx;
const { db } = require('./database');

// Excel hisobot
async function generateOrdersExcel(filter = {}) {
  const workbook = new ExcelJS.Workbook();
  const orders = await db.all(`
    SELECT 
      o.id,
      o.order_number as "Buyurtma_Raqami",
      c.full_name as "Mijoz",
      c.phone as "Telefon",
      c.address as "Manzil",
      o.status as "Holati",
      o.total_area as "Maydoni_m2",
      o.total_items as "Buyumlar_soni",
      o.final_amount as "Jami_Summa",
      o.paid_amount as "Tolangan",
      (o.final_amount - o.paid_amount) as "Qarzdorlik",
      o.payment_method as "Tolov_Turi",
      o.payment_status as "Tolov_Holati",
      u.full_name as "Dastavchik",
      o.pickup_date as "Olib_ketilgan_sana",
      o.target_delivery_date as "Yetkazish_muddati",
      o.created_at as "Yaratilgan_vaqt"
    FROM orders o
    JOIN customers c ON o.customer_id = c.id
    LEFT JOIN users u ON o.courier_delivery_id = u.id
    ORDER BY o.id DESC
  `);

  addWorksheet(workbook, 'Buyurtmalar Hisoboti', [
    ['№', 'number', 6],
    ['Buyurtma kodi', 'orderNumber', 15],
    ['Mijoz F.I.SH', 'customer', 22],
    ['Telefon', 'phone', 18],
    ['Manzil', 'address', 28],
    ['Holati', 'status', 15],
    ['Maydon (m²)', 'area', 12],
    ['Buyumlar (dona)', 'itemCount', 12],
    ["Jami Summa (so'm)", 'total', 16],
    ["To'langan (so'm)", 'paid', 16],
    ["Qarzdorlik (so'm)", 'debt', 16],
    ["To'lov turi", 'paymentMethod', 12],
    ["To'lov holati", 'paymentStatus', 14],
    ['Dastavchik', 'courier', 20],
    ['Olib ketilgan', 'pickupDate', 16],
    ['Kutilgan yetkazish', 'deliveryDate', 16],
    ['Sana', 'createdAt', 18]
  ], orders.map(row => ({
    number: row.id,
    orderNumber: row.Buyurtma_Raqami,
    customer: row.Mijoz,
    phone: row.Telefon,
    address: row.Manzil,
    status: row.Holati,
    area: row.Maydoni_m2,
    itemCount: row.Buyumlar_soni,
    total: row.Jami_Summa,
    paid: row.Tolangan,
    debt: row.Qarzdorlik,
    paymentMethod: row.Tolov_Turi,
    paymentStatus: row.Tolov_Holati,
    courier: row.Dastavchik || 'Biriktirilmagan',
    pickupDate: row.Olib_ketilgan_sana || '-',
    deliveryDate: row.Yetkazish_muddati || '-',
    createdAt: row.Yaratilgan_vaqt
  })));

  // 2-list: Buyumlar
  const itemRows = await db.all(`
    SELECT 
      oi.id,
      o.order_number,
      c.full_name as customer_name,
      oi.item_type,
      oi.length,
      oi.width,
      oi.area,
      oi.quantity,
      oi.unit_price,
      oi.subtotal,
      oi.notes
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    JOIN customers c ON o.customer_id = c.id
    ORDER BY oi.id DESC
  `);

  addWorksheet(workbook, "Gilam va Adyollar Ro'yxati", [
    ['№', 'number', 6],
    ['Buyurtma', 'orderNumber', 15],
    ['Mijoz', 'customer', 22],
    ['Buyum turi', 'itemType', 22],
    ['Uzunlik (m)', 'length', 12],
    ['Eni (m)', 'width', 12],
    ['Maydon (m²)', 'area', 12],
    ['Dona soni', 'quantity', 10],
    ["Birlik narxi (so'm)", 'unitPrice', 16],
    ["Jami (so'm)", 'total', 16],
    ['Izoh/Belgi', 'notes', 25]
  ], itemRows.map(item => ({
    number: item.id,
    orderNumber: item.order_number,
    customer: item.customer_name,
    itemType: item.item_type,
    length: item.length || '-',
    width: item.width || '-',
    area: item.area || '-',
    quantity: item.quantity,
    unitPrice: item.unit_price,
    total: item.subtotal,
    notes: item.notes || '-'
  })));

  // 3-list: Moliya / Kassa
  const txRows = await db.all(`
    SELECT 
      t.id,
      t.type,
      t.category,
      t.amount,
      t.payment_method,
      t.description,
      t.created_at
    FROM transactions t
    ORDER BY t.id DESC
  `);

  addWorksheet(workbook, 'Kassa va Xarajatlar', [
    ['ID', 'id', 8],
    ['Turi', 'type', 24],
    ['Kategoriya', 'category', 22],
    ["Summa (so'm)", 'amount', 16],
    ["To'lov usuli", 'paymentMethod', 16],
    ['Izoh', 'description', 40],
    ['Sana', 'createdAt', 20]
  ], txRows.map(transaction => ({
    id: transaction.id,
    type: transaction.type === 'kirim' ? 'Kirim (Daromad)' : 'Chiqim (Xarajat)',
    category: transaction.category,
    amount: transaction.amount,
    paymentMethod: transaction.payment_method,
    description: transaction.description || '',
    createdAt: transaction.created_at
  })));

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function addWorksheet(workbook, name, columns, rows) {
  const worksheet = workbook.addWorksheet(name);
  worksheet.columns = columns.map(([header, key, width]) => ({ header, key, width }));
  worksheet.addRows(rows);
  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: columns.length }
  };
}

// Word (.docx) hisobot generatsiya qilish
async function generateOrderDocx(orderId) {
  const order = await db.get(`
    SELECT o.*, 
      c.full_name as customer_name, c.phone as customer_phone, c.phone2, c.address as customer_address, c.landmark,
      u1.full_name as courier_pickup_name, u1.phone as courier_pickup_phone,
      u2.full_name as courier_deliv_name, u2.phone as courier_deliv_phone
    FROM orders o
    JOIN customers c ON o.customer_id = c.id
    LEFT JOIN users u1 ON o.courier_pickup_id = u1.id
    LEFT JOIN users u2 ON o.courier_delivery_id = u2.id
    WHERE o.id = ?
  `, [orderId]);

  if (!order) throw new Error("Buyurtma topilmadi");

  const items = await db.all('SELECT * FROM order_items WHERE order_id = ?', [orderId]);

  const tableRows = [
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "№", bold: true })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Buyum turi", bold: true })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "O'lchamlari (m)", bold: true })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Maydon / Dona", bold: true })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Narxi (so'm)", bold: true })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Jami (so'm)", bold: true })] })] }),
      ]
    })
  ];

  items.forEach((item, index) => {
    const sizeStr = (item.length > 0 && item.width > 0) ? `${item.length} × ${item.width}` : '-';
    const metricStr = (item.area > 0) ? `${item.area.toFixed(2)} m²` : `${item.quantity} dona`;

    tableRows.push(new TableRow({
      children: [
        new TableCell({ children: [new Paragraph(String(index + 1))] }),
        new TableCell({ children: [new Paragraph(item.item_type + (item.notes ? ` (${item.notes})` : ''))] }),
        new TableCell({ children: [new Paragraph(sizeStr)] }),
        new TableCell({ children: [new Paragraph(metricStr)] }),
        new TableCell({ children: [new Paragraph(item.unit_price.toLocaleString())] }),
        new TableCell({ children: [new Paragraph(item.subtotal.toLocaleString())] }),
      ]
    }));
  });

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          text: "PROFESSIONAL GILAM VA ADYOL YUVISH KORXONASI",
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER
        }),
        new Paragraph({
          text: `BUYURTMA VA KVIKTANSIYA: ${order.order_number}`,
          heading: HeadingLevel.HEADING_2,
          alignment: AlignmentType.CENTER
        }),
        new Paragraph({ text: `Sana: ${new Date().toLocaleDateString('uz-UZ')}` }),
        new Paragraph({ text: "----------------------------------------------------------------------------------" }),
        new Paragraph({ children: [new TextRun({ text: "Mijoz ma'lumotlari:", bold: true })] }),
        new Paragraph({ text: `F.I.SH: ${order.customer_name}` }),
        new Paragraph({ text: `Telefon: ${order.customer_phone} ${order.phone2 ? '(' + order.phone2 + ')' : ''}` }),
        new Paragraph({ text: `Manzil: ${order.customer_address}` }),
        new Paragraph({ text: `Mo'ljal: ${order.landmark || '-'}` }),
        new Paragraph({ text: " " }),
        new Paragraph({ children: [new TextRun({ text: "Dastavchik va Yetkazish:", bold: true })] }),
        new Paragraph({ text: `Qabul qiluvchi: ${order.courier_pickup_name || '-'} (${order.courier_pickup_phone || ''})` }),
        new Paragraph({ text: `Yetkazib beruvchi: ${order.courier_deliv_name || '-'} (${order.courier_deliv_phone || ''})` }),
        new Paragraph({ text: `Holati: ${order.status}` }),
        new Paragraph({ text: " " }),
        new Paragraph({ children: [new TextRun({ text: "Qabul qilingan buyumlar ro'yxati:", bold: true })] }),
        new Table({
          rows: tableRows,
          width: { size: 100, type: WidthType.PERCENTAGE }
        }),
        new Paragraph({ text: " " }),
        new Paragraph({ children: [new TextRun({ text: `Umumiy maydon: ${order.total_area ? order.total_area.toFixed(2) : 0} m²`, bold: true })] }),
        new Paragraph({ children: [new TextRun({ text: `Chegirma: ${order.discount ? order.discount.toLocaleString() : 0} so'm` })] }),
        new Paragraph({ children: [new TextRun({ text: `JAMI TO'LOV: ${order.final_amount.toLocaleString()} so'm`, bold: true, size: 28 })] }),
        new Paragraph({ text: `To'langan: ${order.paid_amount.toLocaleString()} so'm` }),
        new Paragraph({ text: `Qarzdorlik / Qoldiq: ${(order.final_amount - order.paid_amount).toLocaleString()} so'm` }),
        new Paragraph({ text: `To'lov usuli: ${order.payment_method}` }),
        new Paragraph({ text: " " }),
        new Paragraph({ text: "Xizmatimizdan foydalanganingiz uchun rahmat!" }),
        new Paragraph({ text: "Imzo: _____________________            Mijoz imzosi: _____________________" })
      ]
    }]
  });

  return await Packer.toBuffer(doc);
}

// Umumiy jamlama hisobot Word (.docx)
async function generateGeneralReportDocx() {
  const stats = await db.get(`
    SELECT 
      COUNT(*) as total_orders,
      SUM(CASE WHEN status = 'yetkazildi' THEN 1 ELSE 0 END) as completed_orders,
      SUM(CASE WHEN status != 'yetkazildi' AND status != 'bekor_qilindi' THEN 1 ELSE 0 END) as active_orders,
      SUM(final_amount) as total_revenue,
      SUM(paid_amount) as total_paid,
      SUM(total_area) as total_sqm
    FROM orders
  `);

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({
          text: "GILAM YUVISH BOSHQARUV TIZIMI - DAVRIY HISOBOT",
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER
        }),
        new Paragraph({
          text: `Sana: ${new Date().toLocaleString('uz-UZ')}`,
          alignment: AlignmentType.CENTER
        }),
        new Paragraph({ text: " " }),
        new Paragraph({ children: [new TextRun({ text: "ASOSIY KO'RSATKICHLAR:", bold: true, size: 24 })] }),
        new Paragraph({ text: `• Jami qabul qilingan buyurtmalar: ${stats.total_orders || 0} ta` }),
        new Paragraph({ text: `• Bajarilgan va yetkazilgan buyurtmalar: ${stats.completed_orders || 0} ta` }),
        new Paragraph({ text: `• Jarayondagi faol buyurtmalar: ${stats.active_orders || 0} ta` }),
        new Paragraph({ text: `• Jami yuvilgan gilamlar maydoni: ${(stats.total_sqm || 0).toFixed(2)} m²` }),
        new Paragraph({ text: `• Umumiy buyurtmalar summasi: ${(stats.total_revenue || 0).toLocaleString()} so'm` }),
        new Paragraph({ text: `• Kassaga tushgan mablag': ${(stats.total_paid || 0).toLocaleString()} so'm` }),
        new Paragraph({ text: `• Kutilayotgan qarzdorliklar: ${((stats.total_revenue || 0) - (stats.total_paid || 0)).toLocaleString()} so'm` }),
        new Paragraph({ text: " " }),
        new Paragraph({ text: "Hisobot tizim orqali avtomatik shakllantirildi." })
      ]
    }]
  });

  return await Packer.toBuffer(doc);
}

module.exports = {
  generateOrdersExcel,
  generateOrderDocx,
  generateGeneralReportDocx
};
