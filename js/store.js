/* ==========================================================================
   store.js — єдине джерело правди: список місць + підписка на зміни.
   Карта, мінімапа й список лише слухають store і перемальовуються самі.
   ========================================================================== */
(function () {
  'use strict';

  const DM = window.DM;
  const { uid } = DM.utils;

  /**
   * Модель місця:
   * {
   *   id, city, countryCode ('JP'), status ('planned' | 'visited'),
   *   note, when, photo (data URL | null),
   *   lat, lon (необов'язково — точка міста),
   *   createdAt, visitedAt
   * }
   */

  let places = [];
  const listeners = new Set();
  let onSaveError = () => {};

  /* Приклади для першого запуску, щоб мапа не була порожньою. Їх легко видалити. */
  function seed() {
    const t = Date.now() - 1000 * 60 * 60 * 24 * 10;
    const make = (i, city, countryCode, status, extra) => ({
      id: uid(),
      city,
      countryCode,
      status,
      note: '',
      when: '',
      photo: null,
      lat: null,
      lon: null,
      createdAt: t + i * 60000,
      visitedAt: status === 'visited' ? t + i * 60000 : null,
      ...extra,
    });
    return [
      make(0, 'Кіото', 'JP', 'planned', {
        note: 'Храми, бамбуковий гай Арасіяма і чайна церемонія.',
        when: 'осінь 2027', lat: 35.0116, lon: 135.7681,
      }),
      make(1, 'Рейк’явік', 'IS', 'planned', {
        note: 'Північне сяйво, гарячі джерела і дорога навколо острова.',
        when: 'зима 2027', lat: 64.1466, lon: -21.9426,
      }),
      make(2, 'Лісабон', 'PT', 'visited', {
        note: 'Трамвай 28 і пастейш де ната на сніданок.',
        lat: 38.7223, lon: -9.1393,
      }),
      make(3, 'Квінстаун', 'NZ', 'planned', {
        note: 'Озера, гори і найкрасивіші дороги, які тільки бувають.',
        lat: -45.0312, lon: 168.6626,
      }),
      make(4, 'Банф', 'CA', 'planned', {
        note: 'Озеро Луїз на світанку.',
        when: 'літо 2028', lat: 51.1784, lon: -115.5708,
      }),
      make(5, 'Стамбул', 'TR', 'visited', {
        note: 'Пором через Босфор і вечори на даху.',
        lat: 41.0082, lon: 28.9784,
      }),
    ];
  }

  function init() {
    const saved = DM.storage.load();
    if (saved) {
      places = saved.places;
    } else {
      places = seed();
      DM.storage.save(places);
    }
  }

  function emit(change) {
    listeners.forEach((fn) => fn(change, places));
  }

  function persist() {
    if (!DM.storage.save(places)) onSaveError();
  }

  /* ---------- Читання ---------- */
  const getAll = () => places.slice();
  const getById = (id) => places.find((p) => p.id === id) || null;
  const getByCountry = (a2) => places.filter((p) => p.countryCode === a2);

  /* ---------- Зміни ---------- */
  function add(data) {
    const place = {
      id: uid(),
      city: data.city,
      countryCode: data.countryCode,
      status: data.status === 'visited' ? 'visited' : 'planned',
      note: data.note || '',
      when: data.when || '',
      photo: data.photo || null,
      lat: data.lat ?? null,
      lon: data.lon ?? null,
      createdAt: Date.now(),
      visitedAt: data.status === 'visited' ? Date.now() : null,
    };
    places.push(place);
    persist();
    emit({ type: 'add', id: place.id });
    return place;
  }

  function update(id, patch, { silent = false } = {}) {
    const place = getById(id);
    if (!place) return null;
    const wasVisited = place.status === 'visited';
    Object.assign(place, patch);
    if (patch.status && patch.status !== (wasVisited ? 'visited' : 'planned')) {
      place.visitedAt = patch.status === 'visited' ? Date.now() : null;
    }
    persist();
    if (!silent) emit({ type: 'update', id });
    return place;
  }

  function toggleStatus(id) {
    const place = getById(id);
    if (!place) return null;
    return update(id, { status: place.status === 'visited' ? 'planned' : 'visited' });
  }

  /** Видаляє місце. Повертає дані, потрібні, щоб скасувати видалення. */
  function remove(id) {
    const index = places.findIndex((p) => p.id === id);
    if (index === -1) return null;
    const [place] = places.splice(index, 1);
    persist();
    emit({ type: 'remove', id });
    return { place, index };
  }

  function restore({ place, index }) {
    places.splice(Math.min(index, places.length), 0, place);
    persist();
    emit({ type: 'restore', id: place.id });
  }

  /** Замінює весь список (імпорт, «видалити все»). Повертає попередній список для скасування. */
  function replaceAll(newPlaces) {
    const previous = places;
    places = newPlaces;
    persist();
    emit({ type: 'replace' });
    return previous;
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  DM.store = {
    init, getAll, getById, getByCountry, add, update, toggleStatus, remove, restore, replaceAll, subscribe,
    set onSaveError(fn) { onSaveError = fn; },
  };
})();
