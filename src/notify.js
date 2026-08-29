const nodemailer = require("nodemailer");

const {
  createNotification,
  getUserById,
  getUserByStudentId,
  listUsers,
  logNotificationDelivery
} = require("./db");

const APP_NAME = process.env.APP_NAME || "CCA Registrar System";
const APP_URL = process.env.APP_URL || "http://localhost:3000";

function emailMode() {
  const mode = (process.env.NOTIFY_EMAIL_MODE || "ethereal").toLowerCase();
  if (mode === "smtp") return "smtp";
  if (mode === "pingram") return "pingram";
  if (mode === "console") return "console";
  return "ethereal";
}

function smsMode() {
  const mode = (process.env.NOTIFY_SMS_MODE || "").toLowerCase();
  if (mode === "unisms") return "unisms";
  if (mode === "philsms") return "philsms";
  if (mode === "twilio") return "twilio";
  if (mode === "pingram") return "pingram";
  if (mode === "console") return "console";
  if (process.env.UNISMS_API_KEY) return "unisms";
  if (process.env.PHILSMS_API_TOKEN) return "philsms";
  return "console";
}

function unismsBaseUrl() {
  return (process.env.UNISMS_BASE_URL || "https://unismsapi.com/api").replace(/\/$/, "");
}

function unismsSenderId() {
  return (process.env.UNISMS_SENDER_ID || "UniSMS").trim();
}

function unismsAuthHeader() {
  const key = process.env.UNISMS_API_KEY;
  if (!key) {
    throw new Error("UNISMS_API_KEY is not configured");
  }
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

async function unismsSendSms(recipient, content) {
  const res = await fetch(`${unismsBaseUrl()}/sms`, {
    method: "POST",
    headers: {
      Authorization: unismsAuthHeader(),
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      recipient,
      content,
      sender_id: unismsSenderId()
    })
  });

  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  if (!res.ok || parsed?.errors) {
    throw new Error(formatDeliveryError(text));
  }

  return parsed;
}

function philsmsBaseUrl() {
  return (process.env.PHILSMS_BASE_URL || "https://dashboard.philsms.com/api/v3").replace(/\/$/, "");
}

function philsmsSenderId() {
  return (process.env.PHILSMS_SENDER_ID || "CASUGANATICS").trim().slice(0, 11);
}

