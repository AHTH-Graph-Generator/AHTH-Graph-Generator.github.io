// ============================================================
// login-ui.js — หน้าจอเข้าสู่ระบบ / ขอสิทธิ์ / รออนุมัติ (ใช้ร่วมกันทุกหน้าที่ต้อง login)
//   showAuthGate(container, { onApproved(user), requireAdmin })
//     ยังไม่ login → กรอกอีเมล → รหัส 6 หลักทางอีเมล → ตรวจสถานะ
//     new / rejected / revoked → ฟอร์มขอสิทธิ์ (ชื่อ, แผนก, เหตุผล) · pending → รออนุมัติ
//     approved → onApproved(user) (requireAdmin: ต้องเป็นแอดมินด้วย)
//   renderUserBar(container, user, onLogout) — แถบ "เข้าสู่ระบบเป็น … · ออกจากระบบ"
// ============================================================

import { t, onLanguageChange } from "./i18n.js";
import { requestCode, verifyCode, currentUser, applyForAccess, logout, ApiError } from "./auth.js";

const MSG = {
  title:      { th: "เข้าสู่ระบบ", en: "Sign in" },
  intro:      { th: "หน้านี้สำหรับผู้ใช้ที่ได้รับอนุญาตเท่านั้น กรอกอีเมลเพื่อรับรหัสเข้าสู่ระบบ 6 หลัก",
                en: "This page is for authorized users only. Enter your email to receive a 6-digit sign-in code." },
  email:      { th: "อีเมล", en: "Email" },
  sendCode:   { th: "ส่งรหัสเข้าสู่ระบบ", en: "Send sign-in code" },
  codeSent:   { th: "ส่งรหัส 6 หลักไปที่ {email} แล้ว (ใช้ได้ภายใน 10 นาที — หากไม่พบ โปรดตรวจสอบในโฟลเดอร์ Spam)",
                en: "A 6-digit code was sent to {email}. It expires in 10 minutes — check your spam folder if you can't find it." },
  code:       { th: "รหัส 6 หลัก", en: "6-digit code" },
  verify:     { th: "ยืนยัน", en: "Verify" },
  resend:     { th: "ส่งรหัสอีกครั้ง", en: "Resend code" },
  changeEmail:{ th: "เปลี่ยนอีเมล", en: "Use another email" },
  applyTitle: { th: "ขอสิทธิ์เข้าใช้งาน", en: "Request access" },
  applyIntro: { th: "กรอกข้อมูลเพื่อขอสิทธิ์ ผู้ดูแลระบบจะพิจารณาและแจ้งผลทางอีเมล", en: "Fill in this form to request access. The administrator will review it and notify you by email." },
  rejected:   { th: "คำขอครั้งก่อนไม่ได้รับการอนุมัติ ท่านสามารถส่งคำขอใหม่ได้", en: "Your previous request was declined. You may submit a new request." },
  revoked:    { th: "สิทธิ์เข้าใช้งานของท่านถูกยกเลิกแล้ว ท่านสามารถส่งคำขอใหม่ได้", en: "Your access has been revoked. You may submit a new request." },
  name:       { th: "ชื่อ-นามสกุล", en: "Full name" },
  department: { th: "แผนก / หน่วยงาน", en: "Department" },
  reason:     { th: "เหตุผลที่ขอใช้งาน", en: "Reason for access" },
  submit:     { th: "ส่งคำขอ", en: "Submit request" },
  pendingTitle:{ th: "รอการอนุมัติ", en: "Awaiting approval" },
  pendingText:{ th: "ส่งคำขอของ {email} แล้ว ผู้ดูแลระบบจะพิจารณาและแจ้งผลทางอีเมล", en: "The request for {email} has been sent. The administrator will notify you by email." },
  check:      { th: "ตรวจสอบสถานะ", en: "Check status" },
  adminOnly:  { th: "หน้านี้สำหรับผู้ดูแลระบบเท่านั้น", en: "This page is for the administrator only." },
  signedInAs: { th: "เข้าสู่ระบบเป็น", en: "Signed in as" },
  adminBadge: { th: "ผู้ดูแลระบบ", en: "Admin" },
  adminPage:  { th: "จัดการผู้ใช้", en: "Manage users" },
  logout:     { th: "ออกจากระบบ", en: "Sign out" },
  wait:       { th: "กรุณารอสักครู่…", en: "Please wait…" },
  // ข้อความ error จาก Worker
  err_bad_email:   { th: "รูปแบบอีเมลไม่ถูกต้อง", en: "Invalid email address." },
  err_wrong_code:  { th: "รหัสไม่ถูกต้อง", en: "Incorrect code." },
  err_code_expired:{ th: "รหัสหมดอายุหรือใส่ผิดเกินกำหนด กรุณาขอรหัสใหม่", en: "The code has expired. Please request a new one." },
  err_too_many:    { th: "ขอรหัสบ่อยเกินไป กรุณารอประมาณ 1 ชั่วโมงแล้วลองใหม่", en: "Too many requests. Please try again in about an hour." },
  err_name:        { th: "กรุณากรอกชื่อ", en: "Please enter your name." },
  err_mail:        { th: "ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่ภายหลัง", en: "Could not send the email. Please try again later." },
  err_network:     { th: "เชื่อมต่อระบบไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่", en: "Could not connect. Check your internet connection and try again." },
  err_other:       { th: "เกิดข้อผิดพลาด ({code})", en: "Something went wrong ({code})." },
};

