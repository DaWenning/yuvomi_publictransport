import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import {
  renderPageHeader, renderPageTitle, renderPageBody, renderPageSection,
} from '/utils/page-layout.js';
import {
  loadFavorites, addFavorite, removeFavorite, searchStops, fetchDepartures, formatClock,
} from './lib/transport.js';

const REFRESH_MS = 30000;
const tt = (key, params) => t(`extensions.public-transport.${key}`, params);

export async function render(container, context) {
  const { signal } = context;

  let favorites = loadFavorites();
  let activeStopId = favorites[0]?.id || null;
  let refreshTimer = null;
  let searchDebounce = null;
  let searchAbort = null;
  let boardAbort = null;

  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', renderPageHeader({
    title: renderPageTitle(tt('module')),
  }) + renderPageBody({
    content: renderPageSection({ content: '<div id="pt-root" class="pt-root"></div>' }),
  }));

  const root = container.querySelector('#pt-root');
  if (!root) return;

  signal.addEventListener('abort', () => {
    clearTimeout(refreshTimer);
    clearTimeout(searchDebounce);
    searchAbort?.abort();
    boardAbort?.abort();
  }, { signal });

  function activeStopName() {
    return favorites.find((f) => f.id === activeStopId)?.name || '';
  }

  function renderShell() {
    root.replaceChildren();
    root.insertAdjacentHTML('beforeend', `
      <div class="pt-search">
        <label class="sr-only" for="pt-search-input">${esc(tt('searchLabel'))}</label>
        <input id="pt-search-input" type="text" autocomplete="off" spellcheck="false"
          placeholder="${esc(tt('searchPlaceholder'))}" />
        <div id="pt-search-results" class="pt-search-results" hidden></div>
      </div>
      <div id="pt-favorites" class="pt-favorites"></div>
      <div id="pt-board" class="pt-board"></div>
    `);
    wireSearch();
    renderFavorites();
    renderBoard();
  }

  function wireSearch() {
    const input = root.querySelector('#pt-search-input');
    const resultsEl = root.querySelector('#pt-search-results');
    if (!input || !resultsEl) return;

    input.addEventListener('input', () => {
      const query = input.value.trim();
      clearTimeout(searchDebounce);
      searchAbort?.abort();
      if (query.length < 3) {
        resultsEl.hidden = true;
        resultsEl.replaceChildren();
        return;
      }
      searchDebounce = setTimeout(async () => {
        searchAbort = new AbortController();
        resultsEl.hidden = false;
        resultsEl.replaceChildren();
        resultsEl.insertAdjacentHTML('beforeend', `<div class="pt-search-status">${esc(tt('searching'))}</div>`);
        try {
          const stops = await searchStops(query, { signal: searchAbort.signal });
          if (signal.aborted) return;
          resultsEl.replaceChildren();
          if (!stops.length) {
            resultsEl.insertAdjacentHTML('beforeend', `<div class="pt-search-status">${esc(tt('noResults'))}</div>`);
            return;
          }
          resultsEl.insertAdjacentHTML('beforeend', stops.map((stop) => `
            <button type="button" class="pt-search-result" data-stop-id="${esc(stop.id)}" data-stop-name="${esc(stop.name)}">
              ${esc(stop.name)}
            </button>
          `).join(''));
        } catch (err) {
          if (err?.name === 'AbortError') return;
          resultsEl.replaceChildren();
          resultsEl.insertAdjacentHTML(
            'beforeend',
            `<div class="pt-search-status pt-search-status--error">${esc(tt('loadError'))}</div>`,
          );
        }
      }, 300);
    }, { signal });

    resultsEl.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.pt-search-result');
      if (!btn) return;
      const stop = { id: btn.dataset.stopId, name: btn.dataset.stopName };
      favorites = addFavorite(stop);
      activeStopId = stop.id;
      input.value = '';
      resultsEl.hidden = true;
      resultsEl.replaceChildren();
      renderFavorites();
      renderBoard();
    }, { signal });

    document.addEventListener('click', (ev) => {
      if (!root.contains(ev.target)) return;
      if (ev.target.closest('#pt-search-input') || ev.target.closest('#pt-search-results')) return;
      resultsEl.hidden = true;
    }, { signal });
  }

  function renderFavorites() {
    const el = root.querySelector('#pt-favorites');
    if (!el) return;
    el.replaceChildren();
    if (!favorites.length) {
      el.insertAdjacentHTML('beforeend', `
        <div class="empty-state empty-state--compact">
          <p class="empty-state__title">${esc(tt('favoritesEmptyTitle'))}</p>
          <p class="empty-state__description">${esc(tt('favoritesEmptyDescription'))}</p>
        </div>
      `);
      return;
    }
    el.insertAdjacentHTML('beforeend', favorites.map((stop) => `
      <div class="pt-chip ${stop.id === activeStopId ? 'pt-chip--active' : ''}" data-stop-id="${esc(stop.id)}">
        <button type="button" class="pt-chip__select" data-action="select" data-stop-id="${esc(stop.id)}">
          ${esc(stop.name)}
        </button>
        <button type="button" class="pt-chip__remove" data-action="remove" data-stop-id="${esc(stop.id)}"
          aria-label="${esc(tt('removeFavorite', { name: stop.name }))}">&#x2715;</button>
      </div>
    `).join(''));

    el.querySelectorAll('[data-action="select"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeStopId = btn.dataset.stopId;
        renderFavorites();
        renderBoard();
      }, { signal });
    });
    el.querySelectorAll('[data-action="remove"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.stopId;
        favorites = removeFavorite(id);
        if (activeStopId === id) {
          activeStopId = favorites[0]?.id || null;
        }
        renderFavorites();
        renderBoard();
      }, { signal });
    });
  }

  async function renderBoard() {
    clearTimeout(refreshTimer);
    boardAbort?.abort();
    const el = root.querySelector('#pt-board');
    if (!el) return;
    if (!activeStopId) {
      el.replaceChildren();
      return;
    }
    el.replaceChildren();
    el.insertAdjacentHTML('beforeend', `
      <div class="pt-board__head">
        <h2 class="pt-board__title">${esc(activeStopName())}</h2>
        <button type="button" class="pt-board__refresh" id="pt-refresh-btn">${esc(tt('refresh'))}</button>
      </div>
      <div class="pt-board__body" id="pt-board-body">
        <p class="pt-board-status">${esc(tt('loading'))}</p>
      </div>
      <p class="pt-board__footnote" id="pt-board-footnote">${esc(tt('dataSource'))}</p>
    `);
    el.querySelector('#pt-refresh-btn')?.addEventListener('click', () => loadBoard(), { signal });
    await loadBoard();
  }

  async function loadBoard() {
    const body = root.querySelector('#pt-board-body');
    if (!body || !activeStopId) return;
    boardAbort?.abort();
    boardAbort = new AbortController();
    try {
      const departures = await fetchDepartures(activeStopId, { signal: boardAbort.signal });
      if (signal.aborted) return;
      body.replaceChildren();
      if (!departures.length) {
        body.insertAdjacentHTML('beforeend', `
          <div class="empty-state empty-state--compact">
            <p class="empty-state__title">${esc(tt('boardEmpty'))}</p>
          </div>
        `);
      } else {
        body.insertAdjacentHTML('beforeend', `<ul class="pt-list">${departures.map(renderRow).join('')}</ul>`);
      }
      const footnote = root.querySelector('#pt-board-footnote');
      if (footnote) {
        footnote.textContent = `${tt('dataSource')} \u00b7 ${tt('lastUpdated', { time: formatClock(new Date().toISOString()) })}`;
      }
    } catch (err) {
      if (err?.name === 'AbortError' || signal.aborted) return;
      body.replaceChildren();
      body.insertAdjacentHTML('beforeend', `
        <div class="empty-state empty-state--compact">
          <p class="empty-state__title">${esc(tt('loadError'))}</p>
        </div>
      `);
    } finally {
      if (!signal.aborted) {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(loadBoard, REFRESH_MS);
      }
    }
  }

  function renderRow(dep) {
    const delayBadge = dep.cancelled
      ? `<span class="pt-badge pt-badge--cancelled">${esc(tt('cancelled'))}</span>`
      : (dep.delayMinutes && dep.delayMinutes > 0
        ? `<span class="pt-badge pt-badge--delay">+${Number(dep.delayMinutes)} ${esc(tt('minutesShort'))}</span>`
        : '');
    const platform = dep.platform
      ? `<span class="pt-row__platform">${esc(tt('platform', { platform: dep.platform }))}</span>`
      : '<span class="pt-row__platform"></span>';
    return `
      <li class="pt-row ${dep.cancelled ? 'pt-row--cancelled' : ''}">
        <span class="pt-row__line pt-row__line--${esc(dep.product)}">${esc(dep.lineName)}</span>
        <span class="pt-row__dest">${esc(dep.destination)}</span>
        <span class="pt-row__time">
          <span class="pt-row__time-value">${esc(formatClock(dep.when))}</span>
          ${delayBadge}
        </span>
        ${platform}
      </li>
    `;
  }

  renderShell();
}
