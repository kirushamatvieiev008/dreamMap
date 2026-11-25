/* ==========================================================================
   app.js — точка входу: збирає модулі докупи й зв'язує їх між собою.
   Потік даних один: дія користувача → store → (карта + мінімапа + список).
   ========================================================================== */
(function () {
  'use strict';

  const DM = window.DM;
  const { $, prefersReducedMotion } = DM.utils;
  const store = DM.store;

  /* ---------- Ініціалізація ---------- */
  store.init();
  DM.fx.init();

  const map = new DM.WorldMap(
    {
      stage: $('#mapStage'),
      svg: $('#mapSvg'),
      viewport: $('#mapViewport'),
      graticule: $('#graticule'),
      countriesGroup: $('#countries'),
      pinLayer: $('#pinLayer'),
      tooltip: $('#mapTooltip'),
      popover: $('#mapPopover'),
      scrollHint: $('#scrollHint'),
      zoomInBtn: $('#zoomIn'),
      zoomOutBtn: $('#zoomOut'),
      zoomFitBtn: $('#zoomFit'),
    },
    {
      onAddPlace: (a2) => DM.form.openAdd({ countryCode: a2 }),
      onEditPlace: (id) => editPlace(id),
      onTogglePlace: (id, button) => togglePlace(id, button),
    }
  );

  const minimap = new DM.Minimap(
    {
      root: $('#minimap'),
      svg: $('#minimapSvg'),
      land: $('#minimapLand'),
      pins: $('#minimapPins'),
      view: $('#minimapView'),
    },
    map
  );

  DM.ui.init({
    onAdd: () => DM.form.openAdd(),
    onEdit: editPlace,
    onToggle: togglePlace,
    onDelete: deletePlace,
    onLocate: locatePlace,
    onHoverCountry: (a2) => map.setLinked(a2),
  });

  DM.form.init({ onSubmit: handleFormSubmit });

  /* ---------- Один рендер для всіх ---------- */
  function renderAll(change) {
    const places = store.getAll();
    map.render(places, change);
    minimap.render(places);
    DM.ui.render(places);
  }

  store.subscribe((change) => renderAll(change));
  store.onSaveError = () =>
    DM.ui.toast('Не вдалося зберегти: сховище браузера заповнене. Видаліть кілька місць або фото.', {
      type: 'error',
      timeout: 9000,
    });
  renderAll();

  /* ---------- Дії над місцями ---------- */
  function scrollToMap() {
    $('#map').scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  function editPlace(id) {
    const place = store.getById(id);
    if (place) DM.form.openEdit(place);
  }

  function togglePlace(id, sourceEl) {
    const place = store.getById(id);
    if (!place) return;
    const becomesVisited = place.status !== 'visited';

    if (becomesVisited && sourceEl) {
      const r = sourceEl.getBoundingClientRect();
      DM.fx.burst(r.left + r.width / 2, r.top + r.height / 2);
    }
    store.toggleStatus(id);
    DM.ui.toast(becomesVisited ? `${place.city}: відвідано` : `${place.city}: знову в мріях`, { timeout: 2800 });
  }

  function deletePlace(id) {
    const removed = store.remove(id);
    if (!removed) return;
    DM.ui.toast(`Видалено: ${removed.place.city}`, {
      actionLabel: 'Скасувати',
      onAction: () => store.restore(removed),
      timeout: 7000,
    });
  }

  function locatePlace(id) {
    const place = store.getById(id);
    if (!place) return;
    scrollToMap();
    map.focusCountry(place.countryCode);
  }

  /** Шукаємо точні координати міста у фоні: форма не чекає на мережу. */
  function locateCity(place, country) {
    DM.geo.geocode(place.city, country).then((coords) => {
      if (coords && store.getById(place.id)) store.update(place.id, coords);
    });
  }

  function handleFormSubmit({ mode, id, data, country }) {
    if (mode === 'add') {
      const place = store.add(data);
      DM.ui.toast(`Додано: ${place.city}, ${country.n}`, { timeout: 3500 });
      scrollToMap();
      map.focusCountry(country.a, { popover: false });
      locateCity(place, country);
      return;
    }

    const previous = store.getById(id);
    if (!previous) return;
    const placeChanged = previous.city !== data.city || previous.countryCode !== data.countryCode;
    const patch = placeChanged ? { ...data, lat: null, lon: null } : data;
    store.update(id, patch);
    DM.ui.toast('Зміни збережено', { timeout: 2500 });
    if (placeChanged) locateCity({ id, city: data.city }, country);
  }

  /* ---------- Кнопки шапки ---------- */
  $('#addBtn').addEventListener('click', () => DM.form.openAdd());

  // Тема оформлення
  $('#themeToggle').addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    DM.storage.saveTheme(next);
    document.querySelector('meta[name="theme-color"]').setAttribute('content', next === 'light' ? '#eef3fb' : '#070b1f');
  });

  // Меню «Дані»
  const menuBtn = $('#dataMenuBtn');
  const menuPanel = $('#dataMenuPanel');
  function setMenu(open) {
    menuPanel.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
  }
  menuBtn.addEventListener('click', () => setMenu(menuPanel.hidden));
  document.addEventListener('click', (e) => {
    if (!menuPanel.hidden && !e.target.closest('#dataMenu')) setMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menuPanel.hidden) {
      setMenu(false);
      menuBtn.focus();
    }
  });

  $('#exportBtn').addEventListener('click', () => {
    setMenu(false);
    if (!store.getAll().length) return DM.ui.toast('Поки що нічого зберігати: список порожній.');
    DM.storage.exportToFile(store.getAll());
    DM.ui.toast('Копію збережено у файл');
  });

  $('#importBtn').addEventListener('click', () => {
    setMenu(false);
    $('#importFile').click();
  });

  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const places = await DM.storage.parseImportFile(file);
      const previous = store.replaceAll(places);
      DM.ui.toast(`Відкрито місць: ${places.length}`, {
        actionLabel: 'Скасувати',
        onAction: () => store.replaceAll(previous),
        timeout: 8000,
      });
    } catch (error) {
      DM.ui.toast(error.message, { type: 'error', timeout: 7000 });
    }
  });

  $('#clearBtn').addEventListener('click', () => {
    setMenu(false);
    if (!store.getAll().length) return DM.ui.toast('Список уже порожній.');
    const previous = store.replaceAll([]);
    DM.ui.toast('Усі місця видалено', {
      actionLabel: 'Скасувати',
      onAction: () => store.replaceAll(previous),
      timeout: 9000,
    });
  });
})();