function errorText(err) {
  const code = err instanceof ApiError ? err.code : String(err && err.message || err);
  if (code === "bad email") return t(MSG.err_bad_email);
  if (code === "wrong code") return t(MSG.err_wrong_code);
  if (code === "code expired") return t(MSG.err_code_expired);
  if (code === "too many requests") return t(MSG.err_too_many);
  if (code === "name required") return t(MSG.err_name);
  if (code.startsWith("mail failed")) return t(MSG.err_mail);
  if (code === "network") return t(MSG.err_network);
  return t(MSG.err_other, { code });
}

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

function field(label, input) {
  const wrap = el("label", "auth-field");
  wrap.append(el("span", "", label), input);
  return wrap;
}

function inputEl(type, attrs = {}) {
  const input = document.createElement(type === "textarea" ? "textarea" : "input");
  if (type !== "textarea") input.type = type;
  Object.assign(input, attrs);
  return input;
}

export function showAuthGate(container, { onApproved, requireAdmin = false }) {
  const state = { step: "loading", email: "", user: null, error: "", info: "", busy: false };

  const run = async (fn) => {
    if (state.busy) return;
    state.busy = true;
    state.error = "";
    render();
    try { await fn(); } catch (err) { state.error = errorText(err); }
    state.busy = false;
    render();
  };

  const decide = (user) => {
    state.user = user;
    if (!user) { state.step = "email"; return; }
    state.email = user.email;
    if (user.status === "approved") {
      if (requireAdmin && !user.isAdmin) { state.step = "notAdmin"; return; }
      state.step = "done";
      container.hidden = true;
      onApproved(user);
      return;
    }
    state.step = user.status === "pending" ? "pending" : "apply";
  };

  function render() {
    if (state.step === "done") return;
    container.hidden = false;
    const card = el("section", "panel auth-card");
    const head = el("h2", "", "");
    const body = el("div", "auth-body");
    card.append(head, body);

    if (state.step === "loading") {
      head.textContent = t(MSG.title);
      body.append(el("p", "muted", t(MSG.wait)));
    } else if (state.step === "email") {
      head.textContent = t(MSG.title);
      body.append(el("p", "muted", t(MSG.intro)));
      const email = inputEl("email", { value: state.email, autocomplete: "email", required: true, placeholder: "name@example.com" });
      const form = el("form", "auth-form");
      const btn = el("button", "btn", t(MSG.sendCode));
      btn.type = "submit";
      btn.disabled = state.busy;
      form.append(field(t(MSG.email), email), btn);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        state.email = email.value.trim().toLowerCase();
        run(async () => { await requestCode(state.email); state.step = "code"; });
      });
      body.append(form);
      setTimeout(() => email.focus(), 0);
    } else if (state.step === "code") {
      head.textContent = t(MSG.title);
      body.append(el("p", "muted", t(MSG.codeSent, { email: state.email })));
      const code = inputEl("text", { inputMode: "numeric", autocomplete: "one-time-code", maxLength: 6, pattern: "\\d{6}", required: true, placeholder: "123456" });
      code.className = "auth-code";
      const form = el("form", "auth-form");
      const btn = el("button", "btn", t(MSG.verify));
      btn.type = "submit";
      btn.disabled = state.busy;
      form.append(field(t(MSG.code), code), btn);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        run(async () => decide(await verifyCode(state.email, code.value.trim())));
      });
      const links = el("p", "auth-links");
      const resend = el("button", "link-btn", t(MSG.resend));
      resend.type = "button";
      resend.addEventListener("click", () => run(async () => { await requestCode(state.email); }));
      const change = el("button", "link-btn", t(MSG.changeEmail));
      change.type = "button";
      change.addEventListener("click", () => { state.step = "email"; state.error = ""; render(); });
      links.append(resend, change);
      body.append(form, links);
      setTimeout(() => code.focus(), 0);
    } else if (state.step === "apply") {
      head.textContent = t(MSG.applyTitle);
      const status = state.user && state.user.status;
      if (status === "rejected") body.append(el("p", "message warn", t(MSG.rejected)));
      if (status === "revoked") body.append(el("p", "message warn", t(MSG.revoked)));
      body.append(el("p", "muted", t(MSG.applyIntro)));
      const name = inputEl("text", { value: state.user?.name || "", required: true, maxLength: 80, autocomplete: "name" });
      const dept = inputEl("text", { value: state.user?.department || "", maxLength: 80 });
      const reason = inputEl("textarea", { maxLength: 300, rows: 3 });
      const form = el("form", "auth-form");
      const btn = el("button", "btn", t(MSG.submit));
      btn.type = "submit";
      btn.disabled = state.busy;
      form.append(field(`${t(MSG.email)}: ${state.email}`, el("span")), field(t(MSG.name), name), field(t(MSG.department), dept), field(t(MSG.reason), reason), btn);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        run(async () => decide(await applyForAccess({ name: name.value, department: dept.value, reason: reason.value })));
      });
      body.append(form, logoutLink());
    } else if (state.step === "pending") {
      head.textContent = t(MSG.pendingTitle);
      body.append(el("p", "", t(MSG.pendingText, { email: state.email })));
      const check = el("button", "btn secondary", t(MSG.check));
      check.type = "button";
      check.disabled = state.busy;
      check.addEventListener("click", () => run(async () => decide(await currentUser())));
      body.append(check, logoutLink());
    } else if (state.step === "notAdmin") {
      head.textContent = t(MSG.title);
      body.append(el("p", "message warn", t(MSG.adminOnly)), logoutLink());
    }
    if (state.error) body.append(el("p", "message error", state.error));
    container.replaceChildren(card);
  }

  function logoutLink() {
    const p = el("p", "auth-links");
    const btn = el("button", "link-btn", `${t(MSG.logout)} (${state.email})`);
    btn.type = "button";
    btn.addEventListener("click", () => { logout(); state.user = null; state.step = "email"; render(); });
    p.append(btn);
    return p;
  }

  onLanguageChange(render);
  render();
  run(async () => decide(await currentUser()));
}

// แถบผู้ใช้ที่ login แล้ว: อีเมล, ป้ายผู้ดูแลระบบ + ลิงก์จัดการผู้ใช้ (เฉพาะแอดมิน), ออกจากระบบ
export function renderUserBar(container, user, onLogout) {
  const draw = () => {
    const bar = el("div", "user-bar");
    bar.append(el("span", "muted", t(MSG.signedInAs)), el("b", "", user.email));
    if (user.isAdmin) {
      bar.append(el("span", "admin-pill", t(MSG.adminBadge)));
      if (!/admin\.html$/.test(location.pathname)) { // อยู่หน้าจัดการผู้ใช้แล้ว ไม่ต้องมีลิงก์
        const link = el("a", "", t(MSG.adminPage));
        link.href = "admin.html";
        bar.append(link);
      }
    }
    const out = el("button", "link-btn", t(MSG.logout));
    out.type = "button";
    out.addEventListener("click", () => { logout(); onLogout(); });
    bar.append(out);
    container.replaceChildren(bar);
  };
  draw();
  onLanguageChange(draw);
}
