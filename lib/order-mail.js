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
    subject: "Siparişinizi Aldık",
    heading: "Siparişinizi Aldık",
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
  cancelled: {
    subject: "Siparişiniz iptal edildi",
    heading: "Siparişiniz iptal edildi",
    summary:
      "Siparişiniz iptal edilmiştir. Ödeme alınmışsa iade süreci banka ve ödeme kurallarına göre yürütülür; sorularınız için bize yazabilirsiniz.",
  },
  invoice: {
    subject: "Sipariş faturanız",
    heading: "Sipariş faturanız hazır",
    summary:
      "Siparişinizin satış faturası hazırlandı. PDF ekte yoksa e-postadaki bağlantıdan indirebilirsiniz.",
  },
};

const NOTIFY_STATUSES = new Set(["paid", "preparing", "shipped", "cancelled"]);

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

function itemLineGross(item) {
  return Math.round(((Number(item.line) || 0) + (Number(item.lineVat) || 0)) * 100) / 100;
}

function itemDisplayName(item) {
  const brand = String((item && item.brand) || "").trim();
  const name = String((item && item.name) || (item && item.productId) || "Ürün").trim();
  if (!brand) return name;
  if (name.toLowerCase().includes(brand.toLowerCase())) return name;
  return brand + " " + name;
}

