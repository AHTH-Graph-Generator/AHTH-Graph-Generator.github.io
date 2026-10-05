// ============================================================
// admin.js — หน้าจัดการผู้ใช้ (admin.html) สำหรับผู้ดูแลระบบคนเดียว (ADMIN_EMAIL ใน Worker)
//   แท็บ: รออนุมัติ (ค่าเริ่มต้น) / อนุมัติแล้ว / ปฏิเสธ-ถอนสิทธิ์ / ยังไม่ขอสิทธิ์
//   ปุ่ม: อนุมัติ, ปฏิเสธ, ถอนสิทธิ์, ลบ (ถอนสิทธิ์ / ลบ ต้องยืนยันก่อน)
//   ทุกคำสั่งส่งไป Worker ซึ่งตรวจว่าเป็นแอดมินจริงทุกครั้ง — หน้านี้แค่แสดงผล
// ============================================================

import { initSite } from "./site.js";
import { t, onLanguageChange } from "./i18n.js";
import { showAuthGate, renderUserBar } from "./login-ui.js";
import { adminListUsers, adminAction, ApiError } from "./auth.js";
import { formatIso } from "./monitor-api.js";

const MSG = {
  tab_pending:  { th: "รออนุมัติ {n}", en: "Pending {n}" },
  tab_approved: { th: "อนุมัติแล้ว {n}", en: "Approved {n}" },
  tab_closed:   { th: "ปฏิเสธ / ถอนสิทธิ์ {n}", en: "Declined / revoked {n}" },
  tab_new:      { th: "ยังไม่ขอสิทธิ์ {n}", en: "Not requested {n}" },
  st_pending:   { th: "รออนุมัติ", en: "Pending" },
  st_approved:  { th: "อนุมัติแล้ว", en: "Approved" },
  st_rejected:  { th: "ปฏิเสธ", en: "Declined" },
  st_revoked:   { th: "ถอนสิทธิ์แล้ว", en: "Revoked" },
  st_new:       { th: "ยังไม่ขอสิทธิ์", en: "Not requested" },
  department:   { th: "แผนก", en: "Department" },
  reason:       { th: "เหตุผล", en: "Reason" },
  created:      { th: "เข้าสู่ระบบครั้งแรก", en: "First sign-in" },
  applied:      { th: "ขอสิทธิ์", en: "Requested" },
  decided:      { th: "ตัดสินล่าสุด", en: "Last decision" },
  approve:      { th: "✓ อนุมัติ", en: "✓ Approve" },
  reject:       { th: "✕ ปฏิเสธ", en: "✕ Decline" },
  revoke:       { th: "ถอนสิทธิ์", en: "Revoke" },
  delete:       { th: "ลบ", en: "Delete" },
  confirmRevoke:{ th: "ถอนสิทธิ์ของ {email}?\nผู้ใช้จะเข้าดูข้อมูลไม่ได้ภายในประมาณ 1 นาที", en: "Revoke access for {email}?\nThey will lose access within about a minute." },
  confirmDelete:{ th: "ลบ {email} ออกจากรายชื่อ?\nการลบย้อนกลับไม่ได้ (ผู้ใช้สมัครใหม่ได้)", en: "Delete {email} from the list?\nThis cannot be undone (they can sign up again)." },
  confirmReject:{ th: "ปฏิเสธคำขอของ {email}?", en: "Decline the request from {email}?" },
  empty:        { th: "ไม่มีผู้ใช้ในหมวดนี้", en: "No users in this group." },
  loading:      { th: "กำลังโหลดรายชื่อ…", en: "Loading users…" },
  failed:       { th: "ดำเนินการไม่สำเร็จ ({message})", en: "The action failed ({message})." },
  noName:       { th: "(ยังไม่ระบุชื่อ)", en: "(no name yet)" },
};
const TABS = [
  { key: "pending", statuses: ["pending"] },
  { key: "approved", statuses: ["approved"] },
  { key: "closed", statuses: ["rejected", "revoked"] },
  { key: "new", statuses: ["new"] },
];
// ปุ่มของแต่ละสถานะ
const ACTIONS = {
  pending: ["approve", "reject"],
  approved: ["revoke"],
  rejected: ["approve", "delete"],
  revoked: ["approve", "delete"],
  new: ["delete"],
};
const CONFIRM = { revoke: MSG.confirmRevoke, delete: MSG.confirmDelete, reject: MSG.confirmReject };

const $ = (id) => document.getElementById(id);
const state = { users: null, tab: "pending", busy: false, error: "" };

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

async function load() {
  state.error = "";
  try {
    state.users = await adminListUsers();
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) { location.reload(); return; }
    state.error = t(MSG.failed, { message: err.message });
  }
  render();
}

async function act(user, action) {
  if (CONFIRM[action] && !confirm(t(CONFIRM[action], { email: user.email }))) return;
  state.busy = true;
  render();
  try {
    await adminAction(user.email, action);
    await load();
  } catch (err) {
    state.error = t(MSG.failed, { message: err.message });
  }
  state.busy = false;
  render();
}

function render() {
  $("admin-error").hidden = !state.error;
  $("admin-error").textContent = state.error;
  const users = state.users || [];
  const inTab = (tab) => users.filter((u) => tab.statuses.includes(u.status));
  $("admin-tabs").replaceChildren(...TABS.map((tab) => {
    const b = el("button", "", t(MSG[`tab_${tab.key}`], { n: inTab(tab).length }));
    b.type = "button";
    b.setAttribute("aria-pressed", String(tab.key === state.tab));
    b.addEventListener("click", () => { state.tab = tab.key; render(); });
    return b;
  }));

  const list = $("admin-list");
  if (!state.users) { list.replaceChildren(el("p", "muted", t(MSG.loading))); return; }
  const shown = inTab(TABS.find((tab) => tab.key === state.tab))
    .sort((a, b) => (b.appliedAt || b.createdAt || "").localeCompare(a.appliedAt || a.createdAt || ""));
  if (!shown.length) { list.replaceChildren(el("p", "muted", t(MSG.empty))); return; }
  list.replaceChildren(...shown.map(userCard));
}

function userCard(user) {
  const card = el("article", "user-card");
  const head = el("div", "user-head");
  const who = el("div");
  who.append(el("strong", "", user.name || t(MSG.noName)), el("span", "muted", user.email));
  head.append(who, el("span", `user-status ${user.status}`, t(MSG[`st_${user.status}`] || { th: user.status, en: user.status })));
  card.append(head);

  const info = el("dl", "device-meta");
  const row = (label, value) => { if (value) info.append(el("dt", "", t(label)), el("dd", "", value)); };
  row(MSG.department, user.department);
  row(MSG.reason, user.reason);
  row(MSG.created, user.createdAt && formatIso(user.createdAt));
  row(MSG.applied, user.appliedAt && formatIso(user.appliedAt));
  row(MSG.decided, user.decidedAt && formatIso(user.decidedAt));
  card.append(info);

  const actions = el("div", "user-actions");
  for (const action of ACTIONS[user.status] || []) {
    const b = el("button", `btn ${action === "approve" ? "" : "secondary"} act-${action}`, t(MSG[action]));
    b.type = "button";
    b.disabled = state.busy;
    b.addEventListener("click", () => act(user, action));
    actions.append(b);
  }
  card.append(actions);
  return card;
}

initSite();
showAuthGate($("auth-gate"), {
  requireAdmin: true,
  onApproved: (user) => {
    $("admin-app").hidden = false;
    renderUserBar($("admin-user"), user, () => location.reload());
    $("admin-refresh").addEventListener("click", load);
    onLanguageChange(render);
    render();
    load();
  },
});
