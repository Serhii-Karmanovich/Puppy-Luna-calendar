const STORAGE_KEY = "luna-puppy-passport-v1";
const CLOUD_STORAGE_KEY = "luna-household-id";
const PENDING_INVITE_KEY = "luna-pending-invite-v2";
const cloudConfig = window.LUNA_SUPABASE_CONFIG || {};
let cloudClient = null;
let cloudSession = null;
let cloudHouseholdId = localStorage.getItem(CLOUD_STORAGE_KEY) || "";
let cloudRole = "";
let cloudChannel = null;
let cloudApplying = false;
let cloudSaveTimer = null;
let cloudLastUpdatedAt = null;
let cloudSaveInFlight = false;
let cloudSaveQueued = false;

const defaultState = {
  profile: { name: "Луна", breed: "Французький бульдог", birthDate: "2026-06-03", sex: "female", color: "", chip: "", notes: "Вид: собака. Дані перенесено з фото ветеринарного паспорту." },
  weightRecords: [{ id: "weight-2026-11-21-78", date: "2026-11-21", time: "", weight: 7.8, note: "Перше вимірювання" }],
  passport: { passportNumber: "UA 145168", vet: "", vetPhone: "", lastVisit: "2026-09-02", medicalNotes: "На наданих фото мікрочип не зазначений. Перевірте дані з оригіналом паспорту перед важливим візитом або поїздкою." },
  vaccinations: [
    { id: "vax-2026-09-02-rabies", date: "2026-09-02", validUntil: "2027-09-02", name: "Biocan R (сказ)", batch: "165133", productExpiry: "2027-09", note: "Перша вакцинація зі сторінки щеплень від сказу" },
    { id: "vax-2026-06-11", date: "2026-06-11", validUntil: "2027-06-11", name: "Biocan DHPPi/L4", batch: "076032", productExpiry: "2027-07", note: "Друга вакцинація; зчитано з фото ветпаспорту" },
    { id: "vax-2026-09-02", date: "2026-09-02", validUntil: "2027-09-02", name: "Biocan DHPPi + L4R", batch: "165133", productExpiry: "2027-09", note: "Третя вакцинація; зчитано з фото ветпаспорту" }
  ],
  deletedIds: [],
  events: [
    { id: "event-2026-11-20-0700-walk", type: "walk", createdAt: "2026-11-20T05:00:00.000Z", note: "07:00–07:30; на вулиці; попісяла і покакала" },
    { id: "event-2026-11-20-0740-food", type: "food", createdAt: "2026-11-20T05:40:00.000Z", note: "07:40–07:50" },
    { id: "event-2026-11-20-1110-walk", type: "walk", createdAt: "2026-11-20T09:10:00.000Z", note: "11:10–11:40; на вулиці; попісяла" },
    { id: "event-2026-11-20-1230-pee", type: "pee", createdAt: "2026-11-20T10:30:00.000Z", note: "Вдома, на пеленку" },
    { id: "event-2026-11-20-1235-food", type: "food", createdAt: "2026-11-20T10:35:00.000Z", note: "Другий прийом їжі" },
    { id: "event-2026-11-20-1400-food", type: "food", createdAt: "2026-11-20T12:00:00.000Z", note: "Половинка від попереднього прийому" },
    { id: "event-2026-11-20-1415-walk", type: "walk", createdAt: "2026-11-20T12:15:00.000Z", note: "14:15–14:40; на вулиці; лише попісяла" }
  ],
  reminders: []
};

let state = loadState();
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const PUBLIC_APP_URL = "https://serhii-karmanovich.github.io/Puppy-Luna-calendar/";

function authRedirectUrl() {
  const base = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname) ? PUBLIC_APP_URL : `${window.location.origin}${window.location.pathname}`;
  const token = sessionStorage.getItem(PENDING_INVITE_KEY);
  return token ? `${base}?invite=${encodeURIComponent(token)}` : base;
}

