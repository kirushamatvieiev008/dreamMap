/**
 * Генератор даних для мапи світу.
 *
 * Запускається ОДИН РАЗ розробником (на сайті Node не потрібен):
 *   cd tools && npm install && npm run build
 *
 * Що робить:
 *  1. Бере контури країн (TopoJSON, Natural Earth) з пакета world-atlas.
 *  2. Проєктує їх у плоскі SVG-шляхи проєкцією Natural Earth 1.
 *  3. Рахує для кожної країни точку для прапорця (центр найбільшої частини) та рамку для наближення.
 *  4. Додає українські назви країн та альтернативні назви для пошуку.
 *  5. Пише два файли, які підключає index.html:
 *       js/data/world-data.js  — геометрія (шляхи SVG)
 *       js/data/countries.js   — довідник країн
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';
import { presimplify, simplify, quantile } from 'topojson-simplify';
import {
  geoNaturalEarth1,
  geoPath,
  geoCentroid,
  geoArea,
  geoGraticule,
} from 'd3-geo';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../js/data');

const iso = require('i18n-iso-countries');
iso.registerLocale(require('i18n-iso-countries/langs/uk.json'));
iso.registerLocale(require('i18n-iso-countries/langs/en.json'));
const worldCountries = require('world-countries/countries.json');
const countries50Full = require('world-atlas/countries-50m.json');
// Трохи спрощуємо контури, щоб SVG був легшим і мапа рухалась плавно.
// SIMPLIFY (0..1) — рівень деталізації контурів: більше значення = детальніше, але важчий файл.
const SIMPLIFY_SHARE = Number(process.env.SIMPLIFY || 0.5);
const presimplified = presimplify(countries50Full);
const countries50 = simplify(presimplified, quantile(presimplified, SIMPLIFY_SHARE));
const land110 = require('world-atlas/land-110m.json');

/* ---------- Проєкція ---------- */

const WIDTH = 1000;                 // ширина "світу" в умовних одиницях SVG
const LAT_TOP = 84;                 // верхня межа карти (Гренландія, Шпіцберген)
const LAT_BOTTOM = -58;             // нижня межа (Вогняна Земля); Антарктиду не показуємо

const projection = geoNaturalEarth1().fitWidth(WIDTH, { type: 'Sphere' });
const [tx0, ty0] = projection.translate();
const yTop = projection([0, LAT_TOP])[1];
const yBottom = projection([0, LAT_BOTTOM])[1];
projection.translate([tx0, ty0 - yTop]);   // зсуваємо, щоб верх карти був у y = 0
const HEIGHT = Math.round((yBottom - yTop) * 10) / 10;
const SCALE = projection.scale();
const [TX, TY] = projection.translate();

const toPath = geoPath(projection).digits(1);

/* ---------- Країни з контурами ---------- */

// Об'єкти без ISO-коду в Natural Earth: прив'язуємо вручну
const MANUAL_A2 = {
  Kosovo: 'XK',
  'N. Cyprus': 'CY',
  Somaliland: 'SO',
};

const features = feature(countries50, countries50.objects.countries).features;
const byA2 = new Map(); // a2 -> { features: [] }

for (const f of features) {
  if (f.id === '010') continue; // Антарктида
  let a2 = f.id ? iso.numericToAlpha2(f.id) : MANUAL_A2[f.properties.name];
  if (!a2) {
    console.warn('Пропускаю без коду:', f.properties.name);
    continue;
  }
  if (!byA2.has(a2)) byA2.set(a2, []);
  byA2.get(a2).push(f);
}

/** Розбиває Feature на окремі полігони. */
function polygonsOf(f) {
  const g = f.geometry;
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}

function largestPolygon(feats) {
  let best = null;
  let bestArea = -1;
  for (const f of feats) {
    for (const coords of polygonsOf(f)) {
      const poly = { type: 'Polygon', coordinates: coords };
      const area = geoArea(poly);
      if (area > bestArea) {
        bestArea = area;
        best = poly;
      }
    }
  }
  return best;
}

