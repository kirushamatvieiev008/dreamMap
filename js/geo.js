/* ==========================================================================
   geo.js — довідник країн, пошук країни за назвою, проєкція координат на мапу
   та (необов'язкове) визначення точного місця міста через OpenStreetMap Nominatim
   ========================================================================== */
(function () {
  'use strict';

  const DM = window.DM;
  const { normalize } = DM.utils;

  const world = window.DM_WORLD;
  const countries = window.DM_COUNTRIES;

  /** Код країни → запис довідника. */
  const byCode = new Map(countries.map((c) => [c.a, c]));

  /* ---------- Пошук країни за введеним текстом ---------- */

  // Індекс: нормалізована назва → країна (українська, англійська, інші назви, коди)
  const nameIndex = new Map();
  for (const country of countries) {
    for (const name of [country.n, country.e, ...country.al]) {
      const key = normalize(name);
      if (key && !nameIndex.has(key)) nameIndex.set(key, country);
    }
  }
  // Основні назви мають пріоритет над випадковими збігами з псевдонімами
  for (const country of countries) {
    nameIndex.set(normalize(country.n), country);
  }

  /**
   * Знаходить країну за тим, що ввів користувач.
   * Спершу точний збіг, потім — єдиний варіант, що починається з введеного тексту.
   */
  function findCountry(input) {
    const key = normalize(input);
    if (!key) return null;
    if (nameIndex.has(key)) return nameIndex.get(key);

    if (key.length >= 3) {
      const matches = countries.filter((c) => normalize(c.n).startsWith(key));
      if (matches.length === 1) return matches[0];
    }
    return null;
  }

  /* ---------- Проєкція ---------- */

  // Та сама формула Natural Earth 1, що й у генераторі (tools/build-world-data.mjs).
  const { k: SCALE, tx: TX, ty: TY } = world.proj;

  /** Широта/довгота → координати на мапі (в одиницях SVG). */
  function project(lon, lat) {
    const l = (lon * Math.PI) / 180;
    const p = (lat * Math.PI) / 180;
    const p2 = p * p;
    const p4 = p2 * p2;
    const x = l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)));
    const y = p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)));
    return [TX + SCALE * x, TY - SCALE * y];
  }

  /* ---------- Пошук координат міста ---------- */

  /**
   * Шукає координати міста у безкоштовному сервісі Nominatim (OpenStreetMap).
   * Це необов'язкова функція: якщо інтернету немає або місто не знайшлось,
   * повертаємо null, а на мапі лишається прапорець країни.
   */
  async function geocode(city, country) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const params = new URLSearchParams({
        q: `${city}, ${country.e}`,
        countrycodes: country.a.toLowerCase(),
        format: 'jsonv2',
        limit: '1',
      });
      const response = await fetch('https://nominatim.openstreetmap.org/search?' + params, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return null;
      const results = await response.json();
      const hit = results && results[0];
      if (!hit) return null;
      const lat = parseFloat(hit.lat);
      const lon = parseFloat(hit.lon);
      return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    } catch (error) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  DM.geo = { world, countries, byCode, findCountry, project, geocode };
})();