function rememberInviteFromUrl() {
  try {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("invite");
    if (!token) return;
    sessionStorage.setItem(PENDING_INVITE_KEY, token.trim());
    url.searchParams.delete("invite");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {}
}
function pendingInviteToken() { return sessionStorage.getItem(PENDING_INVITE_KEY) || ""; }
function extractInviteToken(value = "") {
  const input = value.trim();
  if (!input) return "";
  try { return new URL(input).searchParams.get("invite")?.trim() || input; } catch { return input; }
}
rememberInviteFromUrl();

const eventMeta = {
  pee: { label: "Попісяла", icon: "💧" },
  poop: { label: "Покакала", icon: "◒" },
  walk: { label: "Вигул", icon: "🐾" },
  food: { label: "Годування", icon: "🍽️" },
  water: { label: "Вода", icon: "Вода" },
  wake: { label: "Пробудження", icon: "Сон" },
  play: { label: "Гра / активність", icon: "Гра" }
};
const reminderMeta = {
  vaccine: { label: "Вакцинація", icon: "💉" },
  vet: { label: "Ветеринар", icon: "🩺" },
  parasites: { label: "Паразити", icon: "🦟" },
  grooming: { label: "Догляд", icon: "✂️" },
  custom: { label: "Інше", icon: "📌" }
};
const dailyTips = [
  { text: "Маленькі послідовні дії щодня формують сильні звички.", reference: "Порада дня · за мотивами принципів Брайана Трейсі" },
  { text: "Спочатку плануйте найважливіше: сон, годування та вигул.", reference: "Порада дня · за мотивами принципів Брайана Трейсі" },
  { text: "Стабільний графік допомагає цуценяті почуватися спокійніше.", reference: "Порада дня · за мотивами принципів Брайана Трейсі" },
  { text: "Відзначайте маленькі успіхи — так формується бажана поведінка.", reference: "Порада дня · за мотивами принципів Брайана Трейсі" },
  { text: "Коли є план, турбота стає простішою для всієї сім’ї.", reference: "Порада дня · за мотивами принципів Брайана Трейсі" },
  { text: "Регулярність важливіша за ідеальність.", reference: "Порада дня · за мотивами принципів Брайана Трейсі" },
  { text: "Один зрозумілий крок зараз кращий за довгий список справ.", reference: "Порада дня · за мотивами принципів Брайана Трейсі" },
  { text: "Спостерігайте за ритмом Луни й коригуйте графік за фактами.", reference: "Порада дня · за мотивами принципів Брайана Трейсі" }
];

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const profile = { ...defaultState.profile, ...(saved.profile || {}) };
    const passport = { ...defaultState.passport, ...(saved.passport || {}) };
    if (!profile.birthDate || profile.birthDate === "2025-06-21") profile.birthDate = defaultState.profile.birthDate;
    if (!passport.passportNumber) passport.passportNumber = defaultState.passport.passportNumber;
    if (!passport.lastVisit || passport.lastVisit === "2025-09-02") passport.lastVisit = defaultState.passport.lastVisit;
    return {
      ...structuredClone(defaultState),
      ...saved,
      profile,
      passport,
      weightRecords: Array.isArray(saved.weightRecords) ? saved.weightRecords : structuredClone(defaultState.weightRecords),
      vaccinations: Array.isArray(saved.vaccinations) ? saved.vaccinations : structuredClone(defaultState.vaccinations),
      deletedIds: Array.isArray(saved.deletedIds) ? saved.deletedIds : [],
      events: expandToiletNotes(Array.isArray(saved.events) && saved.events.length ? saved.events : structuredClone(defaultState.events)),
      reminders: normalizeReminders(Array.isArray(saved.reminders) ? saved.reminders : [])
    };
  }
  catch { return structuredClone(defaultState); }
}
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!cloudApplying) {
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(() => saveCloudState(), 350);
  }
}
function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, "0"); const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function todayKey() { return localDateKey(); }
function formatDate(date, options = { day: "numeric", month: "long" }) { return new Intl.DateTimeFormat("uk-UA", options).format(new Date(`${date}T12:00:00`)); }
function formatTime(dateTime) { return new Intl.DateTimeFormat("uk-UA", { hour: "2-digit", minute: "2-digit" }).format(new Date(dateTime)); }
function escapeHtml(value = "") { return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }

function addDaysToDate(date, days) { const next = new Date(`${date}T12:00:00`); next.setDate(next.getDate() + days); return localDateKey(next); }
function normalizeReminders(reminders = []) {
  return reminders.map((item) => {
    const interval = Number(item.repeat);
    if (!item.date || !interval || item.repeat === "none") return item;
    let date = item.date;
    while (date < todayKey()) date = addDaysToDate(date, interval);
    return date === item.date ? item : { ...item, date };
  });
}

function calculateAge(date) {
  if (!date) return "—";
  const birth = new Date(`${date}T12:00:00`); const now = new Date();
  let years = now.getFullYear() - birth.getFullYear();
  let months = now.getMonth() - birth.getMonth();
  let days = now.getDate() - birth.getDate();
  if (days < 0) { months -= 1; days += new Date(now.getFullYear(), now.getMonth(), 0).getDate(); }
  if (months < 0) { years -= 1; months += 12; }
  return `${Math.max(years, 0)} р. ${Math.max(months, 0)} міс. ${Math.max(days, 0)} дн.`;
}

function renderDailyQuote() {
  const seed = todayKey().split("-").reduce((sum, part) => sum + Number(part), 0);
  const quote = dailyTips[seed % dailyTips.length];
  $("#dailyQuoteText").textContent = quote.text;
  $("#dailyQuoteReference").textContent = `— ${quote.reference}`;
}

function render() {
  const profile = state.profile;
  $("#todayDate").textContent = new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long" }).format(new Date());
  renderDailyQuote();
  $("#profileName").textContent = profile.name || "Луна";
  $("#agePill").textContent = calculateAge(profile.birthDate);
  $("#profileMeta").textContent = `${profile.breed || "Порода не додана"} · ${profile.birthDate ? `нар. ${formatDate(profile.birthDate, { day: "numeric", month: "long", year: "numeric" })}` : "дата народження не додана"}`;
  renderWeight(); renderToiletInsights(); renderReminders(); renderTodayEvents(); renderInsights(); renderAllEvents(); renderVaccinations();
}

function formatWeight(value) { return Number(value).toLocaleString("uk-UA", { minimumFractionDigits: 1, maximumFractionDigits: 2 }); }
function weightSort(a, b) { return `${b.date}T${b.time || "00:00"}`.localeCompare(`${a.date}T${a.time || "00:00"}`); }
function renderWeight() {
  const records = [...(state.weightRecords || [])].filter((item) => item?.date && Number(item.weight) > 0).sort(weightSort);
  const value = $("#weightValue"); const date = $("#weightDate"); const change = $("#weightChange"); const history = $("#weightHistory");
  if (!value) return;
  if (!records.length) { value.textContent = "—"; date.textContent = "вимірювання ще не додані"; change.textContent = "Додайте першу вагу"; if (history) history.innerHTML = `<div class="timeline-empty">Вимірювань поки немає.</div>`; return; }
  const latest = records[0]; const previous = records[1]; const difference = previous ? Number(latest.weight) - Number(previous.weight) : null;
  value.textContent = `${formatWeight(latest.weight)} кг`;
  date.textContent = `останнє вимірювання · ${formatDate(latest.date, { day: "numeric", month: "long", year: "numeric" })}`;
  change.textContent = difference === null ? "Перше вимірювання" : `${difference > 0 ? "+" : ""}${formatWeight(difference)} кг від попереднього`;
  if (history) history.innerHTML = records.map((item, index) => `<article class="weight-record"><div><strong>${formatWeight(item.weight)} кг</strong><span>${formatDate(item.date, { day: "numeric", month: "long", year: "numeric" })}${item.time ? ` · ${escapeHtml(item.time)}` : ""}</span>${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}</div><button class="delete-event" data-delete-weight="${item.id}" type="button" aria-label="Видалити вимірювання">×</button></article>`).join("");
  $$('[data-delete-weight]').forEach((button) => button.addEventListener("click", () => { const id = button.dataset.deleteWeight; state.deletedIds = [...new Set([...(state.deletedIds || []), id])]; state.weightRecords = state.weightRecords.filter((item) => item.id !== id); saveState(); render(); toast("Вимірювання видалено"); }));
}

