const { deliverSimpleMail } = require("./contact");

const SHIPPING_CARRIERS = [
  "Yurtiçi Kargo",
  "Aras Kargo",
  "MNG Kargo",
  "PTT Kargo",
  "Sürat Kargo",
  "UPS",
  "DHL",
  "Diğer",
];

/** Durum değişiminde müşteriye giden sabit şablonlar. */
const ORDER_MAIL_TEMPLATES = {
  paid: {
    subject: "Siparişini Aldık!",
    buildBody(order) {
      const name = customerName(order);
      return [
        `Merhaba ${name},`,
        "",
        "Siparişiniz tarafımıza ulaştı. Teşekkür ederiz!",
        "",
        `Sipariş no: ${order.id}`,
        `Toplam: ${formatMoney(order.total)}`,
        "",
        "Siparişiniz en kısa süre içerisinde hazırlanıyor olacak ve tarafınıza mail üzerinden bilgilendirme yapacağız.",
        "",
        "Patygo Teknoloji",
        "https://patygoteknoloji.com",
      ].join("\n");
    },
  },
  preparing: {
    subject: "Siparişiniz Hazırlanıyor",
    buildBody(order) {
      const name = customerName(order);
      return [
        `Merhaba ${name},`,
        "",
        "Siparişiniz şu anda hazırlanıyor.",
        "",
        `Sipariş no: ${order.id}`,
        "",
        "Kargoya verildiğinde takip bilgilerinizi e-posta ile paylaşacağız.",
        "",
        "Patygo Teknoloji",
        "https://patygoteknoloji.com",
      ].join("\n");
    },
  },
  shipped: {
    subject: "Siparişiniz Kargoya Verildi",
    buildBody(order, extra) {
      const name = customerName(order);
      const carrier =
        (extra && extra.shippingCarrier) || order.shippingCarrier || "Kargo firması";
      const tracking =
        (extra && extra.trackingCode) || order.trackingCode || "—";
      return [
        `Merhaba ${name},`,
        "",
        "Siparişiniz kargoya verildi.",
        "",
        `Sipariş no: ${order.id}`,
        `Kargo firması: ${carrier}`,
        `Gönderi / takip kodu: ${tracking}`,
        "",
        "Kargo firmasının web sitesinden veya müşteri hizmetlerinden takip edebilirsiniz.",
        "",
        "Patygo Teknoloji",
        "https://patygoteknoloji.com",
      ].join("\n");
    },
  },
};

const NOTIFY_STATUSES = new Set(["paid", "preparing", "shipped"]);

function customerName(order) {
  const c = (order && order.customer) || {};
  return String(c.name || c.fullName || "Müşterimiz").trim() || "Müşterimiz";
}

function formatMoney(value) {
  return (
    "₺" +
    Number(value || 0).toLocaleString("tr-TR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function buildOrderMail(order, templateKey, extra) {
  const tpl = ORDER_MAIL_TEMPLATES[templateKey];
  if (!tpl) return null;
  return {
    subject: tpl.subject,
    text: tpl.buildBody(order, extra || {}),
  };
}

function customerEmail(order) {
  return String(((order && order.customer) || {}).email || "")
    .trim()
    .toLowerCase();
}

async function sendOrderStatusMail(order, templateKey, options) {
  const opts = options || {};
  const tpl = ORDER_MAIL_TEMPLATES[templateKey];
  if (!tpl) return { sent: false, reason: "unknown_template" };
  const to = customerEmail(order);
  if (!to) return { sent: false, reason: "no_email" };
  const mail = buildOrderMail(order, templateKey, opts.extra);
  await deliverSimpleMail(
    {
      to,
      subject: mail.subject,
      text: mail.text,
    },
    { env: opts.env, fetchImpl: opts.fetchImpl }
  );
  return { sent: true, to, subject: mail.subject };
}

module.exports = {
  SHIPPING_CARRIERS,
  ORDER_MAIL_TEMPLATES,
  NOTIFY_STATUSES,
  buildOrderMail,
  sendOrderStatusMail,
  customerEmail,
};