function orderMerchandiseTotal(order) {
  if (order && order.merchandiseTotal != null) {
    return Math.round(Number(order.merchandiseTotal) * 100) / 100;
  }
  return Math.round(((Number(order.subtotal) || 0) + (Number(order.vat) || 0)) * 100) / 100;
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

function buildOrderSummaryText(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const lines = ["Sipariş özeti:", ""];
  if (items.length) {
    for (const item of items) {
      const qty = Number(item.qty) || 1;
      lines.push("- " + qty + "× " + itemDisplayName(item) + " — " + formatMoney(itemLineGross(item)));
    }
  } else {
    lines.push("- (kalem bilgisi yok)");
  }
  lines.push("");
  lines.push("Ürünler toplamı: " + formatMoney(orderMerchandiseTotal(order)));
  const shipping = Number(order.shippingFee) || 0;
  if (shipping > 0) lines.push("Kargo: " + formatMoney(shipping));
  lines.push("Genel toplam: " + formatMoney(order.total));
  return lines.join("\n");
}

function buildOrderSummaryHtml(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const merchandise = orderMerchandiseTotal(order);
  const shipping = Number(order.shippingFee) || 0;

  let itemRows = "";
  if (items.length) {
    itemRows = items
      .map((item) => {
        const qty = Number(item.qty) || 1;
        return (
          "<tr>" +
          '<td style="padding:8px 0;font-size:14px;color:#0f172a;">' +
          escapeHtml(qty + "× " + itemDisplayName(item)) +
          "</td>" +
          '<td style="padding:8px 0;font-size:14px;color:#0f172a;text-align:right;white-space:nowrap;">' +
          escapeHtml(formatMoney(itemLineGross(item))) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  } else {
    itemRows =
      '<tr><td colspan="2" style="padding:8px 0;font-size:14px;color:#64748b;">Kalem bilgisi yok</td></tr>';
  }

  let totals =
    '<tr><td style="padding:8px 0;font-size:13px;color:#64748b;">Ürünler toplamı</td>' +
    '<td style="padding:8px 0;font-size:14px;color:#0f172a;text-align:right;font-weight:600;">' +
    escapeHtml(formatMoney(merchandise)) +
    "</td></tr>";
  if (shipping > 0) {
    totals +=
      '<tr><td style="padding:8px 0;font-size:13px;color:#64748b;">Kargo</td>' +
      '<td style="padding:8px 0;font-size:14px;color:#0f172a;text-align:right;">' +
      escapeHtml(formatMoney(shipping)) +
      "</td></tr>";
  }
  totals +=
    '<tr><td style="padding:10px 0 0;font-size:14px;color:#0f172a;font-weight:700;border-top:1px solid #e2e8f0;">Genel toplam</td>' +
    '<td style="padding:10px 0 0;font-size:15px;color:#0f172a;text-align:right;font-weight:700;border-top:1px solid #e2e8f0;">' +
    escapeHtml(formatMoney(order.total)) +
    "</td></tr>";

  return (
    '<div style="margin:16px 0;">' +
    '<p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;">Sipariş özeti</p>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">' +
    itemRows +
    totals +
    "</table></div>"
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
  const summaryText = buildOrderSummaryText(order);

  const textLines = [
    "Merhaba " + name + ",",
    "",
    tpl.summary,
    "",
    "Sipariş no: " + order.id,
    "",
    summaryText,
  ];
  if (templateKey === "shipped") {
    textLines.push("", "Kargo firması: " + (carrier || "Kargo firması"));
    textLines.push("Takip kodu: " + (tracking || "—"));
  }
  if (templateKey === "invoice") {
    if (extras.pdfUrl) {
      textLines.push("", "Fatura PDF: " + extras.pdfUrl);
    } else if (extras.hasAttachment) {
      textLines.push("", "Fatura PDF bu e-postanın ekinde.");
    }
  }
  textLines.push("", "Patygo Teknoloji", site);

  let innerHtml = p("Merhaba " + name + ",") + p(tpl.summary);
  innerHtml +=
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0 0;background:#f8fafc;border-radius:12px;padding:12px 16px;">' +
    metaRow("Sipariş no", order.id);
  if (templateKey === "shipped") {
    innerHtml += metaRow("Kargo", carrier || "Kargo firması");
    innerHtml += metaRow("Takip kodu", tracking || "—");
  }
  if (templateKey === "invoice" && extras.pdfUrl) {
    innerHtml +=
      '<tr><td style="padding:6px 0;font-size:13px;color:#64748b;width:140px;">Fatura</td><td style="padding:6px 0;font-size:14px;"><a href="' +
      escapeHtml(extras.pdfUrl) +
      '" style="color:#2563eb;font-weight:600;">PDF indir</a></td></tr>';
  }
  innerHtml += "</table>";
  innerHtml += buildOrderSummaryHtml(order);

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

async function sendInvoiceCustomerMail(order, options) {
  const opts = options || {};
  const to = customerEmail(order);
  if (!to) return { sent: false, reason: "no_email" };
  const pdfUrl = String(opts.pdfUrl || "").trim();
  const attachment = opts.attachment || null;
  const store = opts.store;
  const orderId = order && order.id;
  const templateKey = "invoice";
  if (opts.force && store && typeof store.releaseStatusMail === "function" && orderId) {
    store.releaseStatusMail(orderId, templateKey);
  }
  const mail = buildOrderMail(
    order,
    templateKey,
    {
      pdfUrl: attachment && attachment.content ? "" : pdfUrl,
      hasAttachment: Boolean(attachment && attachment.content),
    },
    opts.env
  );
  let claimed = false;
  if (store && typeof store.claimStatusMail === "function" && orderId) {
    claimed = store.claimStatusMail(orderId, templateKey);
    if (!claimed) {
      return { sent: false, reason: "already_notified", to, subject: mail.subject };
    }
  }
  try {
    const payload = {
      to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    };
    if (attachment && attachment.content) {
      payload.attachments = [
        {
          filename: attachment.filename || "fatura-" + String(orderId || "siparis") + ".pdf",
          content: attachment.content,
          contentType: attachment.contentType || "application/pdf",
        },
      ];
    }
    const result = await deliverSimpleMail(payload, {
      env: opts.env,
      sendImpl: opts.sendImpl,
      fetchImpl: opts.fetchImpl,
    });
    return {
      sent: true,
      to,
      subject: mail.subject,
      channel: result.channel,
      attached: Boolean(attachment && attachment.content),
      linked: Boolean(!(attachment && attachment.content) && pdfUrl),
    };
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
  buildOrderSummaryHtml,
  buildOrderSummaryText,
  sendOrderStatusMail,
  sendInvoiceCustomerMail,
  customerEmail,
};