function expandToiletNotes(events = []) {
  const existing = new Set(events.map((event) => event?.id));
  const derived = [];
  events.forEach((event) => {
    const note = String(event?.note || "").toLowerCase();
    if (event?.type !== "walk" || (!note.includes("попісяла") && !note.includes("покакала"))) return;
    const location = note.includes("вдома") || note.includes("пелен") ? "inside" : note.includes("вулиц") ? "outside" : "";
    [["pee", "попісяла"], ["poop", "покакала"]].forEach(([type, word]) => {
      if (!note.includes(word)) return;
      const id = `toilet-derived-${event.id}-${type}`;
      if (existing.has(id)) return;
      existing.add(id);
      derived.push({ id, type, createdAt: event.createdAt, note: `Зафіксовано у примітці до вигулу`, location, sourceEventId: event.id });
    });
  });
  return [...events, ...derived];
}

function median(values = []) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const toiletTriggers = {
  wake: { label: "після пробудження", types: ["wake"], maxHours: 3 },
  food: { label: "після годування", types: ["food"], maxHours: 4 },
  water: { label: "після води", types: ["water"], maxHours: 3 },
  play: { label: "після гри або активності", types: ["play", "walk"], maxHours: 3 }
};
const weekdayLabels = ["неділю", "понеділок", "вівторок", "середу", "четвер", "п’ятницю", "суботу"];

function percentile(values = [], ratio = 0.5) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function groupStats(samples = []) {
  const delays = samples.map((sample) => sample.delayMinutes).filter((minutes) => Number.isFinite(minutes) && minutes >= 1 && minutes <= 360);
  return { count: delays.length, median: median(delays), low: percentile(delays, 0.25), high: percentile(delays, 0.75) };
}

function findTriggerForToilet(toilet, allEvents) {
  const toiletTime = new Date(toilet.createdAt).getTime();
  const explicit = toilet.context && toiletTriggers[toilet.context];
  const candidates = Object.entries(toiletTriggers).flatMap(([key, meta]) => allEvents.filter((event) => meta.types.includes(event.type)).map((event) => ({ key, event, delta: toiletTime - new Date(event.createdAt).getTime(), max: meta.maxHours * 3600000 })));
  const valid = candidates.filter((item) => item.delta >= 60000 && item.delta <= item.max);
  if (!valid.length) return null;
  const preferred = explicit ? valid.filter((item) => item.key === toilet.context) : valid;
  const pool = preferred.length ? preferred : valid;
  return pool.sort((a, b) => a.delta - b.delta)[0];
}

function toiletAnalytics(days = 7) {
  const end = new Date();
  const start = new Date(end); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (days - 1));
  const periodEvents = state.events.filter((event) => {
    const time = new Date(event.createdAt).getTime();
    return Number.isFinite(time) && time >= start.getTime() && time <= end.getTime();
  });
  const records = periodEvents.filter((event) => ["pee", "poop"].includes(event.type)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const allEvents = state.events.filter((event) => Number.isFinite(new Date(event.createdAt).getTime()));
  const toiletTimes = records.map((event) => new Date(event.createdAt).getTime());
  const intervals = toiletTimes.slice(1).map((time, index) => (time - toiletTimes[index]) / 3600000).filter((hours) => hours >= 0.25 && hours <= 12);
  const samples = records.map((event, index) => {
    const trigger = findTriggerForToilet(event, allEvents);
    const previous = records[index - 1];
    return { event, type: event.type, location: event.location || "", triggerKey: trigger?.key || "", delayMinutes: trigger ? trigger.delta / 60000 : null, previousInterval: previous ? (new Date(event.createdAt).getTime() - new Date(previous.createdAt).getTime()) / 60000 : null };
  });
  const triggerGroups = Object.fromEntries(Object.keys(toiletTriggers).flatMap((key) => [[`${key}-all`, groupStats(samples.filter((sample) => sample.triggerKey === key))], [`${key}-pee`, groupStats(samples.filter((sample) => sample.triggerKey === key && sample.type === "pee"))], [`${key}-poop`, groupStats(samples.filter((sample) => sample.triggerKey === key && sample.type === "poop"))]]));
  const hourCounts = records.reduce((counts, event) => { const hour = new Date(event.createdAt).getHours(); counts[hour] = (counts[hour] || 0) + 1; return counts; }, {});
  const weekdayCounts = records.reduce((counts, event) => { const day = new Date(event.createdAt).getDay(); counts[day] = (counts[day] || 0) + 1; return counts; }, {});
  const locationCounts = records.reduce((counts, event) => { if (event.location) counts[event.location] = (counts[event.location] || 0) + 1; return counts; }, {});
  const last = records.at(-1) || null;
  const typicalInterval = median(intervals);
  let nextWindow = last && typicalInterval ? new Date(new Date(last.createdAt).getTime() + typicalInterval * 3600000) : null;
  let guard = 0; while (nextWindow && nextWindow <= end && guard < 24) { nextWindow = new Date(nextWindow.getTime() + typicalInterval * 3600000); guard += 1; }
  const recentTrigger = [...state.events].filter((event) => toiletTriggers[event.type] && new Date(event.createdAt) <= end).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
  const recentKey = recentTrigger ? Object.keys(toiletTriggers).find((key) => toiletTriggers[key].types.includes(recentTrigger.type)) : "";
  const recentGroup = recentKey ? triggerGroups[`${recentKey}-all`] : null;
  return { records, samples, peeCount: records.filter((event) => event.type === "pee").length, poopCount: records.filter((event) => event.type === "poop").length, typicalInterval, foodDelay: triggerGroups["food-all"]?.median || null, triggerGroups, hourCounts, weekdayCounts, locationCounts, nextWindow, recentTrigger, recentKey, recentGroup, confidence: records.length >= 14 ? "висока" : records.length >= 7 ? "середня" : "низька" };
}

