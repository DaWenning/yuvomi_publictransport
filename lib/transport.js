// Shared helpers for the Public Transport module.
// Talks to the free, keyless transport.rest API (a public HAFAS wrapper
// covering Deutsche Bahn and most German regional/local networks).

export const API_BASE = 'https://v6.db.transport.rest';
export const FAVORITES_KEY = 'yuvomi:ext:public-transport:favorites';

export function loadFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((f) => f && f.id && f.name) : [];
  } catch {
    return [];
  }
}

export function saveFavorites(list) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable (private browsing, quota) - favorites just won't persist
  }
}

export function addFavorite(stop) {
  const list = loadFavorites();
  if (!list.some((f) => f.id === stop.id)) {
    list.push({ id: stop.id, name: stop.name });
    saveFavorites(list);
  }
  return list;
}

export function removeFavorite(id) {
  const list = loadFavorites().filter((f) => f.id !== id);
  saveFavorites(list);
  return list;
}

export async function searchStops(query, { signal } = {}) {
  const url = `${API_BASE}/locations?query=${encodeURIComponent(query)}`
    + '&results=8&stops=true&addresses=false&poi=false&linesOfStops=false';
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`search_failed_${res.status}`);
  const data = await res.json();
  return (Array.isArray(data) ? data : [])
    .filter((loc) => loc && loc.id && loc.name && (loc.type === 'stop' || loc.type === 'station'));
}

export async function fetchDepartures(stopId, { duration = 60, results = 20, signal } = {}) {
  const url = `${API_BASE}/stops/${encodeURIComponent(stopId)}/departures`
    + `?duration=${duration}&results=${results}&remarks=false&linesOfStops=false`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`departures_failed_${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : (Array.isArray(data?.departures) ? data.departures : []);
  return list.map(normalizeDeparture);
}

const PRODUCT_LABELS = {
  nationalExpress: 'ICE',
  national: 'IC/EC',
  regionalExpress: 'RE',
  regional: 'RB',
  suburban: 'S',
  subway: 'U',
  tram: 'Tram',
  bus: 'Bus',
  ferry: 'Fähre',
  taxi: 'Taxi',
};

export function normalizeDeparture(dep) {
  const line = dep.line || {};
  const product = line.product || 'bus';
  const cancelled = dep.cancelled === true || dep.when === null;
  const when = dep.when || dep.plannedWhen || null;
  const plannedWhen = dep.plannedWhen || dep.when || null;

  let delayMinutes = null;
  if (typeof dep.delay === 'number') {
    delayMinutes = Math.round(dep.delay / 60);
  } else if (when && plannedWhen && when !== plannedWhen) {
    delayMinutes = Math.round((new Date(when) - new Date(plannedWhen)) / 60000);
  }

  return {
    tripId: dep.tripId || null,
    lineName: line.name || PRODUCT_LABELS[product] || '?',
    product,
    productLabel: PRODUCT_LABELS[product] || product || '',
    destination: dep.direction || dep.destination?.name || '',
    when,
    plannedWhen,
    delayMinutes,
    cancelled,
    platform: dep.platform || dep.plannedPlatform || null,
  };
}

export function formatClock(iso) {
  if (!iso) return '--:--';
  try {
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  } catch {
    return '--:--';
  }
}
