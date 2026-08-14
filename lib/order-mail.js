const { deliverSimpleMail, brandedMailHtml, publicSiteBase, escapeHtml, SMTP_NOT_CONFIGURED } = require("./contact");

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

const ORDER_MAIL_TEMPLATES = {
  paid: {
    subject: "Siparişiniz alındı",
    heading: "Siparişiniz alındı",
    summary: "Siparişiniz bize ulaştı. Hazırlamaya başladığımızda sizi tekrar bilgilendireceğiz.",
  },
  preparing: {
    subject: "Siparişiniz hazırlanıyor",
    heading: "Siparişiniz hazırlanıyor",
    summary: "Siparişiniz şu anda hazırlanıyor. Kargoya verildiğinde takip bilgisi göndereceğiz.",
  },
  shipped: {
    subject: "Siparişiniz kargoda",
    heading: "Siparişiniz kargoda",
    summary: "Siparişiniz kargoya verildi. Aşağıdaki bilgilerle gönderinizi takip edebilirsiniz.",
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

function p(text) {
  return (
    '<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#334155;">' +
    escapeHtml(text) +
    "</p>"
  );
}

function metaRow(label, value) {
  return (
    '<tr><td style="padding:6px 0;font-size:13px;color:#64748b;width:140px;">' +
    escapeHtml(label) +
    '</td><td style="padding:6px 0;font-size:14px;color:#0f172a;font-weight:600;">' +
    escapeHtml(value) +
    "</td></tr>"
  );
}

function buildOrderMail(order, templateKey, extra, env) {
  const tpl = ORDER_MAIL_TEMPLATES[templateKey];
  if (!tpl) return null;
  const name = customerName(order);
  const extras = extra || {};
  const carrier = extras.shippingCarrier || order.shippingCarrier || "";
  const tracking = extras.trackingCode || order.trackingCode || "";
  const site = publicSiteBase(env);

  const textLines = [
    "Merhaba " + name + ",",
    "",
    tpl.summary,
    "",
    "Sipariş no: " + order.id,
    "Toplam: " + formatMoney(order.total),
  ];
  if (templateKey === "shipped") {
    textLines.push("Kargo firması: " + (carrier || "Kargo firması"));
    textLines.push("Takip kodu: " + (tracking || "—"));
  }
  textLines.push("", "Patygo Teknoloji", site);

  let innerHtml = p("Merhaba " + name + ",") + p(tpl.summary);
  innerHtml +=
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;background:#f8fafc;border-radius:12px;padding:12px 16px;">' +
    metaRow("Sipariş no", order.id) +
    metaRow("Toplam", formatMoney(order.total));
  if (templateKey === "shipped") {
    innerHtml += metaRow("Kargo", carrier || "Kargo firması");
    innerHtml += metaRow("Takip kodu", tracking || "—");
  }
  innerHtml += "</table>";

  return {
    subject: tpl.subject,
    heading: tpl.heading,
    text: textLines.join("\n"),
    html: brandedMailHtml({
      heading: tpl.heading,
      innerHtml,
      env,
    }),
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
  const mail = buildOrderMail(order, templateKey, opts.extra, opts.env);
  const store = opts.store;
  const orderId = order && order.id;
  let claimed = false;
  if (store && typeof store.claimStatusMail === "function" && orderId) {
    claimed = store.claimStatusMail(orderId, templateKey);
    if (!claimed) {
      return { sent: false, reason: "already_notified", to, subject: mail.subject };
    }
  }
  try {
    const result = await deliverSimpleMail(
      {
        to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      },
      { env: opts.env, sendImpl: opts.sendImpl, fetchImpl: opts.fetchImpl }
    );
    return { sent: true, to, subject: mail.subject, channel: result.channel };
  } catch (err) {
    if (claimed && store && typeof store.releaseStatusMail === "function") {
      store.releaseStatusMail(orderId, templateKey);
    }
    const msg = String((err && err.message) || "");
    if (msg === SMTP_NOT_CONFIGURED || /SMTP yapılandırılmamış/.test(msg)) {
      return { sent: false, reason: "smtp_not_configured", to, subject: mail.subject };
    }
    throw err;
  }
}

module.exports = {
  SHIPPING_CARRIERS,
  ORDER_MAIL_TEMPLATES,
  NOTIFY_STATUSES,
  buildOrderMail,
  sendOrderStatusMail,
  customerEmail,
};