function formatHours(hours) {
  if (!Number.isFinite(hours)) return "—";
  if (hours < 1) return `${Math.round(hours * 60)} хв`;
  return `${hours.toLocaleString("uk-UA", { maximumFractionDigits: 1 })} год`;
}

function formatMinutesRange(stats) {
  if (!stats?.median) return "—";
  const low = Math.max(5, Math.round(stats.low || stats.median - 10)); const high = Math.max(low, Math.round(stats.high || stats.median + 10));
  return `${low}–${high} хв`;
}

function renderToiletInsights() {
  const recommendation = $("#toiletRecommendation"); const stats = $("#toiletStats"); const patterns = $("#toiletPatterns"); const hourly = $("#toiletHourly");
  if (!recommendation || !stats || !patterns || !hourly) return;
  const period = Number($("#toiletPeriod")?.value || 7); const data = toiletAnalytics(period);
  const recentTriggerTime = data.recentTrigger ? new Date(data.recentTrigger.createdAt).getTime() : 0;
  const elapsed = recentTriggerTime ? (Date.now() - recentTriggerTime) / 60000 : null;
  const recentStats = data.recentKey ? data.triggerGroups[`${data.recentKey}-all`] : null;
  if (data.records.length < 3) {
    recommendation.innerHTML = `<strong>Поки замало даних для персонального прогнозу.</strong><small>Перші 7–14 днів система навчається. Записуйте сон, їжу, воду, активність і окремо сечовипускання та дефекацію.</small>`;
  } else if (recentStats?.median && elapsed >= 0 && elapsed <= 240) {
    const windowText = formatMinutesRange(recentStats); const typeText = data.triggerKey === "food" ? "сечовипускання" : "туалет";
    const inWindow = elapsed >= (recentStats.low || recentStats.median - 10) && elapsed <= (recentStats.high || recentStats.median + 10);
    recommendation.innerHTML = inWindow ? `<strong>Зараз імовірність ${typeText} підвищена.</strong><small>${toiletTriggers[data.recentKey].label}: у Луни найчастіше через ${windowText}. Вигул краще запланувати зараз.</small>` : `<strong>Після ${toiletTriggers[data.recentKey].label} рекомендований вигул через ${windowText}.</strong><small>Минуло приблизно ${Math.round(elapsed)} хв. Впевненість: ${recentStats.count >= 10 ? "висока" : recentStats.count >= 5 ? "середня" : "низька"}.</small>`;
  } else if (data.nextWindow) {
    const from = new Date(data.nextWindow.getTime() - 15 * 60000); const to = new Date(data.nextWindow.getTime() + 15 * 60000);
    recommendation.innerHTML = `<strong>Орієнтовне наступне вікно вигулу: ${formatTime(from)}–${formatTime(to)}</strong><small>За попереднім туалетом. Впевненість: ${data.confidence}. Рекомендація оновлюється з новими записами.</small>`;
  } else {
    recommendation.innerHTML = `<strong>Ритм формується.</strong><small>Записуйте події послідовно — система зможе порівнювати тригери та попередній туалет.</small>`;
  }
  const outside = data.locationCounts.outside || 0; const inside = data.locationCounts.inside || 0; const knownLocations = outside + inside;
  stats.innerHTML = `<div class="toilet-stat"><strong>${data.peeCount}</strong><span>сечовипускань</span></div><div class="toilet-stat"><strong>${data.poopCount}</strong><span>дефекацій</span></div><div class="toilet-stat"><strong>${formatHours(data.typicalInterval)}</strong><span>медіанний інтервал</span></div><div class="toilet-stat"><strong>${data.foodDelay ? `${Math.round(data.foodDelay)} хв` : "—"}</strong><span>після їжі</span></div><div class="toilet-stat"><strong>${knownLocations ? `${Math.round((outside / knownLocations) * 100)}%` : "—"}</strong><span>на вулиці</span></div>`;
  const patternCards = Object.entries(toiletTriggers).map(([key, meta]) => ({ key, meta, stats: data.triggerGroups[`${key}-all`] })).filter((item) => item.stats.count).sort((a, b) => b.stats.count - a.stats.count);
  const weekday = Object.entries(data.weekdayCounts).sort(([, a], [, b]) => b - a)[0];
  patterns.innerHTML = patternCards.length || weekday ? `<div class="toilet-pattern-title">Закономірності</div><div class="toilet-pattern-list">${patternCards.slice(0, 4).map(({ meta, stats: item }) => `<span><b>${meta.label}</b><small>${formatMinutesRange(item)} · ${item.count} спостережень</small></span>`).join("")}${weekday ? `<span><b>Найчастіше у ${weekdayLabels[Number(weekday[0])]}</b><small>${weekday[1]} записів у вибраному періоді</small></span>` : ""}</div>` : "";
  const hours = Object.entries(data.hourCounts).sort(([, a], [, b]) => b - a).slice(0, 5); const max = Math.max(...hours.map(([, count]) => count), 1);
  hourly.innerHTML = hours.length ? `<div class="toilet-hourly-title">Найчастіші години туалету</div>${hours.map(([hour, count]) => `<div class="toilet-hour-row"><span>${String(hour).padStart(2, "0")}:00</span><i style="--bar-width:${Math.round((count / max) * 100)}%"></i><b>${count}</b></div>`).join("")}` : "";
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
  $$('[data-remove-reminder]').forEach((button) => button.addEventListener("click", () => { const id = button.dataset.removeReminder; state.deletedIds = [...new Set([...(state.deletedIds || []), id])]; state.reminders = state.reminders.filter((item) => item.id !== id); saveState(); render(); toast("Нагадування видалено"); }));
}

