const STORAGE_KEY = "luna-puppy-passport-v1";

const defaultState = {
  profile: { name: "Луна", breed: "Французький бульдог", birthDate: "2025-06-21", sex: "female", color: "", chip: "", notes: "Вид: собака. Дані перенесено з фото ветеринарного паспорту." },
  passport: { passportNumber: "UA 145168", vet: "", vetPhone: "", lastVisit: "2025-09-02", medicalNotes: "На наданих фото мікрочип не зазначений. Перевірте дані з оригіналом паспорту перед важливим візитом або поїздкою." },
  vaccinations: [
    { id: "vax-2025-06-11", date: "2025-06-11", validUntil: "2026-06-11", name: "Biocan DHPPi/L4", batch: "076032", productExpiry: "2027-07", note: "Зчитано з фото ветпаспорту" },
    { id: "vax-2025-09-02", date: "2025-09-02", validUntil: "2026-09-02", name: "Biocan DHPPi + L4R", batch: "165133", productExpiry: "2027-09", note: "Зчитано з фото ветпаспорту; звірити напис у документі" }
  ],
  events: [],
  reminders: []
};

let state = loadState();
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const eventMeta = {
  pee: { label: "Попісяла", icon: "💧" },
  poop: { label: "Покакала", icon: "◒" },
  walk: { label: "Вигул", icon: "🐾" },
  food: { label: "Годування", icon: "🍽️" }
};
const reminderMeta = {
  vaccine: { label: "Вакцинація", icon: "💉" },
  vet: { label: "Ветеринар", icon: "🩺" },
  parasites: { label: "Паразити", icon: "🦟" },
  grooming: { label: "Догляд", icon: "✂️" },
  custom: { label: "Інше", icon: "📌" }
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const profile = { ...defaultState.profile, ...(saved.profile || {}) };
    const passport = { ...defaultState.passport, ...(saved.passport || {}) };
    if (!profile.birthDate) profile.birthDate = defaultState.profile.birthDate;
    if (!passport.passportNumber) passport.passportNumber = defaultState.passport.passportNumber;
    if (!passport.lastVisit) passport.lastVisit = defaultState.passport.lastVisit;
    return {
      ...structuredClone(defaultState),
      ...saved,
      profile,
      passport,
      vaccinations: Array.isArray(saved.vaccinations) ? saved.vaccinations : structuredClone(defaultState.vaccinations),
      events: Array.isArray(saved.events) ? saved.events : [],
      reminders: Array.isArray(saved.reminders) ? saved.reminders : []
    };
  }
  catch { return structuredClone(defaultState); }
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function todayKey() { return new Date().toISOString().slice(0, 10); }
function formatDate(date, options = { day: "numeric", month: "long" }) { return new Intl.DateTimeFormat("uk-UA", options).format(new Date(`${date}T12:00:00`)); }
function formatTime(dateTime) { return new Intl.DateTimeFormat("uk-UA", { hour: "2-digit", minute: "2-digit" }).format(new Date(dateTime)); }
function escapeHtml(value = "") { return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }

function calculateAge(date) {
  if (!date) return "5,5 місяців";
  const birth = new Date(`${date}T12:00:00`); const now = new Date();
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + now.getMonth() - birth.getMonth();
  if (now.getDate() < birth.getDate()) months -= 1;
  return months < 12 ? `${Math.max(months, 0)} міс.` : `${Math.floor(months / 12)} р. ${months % 12} міс.`;
}

function render() {
  const profile = state.profile;
  $("#todayDate").textContent = new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long" }).format(new Date());
  $("#profileName").textContent = profile.name || "Луна";
  $("#agePill").textContent = calculateAge(profile.birthDate);
  $("#profileMeta").textContent = `${profile.breed || "Порода не додана"} · ${profile.birthDate ? `нар. ${formatDate(profile.birthDate, { day: "numeric", month: "long", year: "numeric" })}` : "дата народження не додана"}`;
  renderReminders(); renderTodayEvents(); renderInsights(); renderAllEvents(); renderVaccinations();
}

