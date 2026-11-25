/* ==========================================================================
   map.js — інтерактивна мапа світу: контури країн, масштабування й перетягування,
   прапорці-піни, підказки та вікно країни.

   Система координат: «світ» має розмір W × H одиниць (див. world-data.js).
   Вигляд описують три числа: k (пікселів на одиницю), tx, ty (зсув у пікселях).
   Точка світу (wx, wy) на екрані має координати (tx + wx·k, ty + wy·k).
   ========================================================================== */
(function () {
  'use strict';

  const DM = window.DM;
  const { el, icon, clamp, createFlag, pluralize, hues, prefersReducedMotion } = DM.utils;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PLACE_FORMS = ['місце', 'місця', 'місць'];

  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  /** Елементи, всередині яких перетягування мапи не починається. */
  const UI_SELECTOR = '.pin, .city-dot, .map-zoom, .minimap, .map-popover, .map-legend';

  class WorldMap {
    /**
     * @param {object} els       DOM-елементи мапи
     * @param {object} handlers  { onAddPlace(a2), onEditPlace(id), onTogglePlace(id, element) }
     */
    constructor(els, handlers) {
      Object.assign(this, els);
      this.handlers = handlers;

      this.world = DM.geo.world;
      this.W = this.world.w;
      this.H = this.world.h;

      this.k = 1;
      this.tx = 0;
      this.ty = 0;
      this.cw = 0;
      this.ch = 0;
      this.minK = 1;
      this.maxK = 14;
      this.ready = false;

      this.places = [];
      this.countryEls = new Map(); // a2 → <path>
      this.pins = new Map();       // a2 → { el, x, y, ... }
      this.dots = new Map();       // id → { el, x, y }
      this.viewListeners = new Set();

      this.pointers = new Map();
      this.drag = null;
      this.pinch = null;
      this.anim = 0;
      this.raf = 0;

      this.linkedA2 = null;
      this.popState = null;        // { a2, wx, wy, fromPin }
      this.scrollHintTimer = 0;

      this._buildShapes();
      this._bindEvents();

      new ResizeObserver(() => this._onResize()).observe(this.stage);
      this._onResize();
    }

    /* ---------------------------------------------------------------- *
     *  Побудова контурів
     * ---------------------------------------------------------------- */
    _buildShapes() {
      this.graticule.setAttribute('d', this.world.graticule);

      const fragment = document.createDocumentFragment();
      for (const [a2, d] of Object.entries(this.world.shapes)) {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('class', 'country');
        path.setAttribute('d', d);
        path.dataset.a2 = a2;
        this.countryEls.set(a2, path);
        fragment.append(path);
      }
      this.countriesGroup.append(fragment);
    }

    /* ---------------------------------------------------------------- *
     *  Вигляд: розміри, обмеження, відмальовування
     * ---------------------------------------------------------------- */
    _onResize() {
      const cw = this.stage.clientWidth;
      const ch = this.stage.clientHeight;
      if (!cw || !ch) return;

      const wasFit = !this.ready || this.k <= this.minK * 1.001;
      const center = this.ready ? this._centerWorld() : [this.W / 2, this.H / 2];

      this.cw = cw;
      this.ch = ch;
      // На широких екранах світ вміщується по ширині; на вузьких — по висоті (з прокруткою вбік)
      this.minK = Math.max(cw / this.W, (ch * 0.82) / this.H);
      this.maxK = this.minK * 14;

      const k = wasFit ? this.minK : this.k;
      const c = wasFit ? [this.W / 2, this.H / 2] : center;
      this._setCenter(c[0], c[1], k);
      this.ready = true;
      this._paint();
    }

    _centerWorld() {
      return [(this.cw / 2 - this.tx) / this.k, (this.ch / 2 - this.ty) / this.k];
    }

    /** Обмежує вигляд так, щоб мапа не «втікала» за межі вікна. */
    _clampView(k, tx, ty) {
      k = clamp(k, this.minK, this.maxK);
      const mw = this.W * k;
      const mh = this.H * k;
      tx = mw <= this.cw ? (this.cw - mw) / 2 : clamp(tx, this.cw - mw, 0);
      ty = mh <= this.ch ? (this.ch - mh) / 2 : clamp(ty, this.ch - mh, 0);
      return { k, tx, ty };
    }

    _setView(k, tx, ty) {
      const v = this._clampView(k, tx, ty);
      this.k = v.k;
      this.tx = v.tx;
      this.ty = v.ty;
      this._schedulePaint();
    }

    _setCenter(wx, wy, k = this.k) {
      k = clamp(k, this.minK, this.maxK);
      this._setView(k, this.cw / 2 - wx * k, this.ch / 2 - wy * k);
    }

    _schedulePaint() {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this._paint();
      });
    }

    /** Застосовує поточний вигляд до SVG, шпильок і вікна країни. */
    _paint() {
      const { k, tx, ty } = this;
      this.viewport.setAttribute('transform', `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${k.toFixed(4)})`);

      const zoomLevel = Math.log2(k / this.minK);
      this.stage.style.setProperty('--pin', clamp(26 + zoomLevel * 3.2, 26, 40).toFixed(1) + 'px');
      this.stage.classList.toggle('is-zoomed', k >= this.minK * 2.2);

      for (const pin of this.pins.values()) this._place(pin);
      for (const dot of this.dots.values()) this._place(dot);
      this._positionPopover();

      this.viewListeners.forEach((fn) => fn(this.getView()));
    }

    _place(item) {
      item.el.style.transform = `translate3d(${(this.tx + item.x * this.k).toFixed(1)}px, ${(this.ty + item.y * this.k).toFixed(1)}px, 0)`;
    }

    /* ---------------------------------------------------------------- *
     *  Публічний API
     * ---------------------------------------------------------------- */

    /** Яка частина світу зараз видна (у координатах світу). */
    getView() {
      return {
        x0: -this.tx / this.k,
        y0: -this.ty / this.k,
        x1: (this.cw - this.tx) / this.k,
        y1: (this.ch - this.ty) / this.k,
        k: this.k,
        fit: this.k <= this.minK * 1.001,
      };
    }

    onView(fn) {
      this.viewListeners.add(fn);
      fn(this.getView());
    }

    /** Переносить центр вікна в точку світу (без анімації) — для мінімапи. */
    centerOn(wx, wy) {
      this._stopAnim();
      this._setCenter(wx, wy);
    }

    zoomBy(factor) {
      const [cx, cy] = this._centerWorld();
      this._flyTo(cx, cy, this.k * factor, 260);
    }

    fit() {
      this._closePopover();
      this._flyTo(this.W / 2, this.H / 2, this.minK, 600);
    }

    /** Плавно наближає країну й відкриває її вікно. */
    async focusCountry(a2, { popover = true } = {}) {
      const country = DM.geo.byCode.get(a2);
      if (!country) return;

      let k = this.minK * 8;
      let cx = country.x;
      let cy = country.y;
      if (country.b) {
        const [x0, y0, x1, y1] = country.b;
        const bw = Math.max(x1 - x0, 1);
        const bh = Math.max(y1 - y0, 1);
        k = clamp(Math.min((this.cw * 0.5) / bw, (this.ch * 0.42) / bh), this.minK * 2.2, this.minK * 9);
        cx = (x0 + x1) / 2;
        cy = (y0 + y1) / 2;
      }
      // Трохи опускаємо центр, щоб над шпилькою було місце для вікна
      await this._flyTo(cx, cy - (this.ch * 0.1) / k, k, 750);
      if (popover) this._openPopover(a2, country.x, country.y, true);
    }

    /** Підсвічує країну, коли користувач наводить курсор на картку у списку. */
    setLinked(a2) {
      if (this.linkedA2 === a2) return;
      this._toggleHighlight(this.linkedA2, 'is-linked', false);
      this.linkedA2 = a2;
      this._toggleHighlight(a2, 'is-linked', true);
    }

    _toggleHighlight(a2, className, on) {
      if (!a2) return;
      const path = this.countryEls.get(a2);
      if (path) path.classList.toggle(className, on);
      const pin = this.pins.get(a2);
      if (pin) pin.el.classList.toggle(className, on);
    }

    /* ---------------------------------------------------------------- *
     *  Відмальовування даних (країни, піни, точки міст)
     * ---------------------------------------------------------------- */
    render(places, change) {
      this.places = places;

      const groups = new Map();
      for (const place of places) {
        if (!groups.has(place.countryCode)) groups.set(place.countryCode, []);
        groups.get(place.countryCode).push(place);
      }

      // Заливка країн: золота, поки є невідвідані місця; зелена, коли всі відвідані
      for (const [a2, path] of this.countryEls) {
        const group = groups.get(a2);
        const allVisited = !!group && group.every((p) => p.status === 'visited');
        path.classList.toggle('is-planned', !!group && !allVisited);
        path.classList.toggle('is-visited', allVisited);
      }

      // Піни-прапорці
      const addedCountry =
        change && change.type === 'add' ? (places.find((p) => p.id === change.id) || {}).countryCode : null;

      for (const [a2, group] of groups) {
        const country = DM.geo.byCode.get(a2);
        if (!country) continue;

        let pin = this.pins.get(a2);
        if (!pin) {
          pin = this._createPin(country);
          this.pins.set(a2, pin);
          this.pinLayer.append(pin.el);
        }

        const visited = group.filter((p) => p.status === 'visited').length;
        const allVisited = visited === group.length;
        pin.el.dataset.state = allVisited ? 'visited' : 'planned';
        pin.count.textContent = group.length;
        pin.count.hidden = group.length < 2;
        pin.check.hidden = !allVisited;
        pin.el.setAttribute(
          'aria-label',
          `${country.n}: ${group.length} ${pluralize(group.length, PLACE_FORMS)}. Відкрити список`
        );
        pin.el.style.zIndex = String(Math.round(country.y));

        if (a2 === addedCountry) this._pulse(pin.el);
      }
      for (const [a2, pin] of this.pins) {
        if (!groups.has(a2)) {
          pin.el.remove();
          this.pins.delete(a2);
        }
      }

      // Точки конкретних міст (якщо вдалось визначити координати)
      const withCoords = places.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
      const keep = new Set(withCoords.map((p) => p.id));
      for (const place of withCoords) {
        let dot = this.dots.get(place.id);
        if (!dot) {
          const [x, y] = DM.geo.project(place.lon, place.lat);
          const node = el('button', {
            class: 'city-dot',
            type: 'button',
            tabindex: '-1',
            'aria-label': place.city,
            dataset: { id: place.id },
          });
          dot = { el: node, x, y };
          this.dots.set(place.id, dot);
          this.pinLayer.append(node);
        }
        dot.el.dataset.state = place.status;
      }
      for (const [id, dot] of this.dots) {
        if (!keep.has(id)) {
          dot.el.remove();
          this.dots.delete(id);
        }
      }

      // Вікно країни: оновлюємо або закриваємо, якщо країни більше немає у списку
      if (this.popState) {
        if (this.popState.fromPin && !groups.has(this.popState.a2)) this._closePopover();
        else this._renderPopover();
      }

      this._paint();
    }

    _createPin(country) {
      const count = el('span', { class: 'pin-count', hidden: true });
      const check = el('span', { class: 'pin-check', hidden: true }, icon('check'));
      const node = el(
        'button',
        { class: 'pin', type: 'button', dataset: { a2: country.a } },
        el('span', { class: 'pin-flag' }, createFlag(country.a, '', 80)),
        count,
        check
      );
      return { el: node, x: country.x, y: country.y, count, check };
    }

    _pulse(node) {
      node.classList.remove('is-new');
      void node.offsetWidth; // перезапуск анімації
      node.classList.add('is-new');
      setTimeout(() => node.classList.remove('is-new'), 4800);
    }

    /* ---------------------------------------------------------------- *
     *  Анімація польоту
     * ---------------------------------------------------------------- */
    _stopAnim() {
      if (this.anim) cancelAnimationFrame(this.anim);
      this.anim = 0;
    }

    _flyTo(wx, wy, k, duration = 700) {
      this._stopAnim();
      k = clamp(k, this.minK, this.maxK);
      const target = this._clampView(k, this.cw / 2 - wx * k, this.ch / 2 - wy * k);

      if (prefersReducedMotion() || duration <= 0) {
        this._setView(target.k, target.tx, target.ty);
        return Promise.resolve();
      }

      const fromK = this.k;
      const [fromX, fromY] = this._centerWorld();
      const toX = (this.cw / 2 - target.tx) / target.k;
      const toY = (this.ch / 2 - target.ty) / target.k;
      const start = performance.now();

      return new Promise((resolve) => {
        const step = (now) => {
          const t = Math.min(1, (now - start) / duration);
          const e = easeInOut(t);
          this.k = fromK * Math.pow(target.k / fromK, e);
          const cx = fromX + (toX - fromX) * e;
          const cy = fromY + (toY - fromY) * e;
          this.tx = this.cw / 2 - cx * this.k;
          this.ty = this.ch / 2 - cy * this.k;
          this._paint();
          if (t < 1) this.anim = requestAnimationFrame(step);
          else {
            this.anim = 0;
            resolve();
          }
        };
        this.anim = requestAnimationFrame(step);
      });
    }

    /* ---------------------------------------------------------------- *
     *  Події: перетягування, масштаб, клавіатура, наведення
     * ---------------------------------------------------------------- */
    _bindEvents() {
      const stage = this.stage;

      stage.addEventListener('pointerdown', (e) => this._onPointerDown(e));
      stage.addEventListener('pointermove', (e) => this._onPointerMove(e));
      stage.addEventListener('pointerup', (e) => this._onPointerUp(e));
      stage.addEventListener('pointercancel', (e) => this._onPointerUp(e, true));
      stage.addEventListener('pointerleave', () => this._hideTip());
      stage.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
      stage.addEventListener('keydown', (e) => this._onKey(e));

      stage.addEventListener('dblclick', (e) => {
        if (e.target.closest('.country, ' + UI_SELECTOR)) return;
        const [wx, wy] = this._clientToWorld(e.clientX, e.clientY);
        this._flyTo(wx, wy, this.k * 2, 380);
      });

      this.zoomInBtn.addEventListener('click', () => this.zoomBy(1.8));
      this.zoomOutBtn.addEventListener('click', () => this.zoomBy(1 / 1.8));
      this.zoomFitBtn.addEventListener('click', () => this.fit());

      // Піни й точки міст
      this.pinLayer.addEventListener('click', (e) => {
        const pin = e.target.closest('.pin');
        if (pin) {
          const country = DM.geo.byCode.get(pin.dataset.a2);
          this._openPopover(pin.dataset.a2, country.x, country.y, true);
          return;
        }
        const dot = e.target.closest('.city-dot');
        if (dot) {
          const place = this.places.find((p) => p.id === dot.dataset.id);
          if (place) {
            const d = this.dots.get(place.id);
            this._openPopover(place.countryCode, d.x, d.y, false);
          }
        }
      });
      this.pinLayer.addEventListener('pointerover', (e) => this._onPinHover(e));
      this.pinLayer.addEventListener('pointermove', (e) => this._moveTip(e.clientX, e.clientY));
      this.pinLayer.addEventListener('pointerout', (e) => {
        if (e.target.closest('.pin, .city-dot')) this._hideTip();
      });

      // Вікно країни
      this.popover.addEventListener('click', (e) => this._onPopoverClick(e));
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.popState) {
          this._closePopover();
          this.stage.focus({ preventScroll: true });
        }
      });
    }

    _clientToWorld(clientX, clientY) {
      const rect = this.stage.getBoundingClientRect();
      return [(clientX - rect.left - this.tx) / this.k, (clientY - rect.top - this.ty) / this.k];
    }

    _onPointerDown(e) {
      if (e.target.closest(UI_SELECTOR)) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      this._stopAnim();
      this.stage.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this._hideTip();

      if (this.pointers.size === 1) {
        const countryEl = e.target.closest('.country');
        this.drag = {
          startX: e.clientX,
          startY: e.clientY,
          lastX: e.clientX,
          lastY: e.clientY,
          moved: false,
          a2: countryEl ? countryEl.dataset.a2 : null,
        };
        this.pinch = null;
      } else if (this.pointers.size === 2) {
        const [p1, p2] = [...this.pointers.values()];
        this.pinch = { dist: Math.hypot(p1.x - p2.x, p1.y - p2.y) };
        if (this.drag) this.drag.moved = true; // два пальці — це вже не клік
      }
    }

    _onPointerMove(e) {
      // Наведення без натискання: підказка про країну
      if (!this.pointers.has(e.pointerId)) {
        if (e.pointerType === 'mouse') this._onHover(e);
        return;
      }

      const prev = this.pointers.get(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.pointers.size === 2 && this.pinch) {
        const [p1, p2] = [...this.pointers.values()];
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const rect = this.stage.getBoundingClientRect();
        const mx = (p1.x + p2.x) / 2 - rect.left;
        const my = (p1.y + p2.y) / 2 - rect.top;
        this._zoomAt(dist / this.pinch.dist, mx, my);
        this.pinch.dist = dist;
        return;
      }

      if (this.drag && this.pointers.size === 1) {
        const dx = e.clientX - this.drag.lastX;
        const dy = e.clientY - this.drag.lastY;
        this.drag.lastX = e.clientX;
        this.drag.lastY = e.clientY;

        if (!this.drag.moved) {
          const total = Math.hypot(e.clientX - this.drag.startX, e.clientY - this.drag.startY);
          if (total < 5) return; // ще вважаємо кліком
          this.drag.moved = true;
          this.stage.classList.add('is-dragging');
        }
        this._setView(this.k, this.tx + dx, this.ty + dy);
      }
      void prev;
    }

    _onPointerUp(e, cancelled = false) {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.stage.hasPointerCapture(e.pointerId)) this.stage.releasePointerCapture(e.pointerId);

      if (this.pointers.size === 0) {
        const drag = this.drag;
        this.drag = null;
        this.pinch = null;
        this.stage.classList.remove('is-dragging');

        if (drag && !drag.moved && !cancelled) {
          // Це був клік, а не перетягування
          if (drag.a2) {
            const [wx, wy] = this._clientToWorld(e.clientX, e.clientY);
            this._openPopover(drag.a2, wx, wy, false);
          } else {
            this._closePopover();
          }
        }
      } else if (this.pointers.size === 1) {
        // З двох пальців лишився один: далі просто тягнемо, але без кліку
        const [rest] = [...this.pointers.values()];
        this.drag = { startX: rest.x, startY: rest.y, lastX: rest.x, lastY: rest.y, moved: true, a2: null };
        this.pinch = null;
      }
    }

    _onWheel(e) {
      // Колесо без Ctrl гортає сторінку (щоб мапа не «ловила» прокрутку).
      // Ctrl/⌘ + колесо та щипок на тачпаді (він надходить як Ctrl + колесо) змінюють масштаб.
      if (!(e.ctrlKey || e.metaKey)) {
        this._showScrollHint();
        return;
      }
      e.preventDefault();
      this._stopAnim();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const rect = this.stage.getBoundingClientRect();
      this._zoomAt(Math.exp(-delta * 0.0025), e.clientX - rect.left, e.clientY - rect.top);
    }

    _showScrollHint() {
      this.scrollHint.hidden = false;
      clearTimeout(this.scrollHintTimer);
      this.scrollHintTimer = setTimeout(() => (this.scrollHint.hidden = true), 1600);
    }

    /** Масштабує відносно точки екрана, щоб точка під курсором лишалась на місці. */
    _zoomAt(factor, sx, sy) {
      const k = clamp(this.k * factor, this.minK, this.maxK);
      const wx = (sx - this.tx) / this.k;
      const wy = (sy - this.ty) / this.k;
      this._setView(k, sx - wx * k, sy - wy * k);
    }

    _onKey(e) {
      if (e.target !== this.stage) return;
      const step = 90;
      const actions = {
        ArrowLeft: () => this._setView(this.k, this.tx + step, this.ty),
        ArrowRight: () => this._setView(this.k, this.tx - step, this.ty),
        ArrowUp: () => this._setView(this.k, this.tx, this.ty + step),
        ArrowDown: () => this._setView(this.k, this.tx, this.ty - step),
        '+': () => this.zoomBy(1.6),
        '=': () => this.zoomBy(1.6),
        '-': () => this.zoomBy(1 / 1.6),
        '_': () => this.zoomBy(1 / 1.6),
        0: () => this.fit(),
      };
      const action = actions[e.key];
      if (action) {
        e.preventDefault();
        this._stopAnim();
        action();
      }
    }

    /* ---------------------------------------------------------------- *
     *  Підказки при наведенні
     * ---------------------------------------------------------------- */
    _onHover(e) {
      if (e.target.closest(UI_SELECTOR)) return;
      const countryEl = e.target.closest('.country');
      if (!countryEl) return this._hideTip();

      const country = DM.geo.byCode.get(countryEl.dataset.a2);
      if (!country) return this._hideTip();

      const group = this.places.filter((p) => p.countryCode === country.a);
      const sub = group.length
        ? `${group.length} ${pluralize(group.length, PLACE_FORMS)}, натисни, щоб відкрити`
        : 'Натисни, щоб додати місце';
      this._showTip(country.n, sub, e.clientX, e.clientY);
    }

    _onPinHover(e) {
      const pin = e.target.closest('.pin');
      if (pin) {
        const country = DM.geo.byCode.get(pin.dataset.a2);
        const group = this.places.filter((p) => p.countryCode === country.a);
        const visited = group.filter((p) => p.status === 'visited').length;
        const sub = `${group.length} ${pluralize(group.length, PLACE_FORMS)}` + (visited ? `, відвідано ${visited}` : '');
        return this._showTip(country.n, sub, e.clientX, e.clientY);
      }
      const dot = e.target.closest('.city-dot');
      if (dot) {
        const place = this.places.find((p) => p.id === dot.dataset.id);
        if (place) {
          const country = DM.geo.byCode.get(place.countryCode);
          this._showTip(place.city, country ? country.n : '', e.clientX, e.clientY);
        }
      }
    }

    _showTip(title, sub, clientX, clientY) {
      this.tooltip.replaceChildren(el('strong', {}, title), sub ? el('span', {}, sub) : null);
      this.tooltip.hidden = false;
      this._moveTip(clientX, clientY);
    }

    _moveTip(clientX, clientY) {
      if (this.tooltip.hidden) return;
      const rect = this.stage.getBoundingClientRect();
      const w = this.tooltip.offsetWidth;
      const h = this.tooltip.offsetHeight;
      let x = clientX - rect.left + 16;
      let y = clientY - rect.top + 18;
      if (x + w > rect.width - 8) x = clientX - rect.left - w - 16;
      if (y + h > rect.height - 8) y = clientY - rect.top - h - 16;
      this.tooltip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
    }

    _hideTip() {
      this.tooltip.hidden = true;
    }

    /* ---------------------------------------------------------------- *
     *  Вікно країни
     * ---------------------------------------------------------------- */
    _openPopover(a2, wx, wy, fromPin) {
      this._hideTip();
      if (this.popState) this._toggleHighlight(this.popState.a2, 'is-selected', false);
      this.popState = { a2, wx, wy, fromPin };
      this._toggleHighlight(a2, 'is-selected', true);
      this._renderPopover();
      this.popover.hidden = false;
      this._positionPopover();
      this.popover.focus({ preventScroll: true });
    }

    _closePopover() {
      if (!this.popState) return;
      this._toggleHighlight(this.popState.a2, 'is-selected', false);
      this.popState = null;
      this.popover.hidden = true;
    }

    _renderPopover() {
      const state = this.popState;
      if (!state) return;
      const country = DM.geo.byCode.get(state.a2);
      const group = this.places.filter((p) => p.countryCode === state.a2);
      const visited = group.filter((p) => p.status === 'visited').length;

      const subtitle = group.length
        ? `${group.length} ${pluralize(group.length, PLACE_FORMS)}` + (visited ? `, відвідано ${visited}` : '')
        : 'Поки немає місць';

      const head = el(
        'div',
        { class: 'popover-head' },
        el('span', { class: 'popover-flag' }, createFlag(country.a, '', 80)),
        el('div', { class: 'popover-title' }, el('strong', {}, country.n), el('span', {}, subtitle)),
        el('button', { class: 'icon-btn', type: 'button', 'data-action': 'close', 'aria-label': 'Закрити' }, icon('x'))
      );

      let body;
      if (group.length) {
        body = el(
          'ul',
          { class: 'popover-list' },
          group.map((place) => {
            const [h1, h2] = hues(place.city + place.countryCode);
            const thumb = el('span', {
              class: 'popover-thumb',
              style: place.photo
                ? { backgroundImage: `url("${place.photo}")` }
                : { backgroundImage: `linear-gradient(140deg, hsl(${h1} 62% 42%), hsl(${h2} 70% 24%))` },
            });
            const sub = place.status === 'visited' ? 'Відвідано' : place.when || 'У мріях';
            return el(
              'li',
              { class: 'popover-row', dataset: { id: place.id } },
              thumb,
              el('div', { class: 'popover-row-text' }, el('strong', {}, place.city), el('span', {}, sub)),
              el(
                'button',
                {
                  class: 'icon-btn check-btn',
                  type: 'button',
                  'data-action': 'toggle',
                  'aria-pressed': place.status === 'visited' ? 'true' : 'false',
                  'aria-label': `Відвідано: ${place.city}`,
                  title: 'Позначити відвіданим',
                },
                icon('check')
              ),
              el(
                'button',
                { class: 'icon-btn', type: 'button', 'data-action': 'edit', 'aria-label': `Редагувати: ${place.city}`, title: 'Редагувати' },
                icon('pencil')
              )
            );
          })
        );
      } else {
        body = el('p', { class: 'popover-empty' }, 'Додай сюди місто, куди хочеш потрапити.');
      }

      const foot = el(
        'div',
        { class: 'popover-foot' },
        el(
          'button',
          { class: 'btn btn--secondary btn--small', type: 'button', 'data-action': 'add' },
          icon('plus'),
          group.length ? 'Додати ще місце' : 'Додати місце'
        )
      );

      this.popover.setAttribute('role', 'dialog');
      this.popover.setAttribute('aria-label', country.n);
      this.popover.tabIndex = -1;
      this.popover.replaceChildren(head, body, foot);
    }

    _positionPopover() {
      const state = this.popState;
      if (!state || this.popover.hidden) return;
      const x = this.tx + state.wx * this.k;
      const y = this.ty + state.wy * this.k;
      const w = this.popover.offsetWidth;
      const h = this.popover.offsetHeight;
      const gap = state.fromPin ? parseFloat(getComputedStyle(this.stage).getPropertyValue('--pin') || 28) + 22 : 14;

      let left = x - w / 2;
      let top = y - h - gap;
      if (top < 8) top = y + (state.fromPin ? 18 : 14);
      left = clamp(left, 8, Math.max(8, this.cw - w - 8));
      top = clamp(top, 8, Math.max(8, this.ch - h - 8));
      this.popover.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
    }

    _onPopoverClick(e) {
      const button = e.target.closest('[data-action]');
      if (!button || !this.popState) return;
      const action = button.dataset.action;
      const row = button.closest('.popover-row');
      const id = row ? row.dataset.id : null;

      if (action === 'close') this._closePopover();
      else if (action === 'add') this.handlers.onAddPlace(this.popState.a2);
      else if (action === 'edit' && id) this.handlers.onEditPlace(id);
      else if (action === 'toggle' && id) this.handlers.onTogglePlace(id, button);
    }
  }

  DM.WorldMap = WorldMap;
})();