function eventMarkup(event, showDate = false) {
  const meta = eventMeta[event.type] || { label: "Подія", icon: "•" };
  return `<div class="event-row"><span class="event-time">${showDate ? `${formatDate(localDateKey(event.createdAt), { day: "numeric", month: "short" })}<br />` : ""}${formatTime(event.createdAt)}</span><span class="event-label">${meta.icon} ${meta.label}</span>${event.note ? `<span class="event-note">${escapeHtml(event.note)}</span>` : ""}<button class="delete-event" data-delete-event="${event.id}" type="button" aria-label="Видалити">×</button></div>`;
}

function renderTodayEvents() {
  const host = $("#todayEvents"); const events = state.events.filter((event) => localDateKey(event.createdAt) === todayKey()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  host.innerHTML = events.length ? events.map((event) => eventMarkup(event)).join("") : `<div class="timeline-empty">Ще немає записів. Натисніть кнопку події вище, коли Луна поїсть, погуляє або сходить у туалет.</div>`;
  bindDeleteEvents();
}

function renderAllEvents() {
  const filter = $("#historyFilter")?.value || "all"; const host = $("#allEvents"); if (!host) return;
  const events = state.events.filter((event) => filter === "all" || event.type === filter).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  host.innerHTML = events.length ? events.map((event) => eventMarkup(event, true)).join("") : `<div class="timeline-empty">Записів поки немає.</div>`;
  bindDeleteEvents();
}

function bindDeleteEvents() { $$('[data-delete-event]').forEach((button) => button.addEventListener("click", () => { const id = button.dataset.deleteEvent; state.deletedIds = [...new Set([...(state.deletedIds || []), id])]; state.events = state.events.filter((event) => event.id !== id); saveState(); render(); toast("Запис видалено"); })); }
function renderInsights() {
  const todayEvents = state.events.filter((event) => localDateKey(event.createdAt) === todayKey());
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

function cloudConfigured() { return Boolean(cloudConfig.url && cloudConfig.anonKey && window.supabase?.createClient); }
function cloudStatus(message) { const node = $("#cloudStatus"); if (node) node.textContent = message; }
function renderCloudUi() {
  const button = $("#syncButton"); const form = $("#authForm"); const actions = $("#familyActions"); const info = $("#familyInfo"); const gate = $("#accessGate"); const gateTitle = $("#accessGateTitle"); const gateText = $("#accessGateText"); const createInvite = $("#createInviteButton"); const inviteResult = $("#inviteResult"); const inviteJoinFields = $("#inviteJoinFields");
  if (!cloudConfigured()) {
    button.textContent = "Підключити"; form.hidden = true; actions.hidden = true;
    document.body.classList.remove("app-locked"); if (gate) gate.hidden = true;
    cloudStatus("Потрібно додати Project URL і anon key у supabase-config.js."); return;
  }
  if (!cloudSession) {
    button.textContent = "Увійти"; form.hidden = false; actions.hidden = true;
    document.body.classList.add("app-locked"); if (gate) gate.hidden = false; if (gateTitle) gateTitle.textContent = pendingInviteToken() ? "Вас запросили до сім’ї Луни" : "Щоденник Луни доступний за запрошенням"; if (gateText) gateText.textContent = pendingInviteToken() ? "Створіть акаунт або увійдіть, щоб прийняти персональне запрошення." : "Увійдіть або створіть акаунт за персональним посиланням від власника сім’ї Луни.";
    cloudStatus(pendingInviteToken() ? "Запрошення знайдено. Увійдіть або створіть акаунт." : "Для доступу до даних потрібне запрошення від власника."); return;
  }
  const hasAccess = Boolean(cloudHouseholdId);
  button.textContent = hasAccess ? "Сім’я" : "Налаштувати"; form.hidden = true; actions.hidden = false;
  document.body.classList.toggle("app-locked", !hasAccess); if (gate) gate.hidden = hasAccess; if (gateTitle && !hasAccess) gateTitle.textContent = "Акаунт створено, але доступ ще не надано"; if (gateText && !hasAccess) gateText.textContent = "Відкрийте персональне посилання від власника сім’ї Луни або вставте його нижче.";
  info.textContent = hasAccess ? `Синхронізація активна. Ви ${cloudRole === "owner" ? "власник" : "учасник"} сім’ї Луни.` : "Для доступу потрібне персональне посилання-запрошення.";
  $("#createFamilyButton").hidden = hasAccess;
  if (createInvite) createInvite.hidden = !hasAccess || cloudRole !== "owner";
  if (inviteResult && !hasAccess) inviteResult.hidden = true;
  if (inviteJoinFields) inviteJoinFields.hidden = hasAccess;
  cloudStatus(hasAccess ? "Дані Луни синхронізуються через Supabase." : "Акаунт підключено. Очікується запрошення.");
}
function normalizeCloudState(saved = {}) {
  const profile = { ...defaultState.profile, ...(saved.profile || {}) };
  const passport = { ...defaultState.passport, ...(saved.passport || {}) };
  const deletedIds = Array.isArray(saved.deletedIds) ? saved.deletedIds : [];
  return { ...structuredClone(defaultState), ...saved, profile, passport, weightRecords: (Array.isArray(saved.weightRecords) ? saved.weightRecords : structuredClone(defaultState.weightRecords)).filter((item) => !deletedIds.includes(item.id)), vaccinations: Array.isArray(saved.vaccinations) ? saved.vaccinations : structuredClone(defaultState.vaccinations), deletedIds, events: expandToiletNotes((Array.isArray(saved.events) ? saved.events : []).filter((item) => !deletedIds.includes(item.id))), reminders: normalizeReminders((Array.isArray(saved.reminders) ? saved.reminders : []).filter((item) => !deletedIds.includes(item.id))) };
}
function mergeItems(localItems = [], remoteItems = [], deletedIds = []) {
  const merged = new Map(remoteItems.filter((item) => item?.id).map((item) => [item.id, item]));
  localItems.filter((item) => item?.id && !merged.has(item.id)).forEach((item) => merged.set(item.id, item));
  return [...merged.values()].filter((item) => !deletedIds.includes(item.id));
}
function mergeCloudStates(remoteSaved = {}, localSaved = {}) {
  const remote = normalizeCloudState(remoteSaved);
  const local = normalizeCloudState(localSaved);
  const deletedIds = [...new Set([...(remote.deletedIds || []), ...(local.deletedIds || [])])];
  return {
    ...remote,
    profile: remote.profile,
    passport: remote.passport,
    weightRecords: mergeItems(local.weightRecords, remote.weightRecords, deletedIds),
    vaccinations: mergeItems(local.vaccinations, remote.vaccinations, deletedIds),
    deletedIds,
    events: mergeItems(local.events, remote.events, deletedIds),
    reminders: normalizeReminders(mergeItems(local.reminders, remote.reminders, deletedIds))
  };
}
async function saveCloudState() {
  if (!cloudClient || !cloudSession || !cloudHouseholdId || cloudApplying) return;
  if (cloudSaveInFlight) { cloudSaveQueued = true; return; }
  cloudSaveInFlight = true;
  try {
    let result = await cloudClient.rpc("save_luna_state", { target_household: cloudHouseholdId, payload: state, expected_updated_at: cloudLastUpdatedAt });
    if (result.error?.message?.includes("LUNA_STATE_CONFLICT")) {
      const remote = await cloudClient.from("luna_state").select("data, updated_at").eq("household_id", cloudHouseholdId).maybeSingle();
      if (remote.error || !remote.data) throw remote.error || new Error("Не вдалося отримати актуальні дані сім’ї.");
      state = mergeCloudStates(remote.data.data, state);
      cloudLastUpdatedAt = remote.data.updated_at;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      render();
      result = await cloudClient.rpc("save_luna_state", { target_household: cloudHouseholdId, payload: state, expected_updated_at: cloudLastUpdatedAt });
    }
    if (result.error) throw result.error;
    const saved = Array.isArray(result.data) ? result.data[0] : result.data;
    cloudLastUpdatedAt = saved?.updated_at || cloudLastUpdatedAt;
    cloudStatus("Дані Луни синхронізовано.");
  } catch (error) {
    cloudStatus(`Не вдалося синхронізувати: ${error.message || "перевірте з’єднання"}`);
  } finally {
    cloudSaveInFlight = false;
    if (cloudSaveQueued) { cloudSaveQueued = false; setTimeout(() => saveCloudState(), 0); }
  }
}
async function subscribeCloud() {
  if (cloudChannel) await cloudClient.removeChannel(cloudChannel);
  cloudChannel = cloudClient.channel(`luna-state-${cloudHouseholdId}`).on("postgres_changes", { event: "*", schema: "public", table: "luna_state", filter: `household_id=eq.${cloudHouseholdId}` }, (payload) => {
    if (!payload.new?.data) return;
    cloudApplying = true; state = normalizeCloudState(payload.new.data); localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); render(); cloudApplying = false;
    cloudStatus("Отримано оновлення від іншого користувача.");
  }).subscribe((status) => {
    if (status === "SUBSCRIBED") cloudStatus("Синхронізація активна.");
    if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) cloudStatus("Синхронізація тимчасово недоступна. Дані збережено локально.");
  });
}
async function connectHousehold(householdId) {
  cloudHouseholdId = householdId || "";
  if (cloudHouseholdId) localStorage.setItem(CLOUD_STORAGE_KEY, cloudHouseholdId);
  const { data: row, error } = await cloudClient.from("luna_state").select("data, updated_at").eq("household_id", cloudHouseholdId).maybeSingle();
  if (error) return cloudStatus(`Помилка завантаження: ${error.message}`);
  cloudLastUpdatedAt = row?.updated_at || null;
  if (row?.data && Object.keys(row.data).length) { cloudApplying = true; state = normalizeCloudState(row.data); localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); render(); cloudApplying = false; }
  else await saveCloudState();
  await subscribeCloud(); renderCloudUi();
}
async function findHousehold() {
  if (!cloudSession) return;
  const { data, error } = await cloudClient.from("household_members").select("household_id, role").eq("user_id", cloudSession.user.id).order("created_at", { ascending: true }).limit(1);
  if (error) return cloudStatus(`Помилка доступу до сім’ї: ${error.message}`);
  const membership = data?.[0];
  if (membership?.household_id) { cloudRole = membership.role || "member"; await connectHousehold(membership.household_id); } else { cloudHouseholdId = ""; cloudRole = ""; cloudLastUpdatedAt = null; localStorage.removeItem(CLOUD_STORAGE_KEY); renderCloudUi(); }
}
async function redeemInviteToken(token, announce = true) {
  const value = extractInviteToken(token);
  if (!cloudClient || !cloudSession || !value) return false;
  const { data, error } = await cloudClient.rpc("redeem_luna_invite", { token: value });
  if (error) { if (announce) cloudStatus(error.message || "Посилання недійсне або вже використане."); return false; }
  const householdId = data?.[0]?.household_id;
  if (!householdId) { if (announce) cloudStatus("Не вдалося прийняти запрошення."); return false; }
  sessionStorage.removeItem(PENDING_INVITE_KEY);
  cloudRole = "member";
  await connectHousehold(householdId);
  if (announce) cloudStatus("Запрошення прийнято. Доступ до сім’ї Луни активний.");
  return true;
}
async function redeemPendingInvite() { return pendingInviteToken() ? redeemInviteToken(pendingInviteToken()) : false; }
async function initCloud() {
  renderCloudUi();
  if (!cloudConfigured()) return;
  cloudClient = window.supabase.createClient(cloudConfig.url, cloudConfig.anonKey);
  const { data, error } = await cloudClient.auth.getSession();
  if (error) return cloudStatus(`Не вдалося перевірити сесію: ${error.message}`);
  cloudSession = data.session; renderCloudUi();
  if (cloudSession) { const joined = await redeemPendingInvite(); if (!joined) await findHousehold(); }
  cloudClient.auth.onAuthStateChange((event, session) => {
    cloudSession = session;
    if (event === "PASSWORD_RECOVERY") openModal("passwordResetModal");
    setTimeout(async () => { if (session && event !== "PASSWORD_RECOVERY") { const joined = await redeemPendingInvite(); if (!joined) await findHousehold(); } else renderCloudUi(); }, 0);
  });
}

