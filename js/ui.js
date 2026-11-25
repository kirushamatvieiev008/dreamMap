/* ==========================================================================
   ui.js — список місць (картки), статистика, фільтри, пошук, сортування,
   порожні стани та сповіщення (toast).
   ========================================================================== */
(function () {
  'use strict';

  const DM = window.DM;
  const { $, $$, el, icon, createFlag, hues, normalize, pluralize, formatMonthYear } = DM.utils;

  const PLACE_FORMS = ['місце', 'місця', 'місць'];
  const WORLD_COUNTRIES = 195; // визнаних держав у світі (для відсотка «відкритого світу»)

  const state = { filter: 'all', query: '', sort: 'newest' };
  let handlers = {};
  let grid;
  const cards = new Map(); // id → { el, signature }

  /* ---------------------------------------------------------------- *
   *  Ініціалізація
   * ---------------------------------------------------------------- */
  function init(h) {
    handlers = h;
    grid = $('#placesGrid');

    // Фільтр
    $$('.filter-btn').forEach((btn) =>
      btn.addEventListener('click', () => {
        state.filter = btn.dataset.filter;
        $$('.filter-btn').forEach((b) => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-pressed', String(active));
        });
        renderList(DM.store.getAll());
      })
    );

    // Пошук і сортування
    $('#searchInput').addEventListener(
      'input',
      DM.utils.debounce((e) => {
        state.query = e.target.value;
        renderList(DM.store.getAll());
      }, 120)
    );
    $('#sortSelect').addEventListener('change', (e) => {
      state.sort = e.target.value;
      renderList(DM.store.getAll());
    });

    // Дії на картках (делегування подій)
    grid.addEventListener('click', (e) => {
      const button = e.target.closest('[data-action]');
      const card = e.target.closest('.place');
      if (!button || !card) return;
      const id = card.dataset.id;
      const action = button.dataset.action;
      if (action === 'toggle') handlers.onToggle(id, button);
      else if (action === 'edit') handlers.onEdit(id);
      else if (action === 'delete') handlers.onDelete(id);
      else if (action === 'locate') handlers.onLocate(id);
    });

    // Наведення на картку підсвічує країну на мапі
    grid.addEventListener('pointerover', (e) => {
      const card = e.target.closest('.place');
      handlers.onHoverCountry(card ? card.dataset.country : null);
    });
    grid.addEventListener('pointerleave', () => handlers.onHoverCountry(null));

    $('#emptyAction').addEventListener('click', () => {
      if (state.filter !== 'all' || state.query) resetFilters();
      else handlers.onAdd();
    });
  }

  function resetFilters() {
    state.filter = 'all';
    state.query = '';
    $('#searchInput').value = '';
    $$('.filter-btn').forEach((b) => {
      const active = b.dataset.filter === 'all';
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    renderList(DM.store.getAll());
  }

  /* ---------------------------------------------------------------- *
   *  Відмальовування
   * ---------------------------------------------------------------- */
  function render(places) {
    renderStats(places);
    renderList(places);
  }

  function renderStats(places) {
    const total = places.length;
    const visited = places.filter((p) => p.status === 'visited').length;
    const planned = total - visited;
    const countries = new Set(places.map((p) => p.countryCode));
    const visitedCountries = new Set(places.filter((p) => p.status === 'visited').map((p) => p.countryCode));
    const percent = total ? Math.round((visited / total) * 100) : 0;

    $('#statVisited').textContent = visited;
    $('#statPlanned').textContent = planned;
    $('#statCountries').textContent = countries.size;
    $('#statVisitedLabel').textContent = pluralize(visited, ['місце відвідано', 'місця відвідано', 'місць відвідано']);
    $('#statPlannedLabel').textContent = planned === 1 ? 'місце в мріях' : 'у мріях';
    $('#statCountriesLabel').textContent = pluralize(countries.size, ['країна на мапі', 'країни на мапі', 'країн на мапі']);

    $('#statPercent').textContent = percent + '%';
    $('#progressBar').style.strokeDashoffset = String(100 - percent);
    const worldShare = ((visitedCountries.size / WORLD_COUNTRIES) * 100).toFixed(1).replace('.0', '');
    $('#progress').setAttribute(
      'aria-label',
      `Мрій здійснено: ${percent}%. Відвідано ${visitedCountries.size} із ${WORLD_COUNTRIES} країн світу (${worldShare}%).`
    );
    $('#progress').title = `Відвідано ${visitedCountries.size} із ${WORLD_COUNTRIES} країн світу`;

    // Лічильники на кнопках фільтра
    $('[data-count="all"]').textContent = total;
    $('[data-count="planned"]').textContent = planned;
    $('[data-count="visited"]').textContent = visited;
  }

  function visiblePlaces(places) {
    const query = normalize(state.query);
    let list = places.filter((p) => state.filter === 'all' || p.status === state.filter);

    if (query) {
      list = list.filter((p) => {
        const country = DM.geo.byCode.get(p.countryCode);
        const haystack = [p.city, country && country.n, country && country.e, p.note].map(normalize).join(' ');
        return haystack.includes(query);
      });
    }

    const countryName = (p) => (DM.geo.byCode.get(p.countryCode) || {}).n || '';
    const byText = (a, b) => a.localeCompare(b, 'uk');
    const sorters = {
      newest: (a, b) => b.createdAt - a.createdAt,
      oldest: (a, b) => a.createdAt - b.createdAt,
      city: (a, b) => byText(a.city, b.city),
      country: (a, b) => byText(countryName(a), countryName(b)) || byText(a.city, b.city),
    };
    return list.sort(sorters[state.sort]);
  }

  function renderList(places) {
    const list = visiblePlaces(places);
    const ids = new Set(list.map((p) => p.id));

    // Прибираємо картки, яких більше немає
    for (const [id, card] of cards) {
      if (!ids.has(id)) {
        card.el.remove();
        cards.delete(id);
      }
    }

    // Додаємо/оновлюємо й розставляємо у правильному порядку (без перестворення зайвого —
    // так фото не «блимають» після кожної зміни)
    list.forEach((place, index) => {
      const signature = signatureOf(place);
      let card = cards.get(place.id);
      if (!card || card.signature !== signature) {
        const node = createCard(place);
        if (card) card.el.replaceWith(node);
        card = { el: node, signature };
        cards.set(place.id, card);
      }
      if (grid.children[index] !== card.el) grid.insertBefore(card.el, grid.children[index] || null);
    });

    renderEmpty(places.length, list.length);
  }

  function renderEmpty(total, shown) {
    const empty = $('#emptyState');
    empty.hidden = shown > 0;
    if (shown > 0) return;

    const noPlaces = total === 0;
    $('#emptyTitle').textContent = noPlaces ? 'Мапа поки порожня' : 'Нічого не знайдено';
    $('#emptyText').textContent = noPlaces
      ? 'Додай перше місце: місто, країну й фото. Воно відразу з’явиться на мапі.'
      : 'Спробуй інший запит або покажи всі місця.';
    $('#emptyAction').lastChild.textContent = noPlaces ? 'Додати місце' : 'Показати всі';
  }

  /** Підпис даних картки: якщо він не змінився, картку не перестворюємо. */
  function signatureOf(place) {
    return [
      place.city, place.countryCode, place.status, place.note, place.when,
      place.photo ? place.photo.length : 0, place.visitedAt,
    ].join('|');
  }

  /* ---------------------------------------------------------------- *
   *  Картка місця
   * ---------------------------------------------------------------- */
  function createCard(place) {
    const country = DM.geo.byCode.get(place.countryCode) || { a: place.countryCode, n: place.countryCode };
    const visited = place.status === 'visited';

    // Обкладинка: фото користувача або згенерований градієнт
    let media;
    if (place.photo) {
      media = el('img', { class: 'place-photo', src: place.photo, alt: `Фото: ${place.city}`, loading: 'lazy', decoding: 'async' });
    } else {
      const [h1, h2] = hues(place.city + place.countryCode);
      media = el(
        'div',
        { class: 'place-art', style: { '--h1': h1, '--h2': h2 }, 'aria-hidden': 'true' },
        el('span', { class: 'place-art-letter' }, place.city.trim().charAt(0).toUpperCase()),
        createFlag(country.a, 'flag', 160)
      );
    }

    const chip = el(
      'span',
      { class: 'chip ' + (visited ? 'chip--visited' : 'chip--dream') },
      visited ? icon('check') : null,
      visited ? 'Відвідано' : 'Мрія'
    );

    const title = el(
      'div',
      { class: 'place-title' },
      el('h3', {}, place.city),
      el('p', { class: 'place-country' }, createFlag(country.a, 'flag', 40), country.n)
    );

    // Нотатка та дата
    const body = el('div', { class: 'place-body' });
    if (place.note) body.append(el('p', { class: 'place-note' }, place.note));

    const metaText = visited
      ? place.visitedAt ? 'Відвідано: ' + formatMonthYear(place.visitedAt) : ''
      : place.when;
    if (metaText) body.append(el('p', { class: 'place-meta' }, icon('calendar'), metaText));
    if (!body.children.length) body.append(el('p', { class: 'place-note' }, visited ? 'Гарний спогад.' : 'Ще чекає на свій час.'));

    const actions = el(
      'div',
      { class: 'place-actions' },
      el(
        'button',
        {
          class: 'btn btn--secondary btn--small toggle-visited',
          type: 'button',
          'data-action': 'toggle',
          'aria-pressed': String(visited),
        },
        el('span', { class: 'toggle-box' }, icon('check')),
        'Відвідано'
      ),
      el('button', { class: 'icon-btn', type: 'button', 'data-action': 'locate', 'aria-label': `Показати на мапі: ${place.city}`, title: 'Показати на мапі' }, icon('pin')),
      el('button', { class: 'icon-btn', type: 'button', 'data-action': 'edit', 'aria-label': `Редагувати: ${place.city}`, title: 'Редагувати' }, icon('pencil')),
      el('button', { class: 'icon-btn icon-btn--danger', type: 'button', 'data-action': 'delete', 'aria-label': `Видалити: ${place.city}`, title: 'Видалити' }, icon('trash'))
    );

    return el(
      'article',
      { class: 'place', dataset: { id: place.id, status: place.status, country: place.countryCode } },
      el('div', { class: 'place-media' }, media, chip, title),
      body,
      actions
    );
  }

  /* ---------------------------------------------------------------- *
   *  Сповіщення
   * ---------------------------------------------------------------- */
  function toast(message, { actionLabel, onAction, timeout = 5000, type } = {}) {
    const container = $('#toasts');
    const node = el('div', { class: 'toast' + (type === 'error' ? ' toast--error' : '') });
    node.append(el('span', { class: 'toast-text' }, message));

    const close = () => {
      if (!node.isConnected) return;
      node.classList.add('is-leaving');
      setTimeout(() => node.remove(), 260);
    };

    if (actionLabel) {
      node.append(
        el(
          'button',
          {
            class: 'btn btn--secondary btn--small',
            type: 'button',
            onclick: () => {
              close();
              if (onAction) onAction();
            },
          },
          actionLabel
        )
      );
    }

    container.append(node);
    while (container.children.length > 3) container.firstElementChild.remove();
    setTimeout(close, timeout);
    return close;
  }

  /** Підсвічує картку (після переходу з мапи). */
  function flashCard(id) {
    const card = cards.get(id);
    if (!card) return;
    card.el.scrollIntoView({ behavior: DM.utils.prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
    card.el.animate(
      [{ boxShadow: '0 0 0 0 rgba(255,200,87,.7)' }, { boxShadow: '0 0 0 14px rgba(255,200,87,0)' }],
      { duration: 900, easing: 'ease-out' }
    );
  }

  DM.ui = { init, render, toast, flashCard, resetFilters };
})();