const round1 = (n) => Math.round(n * 10) / 10;

const shapes = {};     // a2 -> рядок "d" для <path>
const geo = {};        // a2 -> { x, y, bbox }

for (const [a2, feats] of byA2) {
  shapes[a2] = feats.map((f) => toPath(f)).filter(Boolean).join('');
  const poly = largestPolygon(feats);
  const [cx, cy] = projection(geoCentroid(poly));
  const [[bx0, by0], [bx1, by1]] = geoPath(projection).bounds(poly);
  geo[a2] = {
    x: round1(cx),
    y: round1(cy),
    bbox: [round1(bx0), round1(by0), round1(bx1), round1(by1)],
  };
}

/* ---------- Країни без контурів (дуже малі) ---------- */

const latlngByA2 = new Map(worldCountries.map((c) => [c.cca2, c.latlng]));
// Не показуємо необжиті території й Антарктиду
const EXCLUDED = new Set(['AQ', 'BV', 'HM', 'GS', 'TF', 'UM', 'IO']);

/* ---------- Назви ---------- */

// Коротші/звичніші українські назви замість офіційних
const NAME_OVERRIDES = {
  KR: 'Південна Корея',
  KP: 'Північна Корея',
  TW: 'Тайвань',
  CI: "Кот-д'Івуар",
  GB: 'Велика Британія',
  PS: 'Палестина',
  RU: 'Росія',
  VA: 'Ватикан',
  CD: 'ДР Конго',
  CG: 'Республіка Конго',
};

// Додаткові назви, за якими людина може шукати країну
const EXTRA_ALIASES = {
  US: ['США', 'Сполучені Штати', 'Америка', 'USA', 'United States', 'USA'],
  GB: ['Великобританія', 'Британія', 'Англія', 'Шотландія', 'Уельс', 'UK', 'England', 'Scotland'],
  AE: ['ОАЕ', 'Емірати', 'Дубай', 'UAE'],
  KR: ['Корея', 'Республіка Корея', 'Korea'],
  CZ: ['Чехія', 'Чеська Республіка', 'Czechia', 'Czech Republic'],
  MM: ['Бірма', 'Myanmar', 'Burma'],
  NL: ['Голландія', 'Holland'],
  MK: ['Македонія'],
  SZ: ['Свазіленд', 'Есватіні'],
  CV: ['Кабо-Верде', 'Кейп-Верде'],
  TR: ['Туреччина', 'Turkiye', 'Türkiye'],
  CI: ['Берег Слонової Кістки', 'Ivory Coast'],
  TL: ['Східний Тимор'],
  VA: ['Ватикан', 'Святий Престол'],
  RU: ['Росія', 'РФ'],
  CD: ['Конго', 'Демократична Республіка Конго'],
  CG: ['Конго', 'Республіка Конго'],
  LK: ['Цейлон'],
  TH: ['Тайланд', 'Thailand'],
  VN: ['В\'єтнам'],
  UA: ['Україна', 'Ukraine'],
};

const ukNamesAll = iso.getNames('uk', { select: 'all' });
const enNamesAll = iso.getNames('en', { select: 'all' });

const list = [];
for (const a2 of Object.keys(iso.getAlpha2Codes())) {
  if (EXCLUDED.has(a2)) continue;

  const uk = NAME_OVERRIDES[a2] || iso.getName(a2, 'uk') || a2;
  const en = iso.getName(a2, 'en') || a2;

  const aliases = new Set([
    ...(ukNamesAll[a2] || []),
    ...(enNamesAll[a2] || []),
    ...(EXTRA_ALIASES[a2] || []),
    iso.getAlpha3Code(a2, 'en') || '',
    a2,
  ]);
  aliases.delete(uk);
  aliases.delete(en);
  aliases.delete('');

  let point = geo[a2];
  let hasShape = !!shapes[a2];
  if (!point) {
    const ll = latlngByA2.get(a2);
    if (!ll) {
      console.warn('Немає координат для', a2, uk);
      continue;
    }
    const [x, y] = projection([ll[1], ll[0]]);
    point = { x: round1(x), y: round1(y), bbox: null };
  }

  list.push({
    a: a2,
    n: uk,
    e: en,
    al: [...aliases],
    x: point.x,
    y: point.y,
    s: hasShape ? 1 : 0,
    b: point.bbox,
  });
}

