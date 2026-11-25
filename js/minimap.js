/* ==========================================================================
   minimap.js — мінімапа всього світу: суша, прапорці країн із вашого списку
   і рамка того, що зараз видно на великій мапі. Клік або перетягування по
   мінімапі переносять велику мапу в це місце.
   ========================================================================== */
(function () {
  'use strict';

  const DM = window.DM;
  const { el, createFlag } = DM.utils;

  class Minimap {
    /**
     * @param {object} els  { root, svg, land, pins, view }
     * @param {WorldMap} map
     */
    constructor(els, map) {
      Object.assign(this, els);
      this.map = map;
      this.W = DM.geo.world.w;
      this.H = DM.geo.world.h;
      this.pinEls = new Map(); // a2 → елемент

      // Мінімапа має ті самі пропорції, що й світ
      this.root.style.setProperty('--world-ratio', (this.W / this.H).toFixed(4));
      this.svg.setAttribute('viewBox', `0 0 ${this.W} ${this.H}`);
      this.land.setAttribute('d', DM.geo.world.land);

      this._bindEvents();
      map.onView((view) => this._updateView(view));
    }

    /** Перемальовує прапорці за списком місць. */
    render(places) {
      const groups = new Map();
      for (const place of places) {
        if (!groups.has(place.countryCode)) groups.set(place.countryCode, []);
        groups.get(place.countryCode).push(place);
      }

      for (const [a2, group] of groups) {
        const country = DM.geo.byCode.get(a2);
        if (!country) continue;

        let pin = this.pinEls.get(a2);
        if (!pin) {
          pin = el('span', {
            class: 'mini-pin',
            style: {
              left: ((country.x / this.W) * 100).toFixed(2) + '%',
              top: ((country.y / this.H) * 100).toFixed(2) + '%',
            },
          });
          pin.append(createFlag(a2, '', 40));
          this.pinEls.set(a2, pin);
          this.pins.append(pin);
        }
        pin.dataset.state = group.every((p) => p.status === 'visited') ? 'visited' : 'planned';
      }

      for (const [a2, pin] of this.pinEls) {
        if (!groups.has(a2)) {
          pin.remove();
          this.pinEls.delete(a2);
        }
      }
    }

    _updateView(view) {
      const pct = (value, total) => Math.min(100, Math.max(0, (value / total) * 100));
      const left = pct(view.x0, this.W);
      const top = pct(view.y0, this.H);
      const right = pct(view.x1, this.W);
      const bottom = pct(view.y1, this.H);

      Object.assign(this.view.style, {
        left: left + '%',
        top: top + '%',
        width: Math.max(0, right - left) + '%',
        height: Math.max(0, bottom - top) + '%',
      });
      // Коли видно весь світ, рамка не потрібна
      this.view.classList.toggle('is-full', right - left > 97 && bottom - top > 85);
    }

    _bindEvents() {
      const move = (e) => {
        const rect = this.root.getBoundingClientRect();
        const wx = ((e.clientX - rect.left) / rect.width) * this.W;
        const wy = ((e.clientY - rect.top) / rect.height) * this.H;
        this.map.centerOn(wx, wy);
      };

      let dragging = false;
      this.root.addEventListener('pointerdown', (e) => {
        dragging = true;
        this.root.setPointerCapture(e.pointerId);
        move(e);
      });
      this.root.addEventListener('pointermove', (e) => {
        if (dragging) move(e);
      });
      const stop = (e) => {
        dragging = false;
        if (this.root.hasPointerCapture(e.pointerId)) this.root.releasePointerCapture(e.pointerId);
      };
      this.root.addEventListener('pointerup', stop);
      this.root.addEventListener('pointercancel', stop);
    }
  }

  DM.Minimap = Minimap;
})();