async function philsmsSendSms(recipient, message) {
  const token = process.env.PHILSMS_API_TOKEN;
  if (!token) {
    throw new Error("PHILSMS_API_TOKEN is not configured");
  }

  const res = await fetch(`${philsmsBaseUrl()}/sms/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      recipient,
      sender_id: philsmsSenderId(),
      type: "plain",
      message
    })
  });

  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  if (!res.ok || parsed?.status === "error") {
    throw new Error(parsed?.message || text.slice(0, 300) || "PhilSMS request failed");
  }

  return parsed;
}

function pingramBaseUrl() {
  return (process.env.PINGRAM_BASE_URL || "https://api.pingram.io").replace(/\/$/, "");
}

function pingramSmsType() {
  return (
    process.env.PINGRAM_SMS_TYPE ||
    process.env.PINGRAM_NOTIFICATION_TYPE ||
    "sms_compose_preview"
  );
}

function pingramEmailType() {
  return (
    process.env.PINGRAM_EMAIL_TYPE ||
    process.env.PINGRAM_NOTIFICATION_TYPE ||
    "City College of Angeles"
  );
}

async function pingramRequest(path, body) {
  const apiKey = process.env.PINGRAM_API_KEY;
  if (!apiKey) {
    throw new Error("PINGRAM_API_KEY is not configured");
  }
  const res = await fetch(`${pingramBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text.slice(0, 300));
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function getDeliveryModes() {
  return { email: emailMode(), sms: smsMode() };
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("63") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 11) return `+63${digits.slice(1)}`;
  if (digits.length === 10) return `+63${digits}`;
  if (String(phone || "").startsWith("+")) return String(phone).trim();
  return digits.length >= 10 ? `+${digits}` : "";
}

function normalizePhoneForPhilSms(phone) {
  const e164 = normalizePhone(phone);
  return e164 ? e164.replace(/\D/g, "") : "";
}

function smsBody(title, message) {
  const brand = "CCA Registrar";
  let subject = String(title || brand).replace(/\s+/g, " ").trim();
  let detail = String(message || "").replace(/\s+/g, " ").trim();

  subject = subject
    .replace(/^sample alert from\s+/i, "")
    .replace(/\b(sample|test|demo)\b/gi, "")
    .replace(/\balert\b/gi, "update")
    .replace(/\s+/g, " ")
    .trim();

  detail = detail
    .replace(/\bthis is a test notification\.?\s*/i, "")
    .replace(/\b(test|sample|demo)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  let text = detail;
  if (subject && subject.toLowerCase() !== brand.toLowerCase()) {
    text = detail ? `${subject} - ${detail}` : subject;
  } else if (!text) {
    text = brand;
  } else if (!text.toLowerCase().startsWith(brand.toLowerCase())) {
    text = `${brand} - ${detail}`;
  }

  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function formatDeliveryError(errorText) {
  const raw = String(errorText || "").trim();
  if (!raw) return "Delivery failed";
  try {
    const parsed = JSON.parse(raw);
    if (parsed.errors && typeof parsed.errors === "object") {
      const parts = [];
      for (const [field, msgs] of Object.entries(parsed.errors)) {
        if (Array.isArray(msgs)) parts.push(`${field}: ${msgs.join(", ")}`);
        else parts.push(String(msgs));
      }
      if (parts.length) return parts.join("; ");
    }
    const err = parsed.error || parsed;
    const code = String(err.code || "");
    const message = err.message || parsed.message || err.fix || raw;
    if (
      code === "21612" ||
      /country is not supported/i.test(message) ||
      /combination of.*To.*From/i.test(message)
    ) {
      return (
        "Pingram rejected this SMS: your account’s sender number is not set up for Philippines (+63) yet. " +
        "Email works worldwide, but SMS needs country-specific routing — contact Pingram support or enable PH delivery in your dashboard. " +
        `(Pingram code ${code || "21612"})`
      );
    }
    if (/exceeded your sending limit/i.test(message) || /insufficient|not enough.*credit|balance/i.test(message)) {
      return "PhilSMS rejected this SMS: no SMS credits left. Top up your PhilSMS account, then try again.";
    }
    if (/unauthenticated/i.test(message)) {
      return "PhilSMS rejected this SMS: invalid API token. Copy the token from PhilSMS → Developers into PHILSMS_API_TOKEN in .env.";
    }
    return message;
  } catch {
    return raw.length > 240 ? `${raw.slice(0, 237)}...` : raw;
  }
}

function absoluteLink(link) {
  if (!link) return APP_URL;
  if (/^https?:\/\//i.test(link)) return link;
  return `${APP_URL.replace(/\/$/, "")}${link.startsWith("/") ? link : `/${link}`}`;
}

let smtpTransport;
let etherealTransport;

function getSmtpTransport() {
  if (smtpTransport) return smtpTransport;
  smtpTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" }
      : undefined
  });
  return smtpTransport;
}

async function getEtherealTransport() {
  if (etherealTransport) return etherealTransport;
  const testAccount = await nodemailer.createTestAccount();
  etherealTransport = nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass
    }
  });
  return etherealTransport;
}