function renderVaccinations() {
  const host = $("#vaccineRecords"); if (!host) return;
  if (!state.vaccinations.length) {
    host.innerHTML = `<div class="timeline-empty">Записів про вакцинацію поки немає.</div>`;
    return;
  }
  host.innerHTML = [...state.vaccinations].sort((a, b) => b.date.localeCompare(a.date)).map((item) => `<article class="vaccine-record"><div class="vaccine-record-head"><strong>${escapeHtml(item.name)}</strong><span>${formatDate(item.date, { day: "numeric", month: "short", year: "numeric" })}</span></div><p>Дійсна до: <b>${formatDate(item.validUntil, { day: "numeric", month: "short", year: "numeric" })}</b> · серія ${escapeHtml(item.batch)}</p><small>Придатна до: ${escapeHtml(item.productExpiry)} · ${escapeHtml(item.note || "")}</small></article>`).join("");
}

function renderReminders() {
  const host = $("#upcomingReminders");
  const upcoming = [...state.reminders].filter((item) => item.date >= todayKey()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
  if (!upcoming.length) { host.innerHTML = `<div class="reminder-card"><div class="reminder-icon">✨</div><div><h3>Поки немає нагадувань</h3><p>Додайте наступну вакцинацію або візит до ветеринара.</p></div></div>`; return; }
  host.innerHTML = upcoming.map((item) => {
    const meta = reminderMeta[item.type] || reminderMeta.custom;
    const days = Math.ceil((new Date(`${item.date}T12:00:00`) - new Date(`${todayKey()}T12:00:00`)) / 86400000);
    const when = days === 0 ? "сьогодні" : days === 1 ? "завтра" : `через ${days} дн.`;
    return `<article class="reminder-card"><div class="reminder-icon">${meta.icon}</div><div><h3>${escapeHtml(item.title)}</h3><p class="${days <= 7 ? "due" : ""}">${formatDate(item.date, { day: "numeric", month: "short" })} · ${when}</p></div><button class="remove" data-remove-reminder="${item.id}" type="button" aria-label="Видалити">×</button></article>`;
  }).join("");
  $$('[data-remove-reminder]').forEach((button) => button.addEventListener("click", () => { state.reminders = state.reminders.filter((item) => item.id !== button.dataset.removeReminder); saveState(); render(); toast("Нагадування видалено"); }));
}

function eventMarkup(event, showDate = false) {
  const meta = eventMeta[event.type] || { label: "Подія", icon: "•" };
  const date = new Date(event.createdAt);
  return `<div class="event-row"><span class="event-time">${showDate ? `${formatDate(event.createdAt.slice(0, 10), { day: "numeric", month: "short" })}<br />` : ""}${formatTime(event.createdAt)}</span><span class="event-label">${meta.icon} ${meta.label}</span>${event.note ? `<span class="event-note">${escapeHtml(event.note)}</span>` : ""}<button class="delete-event" data-delete-event="${event.id}" type="button" aria-label="Видалити">×</button></div>`;
}

function renderTodayEvents() {
  const host = $("#todayEvents"); const events = state.events.filter((event) => event.createdAt.slice(0, 10) === todayKey()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  host.innerHTML = events.length ? events.map((event) => eventMarkup(event)).join("") : `<div class="timeline-empty">Ще немає записів. Натисніть кнопку події вище, коли Луна поїсть, погуляє або сходить у туалет.</div>`;
  bindDeleteEvents();
}

function renderAllEvents() {
  const filter = $("#historyFilter")?.value || "all"; const host = $("#allEvents"); if (!host) return;
  const events = state.events.filter((event) => filter === "all" || event.type === filter).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  host.innerHTML = events.length ? events.map((event) => eventMarkup(event, true)).join("") : `<div class="timeline-empty">Записів поки немає.</div>`;
  bindDeleteEvents();
}

function bindDeleteEvents() { $$('[data-delete-event]').forEach((button) => button.addEventListener("click", () => { state.events = state.events.filter((event) => event.id !== button.dataset.deleteEvent); saveState(); render(); toast("Запис видалено"); })); }
function renderInsights() {
  const todayEvents = state.events.filter((event) => event.createdAt.slice(0, 10) === todayKey());
  $("#eventCount").textContent = todayEvents.length; $("#vaccineCount").textContent = state.vaccinations.length;
  const next = state.reminders.filter((item) => item.date >= todayKey()).sort((a, b) => a.date.localeCompare(b.date))[0];
  $("#nextDays").textContent = next ? `${Math.max(0, Math.ceil((new Date(`${next.date}T12:00:00`) - new Date(`${todayKey()}T12:00:00`)) / 86400000))} дн.` : "—";
}

function addEvent(type) { state.events.push({ id: crypto.randomUUID(), type, createdAt: new Date().toISOString(), note: "" }); saveState(); render(); toast(`${eventMeta[type].label} — записано`); }
function localIso(date, time) { const value = new Date(`${date}T${time}:00`); return Number.isNaN(value.getTime()) ? null : value.toISOString(); }
function currentTimeValue() { const now = new Date(); return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`; }
function toast(message) { const node = $("#toast"); node.textContent = message; node.classList.add("show"); setTimeout(() => node.classList.remove("show"), 2200); }
function openModal(id) { const node = document.getElementById(id); if (node) node.hidden = false; }
function closeModal(node) { node.hidden = true; }
function fillForm(form, data) { Object.entries(data).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value || ""; }); }

$$('[data-event]').forEach((button) => button.addEventListener("click", () => addEvent(button.dataset.event)));
$$('[data-open]').forEach((button) => button.addEventListener("click", () => { openModal(button.dataset.open); if (button.dataset.open === "profileModal") fillForm($("#profileForm"), state.profile); if (button.dataset.open === "passportModal") fillForm($("#passportForm"), state.passport); if (button.dataset.open === "eventModal") { $("#eventForm").reset(); $("#eventForm").elements.date.value = todayKey(); $("#eventForm").elements.time.value = currentTimeValue(); } }));
$$('[data-close]').forEach((button) => button.addEventListener("click", () => closeModal(button.closest(".modal-backdrop"))));
$$('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener("click", (event) => { if (event.target === backdrop) closeModal(backdrop); }));

$("#profileForm").addEventListener("submit", (event) => { event.preventDefault(); state.profile = Object.fromEntries(new FormData(event.target)); saveState(); render(); closeModal($("#profileModal")); toast("Профіль Луни збережено"); });
$("#passportForm").addEventListener("submit", (event) => { event.preventDefault(); state.passport = Object.fromEntries(new FormData(event.target)); saveState(); closeModal($("#passportModal")); toast("Дані ветпаспорту збережено"); });
$("#reminderForm").addEventListener("submit", (event) => { event.preventDefault(); const form = Object.fromEntries(new FormData(event.target)); state.reminders.push({ ...form, id: crypto.randomUUID() }); saveState(); event.target.reset(); closeModal($("#reminderModal")); render(); toast("Нагадування додано"); });
$("#eventForm").addEventListener("submit", (event) => { event.preventDefault(); const form = Object.fromEntries(new FormData(event.target)); const createdAt = localIso(form.date, form.time); if (!createdAt) return toast("Перевірте дату і час"); state.events.push({ id: crypto.randomUUID(), type: form.type, createdAt, note: form.note || "" }); saveState(); event.target.reset(); closeModal($("#eventModal")); render(); toast(`${eventMeta[form.type].label} — записано`); });
$("#historyFilter").addEventListener("change", renderAllEvents);
$("#clearEvents").addEventListener("click", () => { if (confirm("Очистити події лише за сьогодні?")) { state.events = state.events.filter((event) => event.createdAt.slice(0, 10) !== todayKey()); saveState(); render(); toast("Події за сьогодні очищено"); } });
$("#exportButton").addEventListener("click", () => { const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `luna-vetpassport-${todayKey()}.json`; link.click(); URL.revokeObjectURL(link.href); toast("Резервну копію завантажено"); });
$("#notifyButton").addEventListener("click", async () => { if (!("Notification" in window)) return toast("Цей браузер не підтримує сповіщення"); const permission = await Notification.requestPermission(); toast(permission === "granted" ? "Нагадування дозволено" : "Дозвіл не надано"); });

render();
