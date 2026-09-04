/* La Compagnie de l'Or · Accueil classique
   Ambiance Jour/Nuit (meme cle localStorage que l'experience immersive), parallaxe subtile, menu mobile. */
(function () {
  'use strict';

  /* ---- Ambiance Jour / Nuit : choix individuel par navigateur ---- */
  var toggle = document.getElementById('ab-toggle');
  function setAmbiance(mode, save) {
    document.documentElement.dataset.ambiance = mode;
    if (save) { try { localStorage.setItem('compagnie-or-ambiance', mode); } catch (e) {} }
    if (toggle) {
      var btns = toggle.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var on = btns[i].dataset.ab === mode;
        btns[i].classList.toggle('is-active', on);
        btns[i].setAttribute('aria-pressed', on);
      }
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'jour' ? '#f4efe6' : '#0b0a08');
  }
  setAmbiance(document.documentElement.dataset.ambiance === 'jour' ? 'jour' : 'nuit', false);
  if (toggle) toggle.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-ab]');
    if (b) setAmbiance(b.dataset.ab, true);
  });

  /* ---- Parallaxe tres legere du visuel hero (desktop, pointeur fin) ---- */
  var bg = document.getElementById('heroBg');
  if (bg && matchMedia('(pointer:fine)').matches && !matchMedia('(prefers-reduced-motion:reduce)').matches) {
    var raf = 0, tx = 0, ty = 0;
    addEventListener('mousemove', function (e) {
      tx = (e.clientX / innerWidth - 0.5) * -10;   // quelques pixels seulement
      ty = (e.clientY / innerHeight - 0.5) * -6;
      if (!raf) raf = requestAnimationFrame(apply);
    }, { passive: true });
    var apply = function () {
      raf = 0;
      var plate = document.getElementById('heroPlate');
      if (plate) plate.style.transform = 'translate3d(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px,0) scale(1.03)';
    };
  }

  /* ---- Montre vivante : heure reelle Europe/Paris (ete/hiver automatiques) ---- */
  (function () {
    var watches = [].slice.call(document.querySelectorAll('.hero__bg .watch'));
    if (!watches.length) return;
    var IW = 5504, IH = 3072;                                   // dimensions natives des visuels hero
    var fmt;
    try { fmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
    catch (e) { fmt = null; }
    if (location.hash.indexOf('watchdebug') > -1) watches.forEach(function (w) { w.classList.add('is-debug'); });

    watches.forEach(function (w) { w.cal = JSON.parse(w.dataset.cal); });

    function layout() {
      var img = null, all = document.querySelectorAll('.hero__img');
      for (var k = 0; k < all.length; k++) if (all[k].offsetWidth) { img = all[k]; break; }
      if (!img) return;
      var bw = img.offsetWidth, bh = img.offsetHeight;          // repere pre-transform (la parallaxe s applique aussi aux montres)
      if (!bw || !bh) return;
      var op = getComputedStyle(img).objectPosition.split(' ');
      var px = parseFloat(op[0]) / 100, py = parseFloat(op[1]) / 100;
      var s = Math.max(bw / IW, bh / IH);
      var ox = (bw - IW * s) * px, oy = (bh - IH * s) * py;
      var base = img.offsetLeft, baseT = img.offsetTop;         // les img ont inset:-2.5%
      watches.forEach(function (w) {
        var c = w.cal, size = 2 * c.rx * s;
        w.style.left = (base + ox + c.cx * s - size / 2) + 'px';
        w.style.top = (baseT + oy + c.cy * s - size / 2) + 'px';
        w.style.width = size + 'px';
        w.style.height = size + 'px';
        w.style.transformOrigin = '50% 50%';
        w.dataset.squash = (c.ry / c.rx);
        w.dataset.rot = c.rot;
      });
      watches.forEach(function (w) {
        w.style.transform = 'rotate(' + w.dataset.rot + 'deg) scale(1,' + w.dataset.squash + ')';
      });
    }

    function tick() {
      var h, m, s2;
      if (fmt) {
        var parts = fmt.formatToParts(new Date());
        for (var i = 0; i < parts.length; i++) { var p = parts[i]; if (p.type === 'hour') h = +p.value; else if (p.type === 'minute') m = +p.value; else if (p.type === 'second') s2 = +p.value; }
      } else { var d = new Date(); h = d.getHours(); m = d.getMinutes(); s2 = d.getSeconds(); }
      var ms = Date.now() % 1000;                                // les millisecondes sont universelles
      var sec = s2 + ms / 1000, min = m + sec / 60, hr = (h % 12) + min / 60;
      watches.forEach(function (w) {
        var psi = w.cal.psi;
        w.querySelector('.w-s').setAttribute('transform', 'rotate(' + (psi + sec * 6) + ')');
        w.querySelector('.w-m').setAttribute('transform', 'rotate(' + (psi + min * 6) + ')');
        w.querySelector('.w-h').setAttribute('transform', 'rotate(' + (psi + hr * 30) + ')');
        if (w.style.visibility !== 'visible') w.style.visibility = 'visible';   // affichee deja a l heure, jamais depuis 12h00
      });
    }
    layout(); tick();
    setInterval(tick, 125);                                      // fluide et leger; l angle derive toujours de l heure absolue
    addEventListener('resize', layout);
    addEventListener('load', layout);                            // dimensions definitives (images, polices)
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
    if ('ResizeObserver' in window) { var plate = document.getElementById('heroPlate'); if (plate) new ResizeObserver(layout).observe(plate); }  // tout changement de taille du plateau
    if (toggle) toggle.addEventListener('click', function () { requestAnimationFrame(layout); });  // bascule d ambiance : image visible differente
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { layout(); tick(); } });
  })();

  /* ---- Menu mobile ---- */
  var burger = document.getElementById('burger');
  var menu = document.getElementById('mmenu');
  if (burger && menu) {
    burger.addEventListener('click', function () {
      var open = menu.hidden;
      menu.hidden = !open;
      burger.setAttribute('aria-expanded', open);
      document.body.style.overflow = open ? 'hidden' : '';
      /* la bascule Jour / Nuit est un element global, pose sur la fenetre : sans
         ce temoin, la feuille de style ne peut pas savoir qu'un menu la
         recouvre, et le bouton restait dans son coin, flottant sur le menu. */
      document.documentElement.classList.toggle('mmenu-ouvert', open);
    });
    menu.addEventListener('click', function (e) {
      if (e.target.closest('a[href]')) { menu.hidden = true; burger.setAttribute('aria-expanded', 'false'); document.body.style.overflow = ''; document.documentElement.classList.remove('mmenu-ouvert'); }
    });
  }
})();
