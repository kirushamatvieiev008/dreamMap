/* ==========================================================================
   fx.js — маленький святковий ефект: конфеті, коли місце стає «відвіданим».
   Єдиний «декоративний» рух на сайті: він відповідає на дію користувача.
   ========================================================================== */
(function () {
  'use strict';

  const DM = window.DM;
  const COLORS = ['#3de3b4', '#ffc857', '#a8b8ff', '#ffffff', '#ff8fa3'];

  let canvas;
  let ctx;
  let particles = [];
  let frame = null;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function init() {
    canvas = document.getElementById('fxCanvas');
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function tick() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    particles = particles.filter((p) => p.life > 0 && p.y < window.innerHeight + 40);

    for (const p of particles) {
      p.vy += 0.22;           // гравітація
      p.vx *= 0.992;          // опір повітря
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.spin;
      p.life -= 1;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.min(1, p.life / 24);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.6);
      ctx.restore();
    }

    if (particles.length) {
      frame = requestAnimationFrame(tick);
    } else {
      frame = null;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  /** Викид конфеті з точки екрана (x, y — у пікселях вікна). */
  function burst(x, y) {
    if (!ctx || DM.utils.prefersReducedMotion()) return;
    for (let i = 0; i < 70; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 7;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 4,
        size: 6 + Math.random() * 6,
        rot: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.4,
        life: 60 + Math.random() * 40,
        color: COLORS[(Math.random() * COLORS.length) | 0],
      });
    }
    if (!frame) frame = requestAnimationFrame(tick);
  }

  DM.fx = { init, burst };
})();