// Косово не має офіційного ISO-коду в i18n-iso-countries v7 як alpha-2 у getAlpha2Codes
if (!list.find((c) => c.a === 'XK') && geo.XK) {
  list.push({
    a: 'XK',
    n: 'Косово',
    e: 'Kosovo',
    al: ['Kosovo', 'Kosova'],
    x: geo.XK.x,
    y: geo.XK.y,
    s: 1,
    b: geo.XK.bbox,
  });
}

list.sort((p, q) => p.n.localeCompare(q.n, 'uk'));

/* ---------- Мінімапа: суша 110m без Антарктиди ---------- */

const landFeature = feature(land110, land110.objects.land);
const landPolys = polygonsOf(
  landFeature.type === 'FeatureCollection' ? landFeature.features[0] : landFeature
).filter((coords) => {
  const [, lat] = geoCentroid({ type: 'Polygon', coordinates: coords });
  return lat > -60;
});
const minimapLand = toPath({ type: 'MultiPolygon', coordinates: landPolys });

/* ---------- Сітка меридіанів/паралелей ---------- */

const graticule = geoGraticule()
  .extent([[-180, LAT_BOTTOM], [180, LAT_TOP]])
  .step([30, 30])
  .stepMinor([30, 30]);
const graticulePath = toPath(graticule());

/* ---------- Перевірка формули проєкції для браузера ---------- */

function rawNaturalEarth1(lon, lat) {
  const l = (lon * Math.PI) / 180;
  const p = (lat * Math.PI) / 180;
  const p2 = p * p;
  const p4 = p2 * p2;
  return [
    l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4))),
    p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))),
  ];
}
for (const [lon, lat] of [[30.5, 50.4], [139.7, 35.7], [-74, 40.7], [151.2, -33.9]]) {
  const [rx, ry] = rawNaturalEarth1(lon, lat);
  const mine = [TX + SCALE * rx, TY - SCALE * ry];
  const d3p = projection([lon, lat]);
  if (Math.abs(mine[0] - d3p[0]) > 0.01 || Math.abs(mine[1] - d3p[1]) > 0.01) {
    throw new Error(`Формула проєкції розходиться з d3 для ${lon},${lat}`);
  }
}

/* ---------- Запис файлів ---------- */

fs.mkdirSync(outDir, { recursive: true });

const worldData = {
  w: WIDTH,
  h: HEIGHT,
  proj: { k: round1(SCALE * 1000) / 1000, tx: TX, ty: TY },
  graticule: graticulePath,
  land: minimapLand,
  shapes,
};

fs.writeFileSync(
  path.join(outDir, 'world-data.js'),
  `/* Автогенерація: tools/build-world-data.mjs. Не редагуйте вручну.\n   Контури: Natural Earth (public domain) через пакет world-atlas. */\nwindow.DM_WORLD = ${JSON.stringify(worldData)};\n`
);

fs.writeFileSync(
  path.join(outDir, 'countries.js'),
  `/* Автогенерація: tools/build-world-data.mjs. Не редагуйте вручну.\n   a — код ISO alpha-2, n — назва українською, e — англійською, al — інші назви,\n   x/y — точка прапорця на мапі, s — чи є контур країни, b — рамка країни. */\nwindow.DM_COUNTRIES = ${JSON.stringify(list)};\n`
);

const kb = (f) => (fs.statSync(path.join(outDir, f)).size / 1024).toFixed(0) + ' КБ';
console.log('Карта:', WIDTH, '×', HEIGHT);
console.log('Країн у довіднику:', list.length, '| з контурами:', Object.keys(shapes).length);
console.log('world-data.js:', kb('world-data.js'), '| countries.js:', kb('countries.js'));