async function sendEmail(user, title, message, link) {
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.5;color:#1e293b">
      <h2 style="margin:0 0 0.5rem">${title}</h2>
      <p style="margin:0 0 1rem">${message}</p>
      ${link ? `<p><a href="${absoluteLink(link)}">Open in ${APP_NAME}</a></p>` : ""}
      <p style="color:#64748b;font-size:12px">${APP_NAME}</p>
    </div>`;

  const mail = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER || `"${APP_NAME}" <no-reply@cca.edu.ph>`,
    to: user.email,
    subject: `[${APP_NAME}] ${title}`,
    text: `${message}${link ? `\n\nOpen: ${absoluteLink(link)}` : ""}`,
    html
  };

  const mode = emailMode();

  if (mode === "console") {
    console.log(`[email:console] to=${user.email} subject=${title}`);
    await logNotificationDelivery({
      userId: user.id,
      channel: "email",
      title,
      status: "console",
      detail: "Demo only — logged to server terminal, not sent to a real inbox."
    });
    return { ok: true, mode: "console" };
  }

  if (mode === "pingram") {
    try {
      const payload = {
        type: pingramEmailType(),
        to: user.email,
        subject: `[${APP_NAME}] ${title}`,
        html
      };
      if (process.env.PINGRAM_FROM_ADDRESS) payload.fromAddress = process.env.PINGRAM_FROM_ADDRESS;
      if (process.env.PINGRAM_FROM_NAME) payload.fromName = process.env.PINGRAM_FROM_NAME;

      await pingramRequest("/email", payload);
      await logNotificationDelivery({
        userId: user.id,
        channel: "email",
        title,
        status: "sent",
        detail: `Delivered via Pingram to ${user.email}`
      });
      console.log(`[email:pingram] to=${user.email} subject=${title}`);
      return { ok: true, mode: "pingram", to: user.email };
    } catch (err) {
      await logNotificationDelivery({
        userId: user.id,
        channel: "email",
        title,
        status: "failed",
        detail: err.message || "Pingram email failed"
      });
      console.error("[email:pingram] send failed:", err.message);
      return { ok: false, mode: "pingram", error: err.message };
    }
  }

  try {
    const transport = mode === "smtp" ? getSmtpTransport() : await getEtherealTransport();
    const info = await transport.sendMail(mail);
    const previewUrl = mode === "ethereal" ? nodemailer.getTestMessageUrl(info) : null;

    await logNotificationDelivery({
      userId: user.id,
      channel: "email",
      title,
      status: mode === "ethereal" ? "demo" : "sent",
      detail:
        mode === "ethereal"
          ? `Demo email — open preview: ${previewUrl}`
          : `Delivered to ${user.email}`
    });

    if (mode === "ethereal") {
      console.log(`[email:ethereal] to=${user.email} preview=${previewUrl}`);
    }

    return { ok: true, mode, previewUrl, to: user.email };
  } catch (err) {
    await logNotificationDelivery({
      userId: user.id,
      channel: "email",
      title,
      status: "failed",
      detail: err.message || "Email send failed"
    });
    console.error("[email] send failed:", err.message);
    return { ok: false, mode, error: err.message };
  }
}

async function sendSms(user, title, message) {
  const to = normalizePhone(user.phone);
  const body = smsBody(title, message);

  if (!to) {
    await logNotificationDelivery({
      userId: user.id,
      channel: "sms",
      title,
      status: "failed",
      detail: "No valid phone number on file"
    });
    return { ok: false, error: "No valid phone number" };
  }

  if (smsMode() === "console") {
    console.log(`[sms:console] to=${to} body=${body}`);
    await logNotificationDelivery({
      userId: user.id,
      channel: "sms",
      title,
      status: "demo",
      detail: `Demo only — not sent to your phone. Message: "${body}". Set NOTIFY_SMS_MODE=unisms in .env for real SMS.`
    });
    return { ok: true, mode: "console", body, to, demo: true };
  }

  if (smsMode() === "unisms") {
    const recipient = normalizePhone(user.phone);
    if (!recipient) {
      await logNotificationDelivery({
        userId: user.id,
        channel: "sms",
        title,
        status: "failed",
        detail: "No valid Philippine mobile number on file"
      });
      return { ok: false, error: "No valid Philippine mobile number" };
    }

    try {
      const result = await unismsSendSms(recipient, body);
      const ref = result?.message?.reference_id;
      await logNotificationDelivery({
        userId: user.id,
        channel: "sms",
        title,
        status: "sent",
        detail: ref
          ? `Delivered via UniSMS to ${recipient} (ref ${ref})`
          : `Delivered via UniSMS to ${recipient}`
      });
      console.log(`[sms:unisms] to=${recipient}`);
      return { ok: true, mode: "unisms", to: recipient, referenceId: ref || null };
    } catch (err) {
      const friendly = formatDeliveryError(err.message);
      await logNotificationDelivery({
        userId: user.id,
        channel: "sms",
        title,
        status: "failed",
        detail: friendly
      });
      console.error("[sms:unisms] send failed:", friendly);
      return { ok: false, mode: "unisms", error: friendly };
    }
  }

  if (smsMode() === "philsms") {
    const recipient = normalizePhoneForPhilSms(user.phone);
    if (!recipient) {
      await logNotificationDelivery({
        userId: user.id,
        channel: "sms",
        title,
        status: "failed",
        detail: "No valid Philippine mobile number on file"
      });
      return { ok: false, error: "No valid Philippine mobile number" };
    }

    try {
      await philsmsSendSms(recipient, body);
      await logNotificationDelivery({
        userId: user.id,
        channel: "sms",
        title,
        status: "sent",
        detail: `Delivered via PhilSMS to +${recipient}`
      });
      console.log(`[sms:philsms] to=+${recipient}`);
      return { ok: true, mode: "philsms", to: `+${recipient}` };
    } catch (err) {
      const friendly = formatDeliveryError(err.message);
      await logNotificationDelivery({
        userId: user.id,
        channel: "sms",
        title,
        status: "failed",
        detail: friendly
      });
      console.error("[sms:philsms] send failed:", friendly);
      return { ok: false, mode: "philsms", error: friendly };
    }
  }

  if (smsMode() === "pingram") {
    try {
      const payload = {
        type: pingramSmsType(),
        to,
        message: body
      };
      if (process.env.PINGRAM_FROM_NUMBER) payload.from = process.env.PINGRAM_FROM_NUMBER;

      await pingramRequest("/sms", payload);
      await logNotificationDelivery({
        userId: user.id,
        channel: "sms",
        title,
        status: "sent",
        detail: `Delivered via Pingram to ${to}`
      });
      console.log(`[sms:pingram] to=${to}`);
      return { ok: true, mode: "pingram", to };
    } catch (err) {
      const friendly = formatDeliveryError(err.message);
      await logNotificationDelivery({
        userId: user.id,
        channel: "sms",
        title,
        status: "failed",
        detail: friendly
      });
      console.error("[sms:pingram] send failed:", friendly);
      return { ok: false, mode: "pingram", error: friendly };
    }
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !from) {
    await logNotificationDelivery({
      userId: user.id,
      channel: "sms",
      title,
      status: "failed",
      detail: "Twilio is not configured"
    });
    return { ok: false, error: "Twilio not configured" };
  }

  try {
    const params = new URLSearchParams({ To: to, From: from, Body: body });
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params.toString()
      }
    );
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText.slice(0, 240));
    }
    await logNotificationDelivery({
      userId: user.id,
      channel: "sms",
      title,
      status: "sent",
      detail: `Delivered to ${to}`
    });
    return { ok: true, mode: "twilio", to };
  } catch (err) {
    await logNotificationDelivery({
      userId: user.id,
      channel: "sms",
      title,
      status: "failed",
      detail: err.message || "SMS send failed"
    });
    console.error("[sms] send failed:", err.message);
    return { ok: false, mode: "twilio", error: err.message };
  }
}

async function notifyUser(userId, { title, message, link = null }) {
  await createNotification({ userId, title, message, link });
  const user = await getUserById(userId);
  if (!user) return { email: null, sms: null };

  let email = null;
  let sms = null;
  if (user.notifyEmail) email = await sendEmail(user, title, message, link);
  if (user.notifySms) sms = await sendSms(user, title, message);
  return { email, sms };
}

async function notifyAllUsers({ title, message, link = null, excludeUserId = null }) {
  const users = await listUsers();
  for (const u of users) {
    if (excludeUserId && u.id === excludeUserId) continue;
    await notifyUser(u.id, { title, message, link });
  }
}

async function notifyStudentByStudentId(studentId, payload) {
  const user = await getUserByStudentId(studentId);
  if (user) return notifyUser(user.id, payload);
  return { email: null, sms: null };
}

function formatSampleAlertMessage(results) {
  const parts = ["In-app notification saved. Check the bell icon in the top bar."];
  if (results.email?.previewUrl) {
    parts.push(`Demo email ready — open this preview link: ${results.email.previewUrl}`);
  } else if (results.email?.ok && results.email.mode === "pingram") {
    parts.push(`Email sent via Pingram to ${results.email.to}.`);
  } else if (results.email?.ok && results.email.mode === "smtp") {
    parts.push(`Email sent to ${results.email.to}.`);
  } else if (results.email?.ok && results.email.mode === "console") {
    parts.push("Email logged to server console only (demo mode).");
  } else if (results.email && !results.email.ok) {
    parts.push(`Email failed: ${results.email.error}`);
  }

  if (results.sms?.demo) {
    parts.push(
      `SMS is demo-only (not sent to ${results.sms.to}). Message: "${results.sms.body}". Set NOTIFY_SMS_MODE=unisms in .env for real texts.`
    );
  } else if (results.sms?.ok && results.sms.mode === "unisms") {
    parts.push(`SMS sent via UniSMS to ${results.sms.to}.`);
  } else if (results.sms?.ok && results.sms.mode === "philsms") {
    parts.push(`SMS sent via PhilSMS to ${results.sms.to}.`);
  } else if (results.sms?.ok && results.sms.mode === "pingram") {
    parts.push(`SMS sent via Pingram to ${results.sms.to}.`);
  } else if (results.sms?.ok && results.sms.mode === "twilio") {
    parts.push(`SMS sent to ${results.sms.to}.`);
  } else if (results.sms && !results.sms.ok && results.sms.error) {
    parts.push(`SMS failed — ${results.sms.error}`);
  }

  return parts.join(" ");
}

module.exports = {
  notifyUser,
  notifyAllUsers,
  notifyStudentByStudentId,
  getDeliveryModes,
  sendEmail,
  normalizePhone,
  normalizePhoneForPhilSms,
  smsBody,
  formatSampleAlertMessage
};
