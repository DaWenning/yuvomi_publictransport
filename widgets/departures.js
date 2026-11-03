import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import { loadFavorites, fetchDepartures, formatClock } from '../lib/transport.js';

const tt = (key, params) => t(`extensions.public-transport.${key}`, params);

export async function renderWidget(container, { size, options }) {
  container.replaceChildren();

  const favorites = loadFavorites();
  const stopId = (options?.stop_id || '').trim() || favorites[0]?.id || '';
  const stopName = (options?.stop_name || '').trim()
    || favorites.find((f) => f.id === stopId)?.name
    || '';

  if (!stopId) {
    container.insertAdjacentHTML('beforeend', `
      <div class="pt-widget">
        <p class="pt-widget__empty">${esc(tt('widgets.noStopConfigured'))}</p>
      </div>
    `);
    return;
  }

  const limit = /^[34]x/.test(size || '') ? 6 : 4;
  container.insertAdjacentHTML('beforeend', `
    <div class="pt-widget">
      <p class="pt-widget__title">${esc(stopName || tt('widgets.departures'))}</p>
      <div class="pt-widget__list" id="pt-widget-list">
        <p class="pt-widget__status">${esc(tt('loading'))}</p>
      </div>
    </div>
  `);

  const list = container.querySelector('#pt-widget-list');
  try {
    const departures = await fetchDepartures(stopId, { results: limit, signal: AbortSignal.timeout(8000) });
    if (!list) return;
    list.replaceChildren();
    if (!departures.length) {
      list.insertAdjacentHTML('beforeend', `<p class="pt-widget__status">${esc(tt('boardEmpty'))}</p>`);
      return;
    }
    list.insertAdjacentHTML('beforeend', departures.slice(0, limit).map((dep) => `
      <div class="pt-widget__row">
        <span class="pt-row__line pt-row__line--${esc(dep.product)}">${esc(dep.lineName)}</span>
        <span class="pt-widget__dest">${esc(dep.destination)}</span>
        <span class="pt-widget__time">${esc(formatClock(dep.when))}${dep.delayMinutes > 0 ? ` <small>+${Number(dep.delayMinutes)}</small>` : ''}</span>
      </div>
    `).join(''));
  } catch {
    if (!list) return;
    list.replaceChildren();
    list.insertAdjacentHTML('beforeend', `<p class="pt-widget__status pt-widget__status--error">${esc(tt('loadError'))}</p>`);
  }
}
