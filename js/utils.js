/* ==========================================================================
   utils.js — маленькі допоміжні функції, які використовують усі модулі
   Усі модулі складені у глобальний простір імен window.DM, щоб сайт працював
   навіть при відкритті файлу подвійним кліком (без сервера й без ES-модулів).
   ========================================================================== */
(function () {
  'use strict';

  const DM = (window.DM = window.DM || {});

  /** Короткі скорочення для пошуку елементів. */
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  /**
   * Створює DOM-елемент.
   * el('button', { class: 'btn', onclick: fn, dataset: { id: 1 } }, 'Текст', іншийЕлемент)
   */
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'style' && typeof value === 'object') {
        // Користувацькі змінні (--h1) потребують setProperty; Object.assign їх ігнорує
        for (const [prop, val] of Object.entries(value)) {
          if (prop.startsWith('--')) node.style.setProperty(prop, val);
          else node.style[prop] = val;
        }
      }
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child === undefined || child === null || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  /** Створює SVG-іконку з набору символів в index.html. */
  function icon(name, className = '') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', ('icon ' + className).trim());
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name);
    svg.append(use);
    return svg;
  }

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function debounce(fn, wait = 150) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /**
   * Нормалізує рядок для порівняння: нижній регістр, без діакритики й апострофів,
   * однакові пробіли. Завдяки цьому «Кот-д'Івуар» і «кот д івуар» — однакові.
   */
  function normalize(str) {
    return String(str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[’'`ʼ‘]/g, '')
      .replace(/[\s\-–—_.,]+/g, ' ')
      .trim();
  }

  /** Стабільне число з рядка (для кольорів згенерованих обкладинок). */
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** Два відтінки для згенерованої обкладинки місця без фото. */
  function hues(seed) {
    const h = hash(String(seed));
    const h1 = h % 360;
    const h2 = (h1 + 40 + ((h >>> 9) % 80)) % 360;
    return [h1, h2];
  }

  /** Правильна форма слова: pluralize(3, ['місце', 'місця', 'місць']) → «місця». */
  function pluralize(n, forms) {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return forms[2];
    if (last > 1 && last < 5) return forms[1];
    if (last === 1) return forms[0];
    return forms[2];
  }

  const prefersReducedMotion = () =>
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Прапорці ---------- */

  /** Прапор-емодзі з коду країни (на Windows емодзі-прапори не малюються, тому є картинки). */
  function flagEmoji(a2) {
    if (!a2 || a2.length !== 2) return '🏳️';
    const base = 0x1f1e6;
    return String.fromCodePoint(
      ...a2
        .toUpperCase()
        .split('')
        .map((ch) => base + ch.charCodeAt(0) - 65)
    );
  }

  const flagUrl = (a2, width = 80) => `https://flagcdn.com/w${width}/${a2.toLowerCase()}.png`;

  /**
   * Елемент із прапором країни. Якщо картинка не завантажилась (немає інтернету),
   * показуємо прапор-емодзі.
   */
  function createFlag(a2, className = 'flag', width = 80) {
    const img = document.createElement('img');
    img.className = className;
    img.alt = '';
    img.width = 40;
    img.height = 40;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.src = flagUrl(a2, width);
    img.addEventListener(
      'error',
      () => {
        const span = document.createElement('span');
        span.className = className + ' flag-emoji';
        span.textContent = flagEmoji(a2);
        img.replaceWith(span);
      },
      { once: true }
    );
    return img;
  }

  /** Місяць і рік українською: «листопад 2026». */
  function formatMonthYear(timestamp) {
    return new Date(timestamp).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });
  }

  DM.utils = {
    $, $$, el, icon, clamp, debounce, uid, normalize, hash, hues, pluralize,
    prefersReducedMotion, flagEmoji, flagUrl, createFlag, formatMonthYear,
  };
})();