$$('[data-event]').forEach((button) => button.addEventListener("click", () => addEvent(button.dataset.event)));
$$('[data-open]').forEach((button) => button.addEventListener("click", () => { openModal(button.dataset.open); if (button.dataset.open === "profileModal") fillForm($("#profileForm"), state.profile); if (button.dataset.open === "passportModal") fillForm($("#passportForm"), state.passport); if (button.dataset.open === "weightModal") { $("#weightForm").reset(); $("#weightForm").elements.date.value = todayKey(); $("#weightForm").elements.time.value = currentTimeValue(); renderWeight(); } if (button.dataset.open === "eventModal") { $("#eventForm").reset(); $("#eventForm").elements.date.value = todayKey(); $("#eventForm").elements.time.value = currentTimeValue(); } }));
$$('[data-close]').forEach((button) => button.addEventListener("click", () => closeModal(button.closest(".modal-backdrop"))));
$$('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener("click", (event) => { if (event.target === backdrop) closeModal(backdrop); }));

$("#profileForm").addEventListener("submit", (event) => { event.preventDefault(); state.profile = Object.fromEntries(new FormData(event.target)); saveState(); render(); closeModal($("#profileModal")); toast("Профіль Луни збережено"); });
$("#passportForm").addEventListener("submit", (event) => { event.preventDefault(); state.passport = Object.fromEntries(new FormData(event.target)); saveState(); closeModal($("#passportModal")); toast("Дані ветпаспорту збережено"); });
$("#weightForm").addEventListener("submit", (event) => { event.preventDefault(); const form = Object.fromEntries(new FormData(event.target)); const weight = Number(form.weight); if (!form.date || !Number.isFinite(weight) || weight <= 0) return toast("Вкажіть коректну вагу та дату"); state.weightRecords = [...(state.weightRecords || []), { id: crypto.randomUUID(), date: form.date, time: form.time || "", weight, note: form.note || "" }]; saveState(); event.target.reset(); closeModal($("#weightModal")); render(); toast("Вагу Луни збережено"); });
$("#reminderForm").addEventListener("submit", (event) => { event.preventDefault(); const form = Object.fromEntries(new FormData(event.target)); state.reminders.push({ ...form, id: crypto.randomUUID() }); saveState(); event.target.reset(); closeModal($("#reminderModal")); render(); toast("Нагадування додано"); });
$("#eventForm").addEventListener("submit", (event) => { event.preventDefault(); const form = Object.fromEntries(new FormData(event.target)); const createdAt = localIso(form.date, form.time); if (!createdAt) return toast("Перевірте дату і час"); state.events.push({ id: crypto.randomUUID(), type: form.type, createdAt, note: form.note || "", location: form.location || "", context: form.context || "" }); saveState(); event.target.reset(); closeModal($("#eventModal")); render(); toast(`${eventMeta[form.type].label} — записано`); });
$("#historyFilter").addEventListener("change", renderAllEvents);
$("#toiletPeriod")?.addEventListener("change", renderToiletInsights);
$("#clearEvents").addEventListener("click", () => { if (confirm("Очистити події лише за сьогодні?")) { const removed = state.events.filter((event) => localDateKey(event.createdAt) === todayKey()).map((event) => event.id); state.deletedIds = [...new Set([...(state.deletedIds || []), ...removed])]; state.events = state.events.filter((event) => !removed.includes(event.id)); saveState(); render(); toast("Події за сьогодні очищено"); } });
$("#exportButton").addEventListener("click", () => { const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `luna-vetpassport-${todayKey()}.json`; link.click(); URL.revokeObjectURL(link.href); toast("Резервну копію завантажено"); });
$("#notifyButton").addEventListener("click", async () => { if (!("Notification" in window)) return toast("Цей браузер не підтримує сповіщення"); const permission = await Notification.requestPermission(); toast(permission === "granted" ? "Нагадування дозволено" : "Дозвіл не надано"); });

$("#syncButton").addEventListener("click", () => { openModal("authModal"); renderCloudUi(); });
$("#accessLoginButton").addEventListener("click", () => { openModal("authModal"); renderCloudUi(); });
$("#authForm").addEventListener("submit", async (event) => {
  event.preventDefault(); if (!cloudClient) return cloudStatus("Спочатку додайте налаштування Supabase у supabase-config.js.");
  const form = Object.fromEntries(new FormData(event.target)); const action = event.submitter?.dataset.authAction || "signIn";
  const redirectTo = authRedirectUrl();
  let result;
  try {
    result = action === "signUp"
      ? await cloudClient.auth.signUp({ email: form.email, password: form.password, options: { emailRedirectTo: redirectTo } })
      : await cloudClient.auth.signInWithPassword({ email: form.email, password: form.password });
  } catch (error) {
    return cloudStatus(error.message || "Помилка мережі. Перевірте підключення.");
  }
  if (result.error) return cloudStatus(result.error.message);
  if (action === "signUp" && result.data?.user && Array.isArray(result.data.user.identities) && result.data.user.identities.length === 0) return cloudStatus("Цей email уже зареєстрований. Увійдіть або скористайтеся «Забули пароль?».");
  cloudStatus(action === "signUp" ? "Акаунт створено. Лист підтвердження надіслано. Перевірте також папку «Спам»." : "Вхід виконано.");
});
$("#resendConfirmationButton").addEventListener("click", async () => {
  if (!cloudClient) return cloudStatus("Спочатку додайте налаштування Supabase у supabase-config.js.");
  const email = $("#authForm").elements.email.value.trim();
  if (!email) return cloudStatus("Спочатку введіть email.");
  const redirectTo = authRedirectUrl();
  try {
    const { error } = await cloudClient.auth.resend({ type: "signup", email, options: { emailRedirectTo: redirectTo } });
    cloudStatus(error ? error.message : "Новий лист надіслано. Перевірте вхідні та папку «Спам».");
  } catch (error) {
    cloudStatus(error.message || "Помилка мережі. Перевірте підключення.");
  }
});
$("#forgotPasswordButton").addEventListener("click", async () => {
  if (!cloudClient) return cloudStatus("Спочатку додайте налаштування Supabase у supabase-config.js.");
  const email = $("#authForm").elements.email.value.trim();
  if (!email) return cloudStatus("Введіть email, для якого потрібно відновити пароль.");
  const redirectTo = authRedirectUrl();
  try {
    const { error } = await cloudClient.auth.resetPasswordForEmail(email, { redirectTo });
    cloudStatus(error ? error.message : "Посилання для зміни пароля надіслано. Перевірте email і папку «Спам».");
  } catch (error) {
    cloudStatus(error.message || "Помилка мережі. Перевірте підключення.");
  }
});
$("#passwordResetForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.target));
  if (form.password !== form.confirmPassword) return toast("Паролі не збігаються.");
  if (!cloudClient) return toast("Сервіс авторизації недоступний.");
  let result;
  try { result = await cloudClient.auth.updateUser({ password: form.password }); }
  catch (error) { return toast(error.message || "Помилка мережі. Перевірте підключення."); }
  if (result.error) return toast(result.error.message);
  event.target.reset(); closeModal($("#passwordResetModal")); toast("Пароль успішно змінено.");
  await findHousehold();
});
$("#createFamilyButton").addEventListener("click", async () => { const { data, error } = await cloudClient.rpc("create_luna_household"); if (error) return cloudStatus(error.message); cloudRole = "owner"; await connectHousehold(data?.[0]?.household_id); cloudStatus("Сім’ю Луни створено. Тепер створіть посилання для запрошення."); });
$("#createInviteButton").addEventListener("click", async () => { const { data, error } = await cloudClient.rpc("create_luna_invite", { target_household: cloudHouseholdId }); if (error) return cloudStatus(error.message || "Не вдалося створити запрошення."); const token = data?.[0]?.invite_token; if (!token) return cloudStatus("Не вдалося отримати посилання-запрошення."); const link = `${PUBLIC_APP_URL}?invite=${encodeURIComponent(token)}`; $("#inviteLinkInput").value = link; $("#inviteResult").hidden = false; cloudStatus("Посилання створено. Надішліть його потрібному користувачу."); });
$("#copyInviteButton").addEventListener("click", async () => { const link = $("#inviteLinkInput").value; try { await navigator.clipboard.writeText(link); cloudStatus("Посилання скопійовано."); } catch { cloudStatus("Скопіюйте посилання вручну з поля."); } });
$("#joinFamilyButton").addEventListener("click", async () => { const token = extractInviteToken($("#inviteTokenInput").value); if (!token) return cloudStatus("Вставте посилання-запрошення."); await redeemInviteToken(token); });
$("#signOutButton").addEventListener("click", async () => { if (cloudChannel) await cloudClient.removeChannel(cloudChannel); await cloudClient.auth.signOut(); cloudSession = null; cloudHouseholdId = ""; localStorage.removeItem(CLOUD_STORAGE_KEY); renderCloudUi(); });

render(); initCloud();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
