/* ==========================================================================
   storage.js — збереження даних у localStorage браузера + експорт/імпорт файлу
   ========================================================================== */
(function () {
  'use strict';

  const DM = window.DM;
  const KEY = 'dreammap:v1';
  const THEME_KEY = 'dreammap:theme';
  const FORMAT_VERSION = 1;

  /** Читає збережений стан. Повертає null, якщо даних немає або вони пошкоджені. */
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data && Array.isArray(data.places) ? data : null;
    } catch (error) {
      console.warn('Не вдалося прочитати збережені дані:', error);
      return null;
    }
  }

  /** Зберігає стан. Повертає false, якщо сховище переповнене або недоступне. */
  function save(places) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ version: FORMAT_VERSION, seeded: true, places }));
      return true;
    } catch (error) {
      console.warn('Не вдалося зберегти дані:', error);
      return false;
    }
  }

  function loadTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (error) {
      return null;
    }
  }

  function saveTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      /* нічого страшного: тема просто не запам'ятається */
    }
  }

  /** Завантажує копію даних як JSON-файл. */
  function exportToFile(places) {
    const payload = {
      app: 'dream-map',
      version: FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      places,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dream-map-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Розбирає файл копії. Кидає помилку з зрозумілим текстом, якщо файл не підходить.
   * Некоректні записи пропускає, а коректні очищає від зайвих полів.
   */
  async function parseImportFile(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (error) {
      throw new Error('Це не схоже на файл копії: його не вдалося прочитати.');
    }
    const source = Array.isArray(data) ? data : data && data.places;
    if (!Array.isArray(source)) throw new Error('У файлі немає списку місць.');

    const places = [];
    source.forEach((item, index) => {
      if (!item || typeof item.city !== 'string' || !item.city.trim()) return;
      const country = DM.geo.byCode.get(String(item.countryCode || '').toUpperCase());
      if (!country) return;
      places.push({
        id: typeof item.id === 'string' && item.id ? item.id : DM.utils.uid(),
        city: item.city.trim().slice(0, 80),
        countryCode: country.a,
        status: item.status === 'visited' ? 'visited' : 'planned',
        note: typeof item.note === 'string' ? item.note.slice(0, 400) : '',
        when: typeof item.when === 'string' ? item.when.slice(0, 40) : '',
        photo: typeof item.photo === 'string' && item.photo.startsWith('data:image/') ? item.photo : null,
        lat: Number.isFinite(item.lat) ? item.lat : null,
        lon: Number.isFinite(item.lon) ? item.lon : null,
        createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now() + index,
        visitedAt: Number.isFinite(item.visitedAt) ? item.visitedAt : null,
      });
    });

    if (!places.length) throw new Error('У файлі не знайдено жодного коректного місця.');
    return places;
  }

  DM.storage = { load, save, loadTheme, saveTheme, exportToFile, parseImportFile };
})();
