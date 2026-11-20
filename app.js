const STORAGE_KEY = "luna-puppy-passport-v1";


const defaultState = {
  profile: { name: "Луна", breed: "Французький бульдог", birthDate: "2026-06-03", sex: "female", color: "", chip: "", notes: "Вид: собака. Дані перенесено з фото ветеринарного паспорту." },
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
    if (!profile.birthDate || profile.birthDate === "2025-06-21") profile.birthDate = defaultState.profile.birthDate;
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
