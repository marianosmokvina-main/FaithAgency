/* =========================================================
   FaithAgency — comportamiento
   El hilo, los puntos del camino, la isla, el cuestionario y Calendly.
   Todo funciona sin librerías y respeta el modo ligero.
   ========================================================= */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const html = document.documentElement;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const idle = (fn) => ('requestIdleCallback' in window ? window.requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200));

  const WA_NUMBER = '5492478577335';
  const CALENDLY_URL = 'https://calendly.com/marianosmokvina/faith-agency-strategic-call?hide_event_type_details=1&hide_gdpr_banner=1&background_color=13120f&text_color=f4efe4&primary_color=c9a84c';
  const waLink = (text) => `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(text)}`;

  const mqReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mqDesktopHover = window.matchMedia('(hover: hover) and (min-width: 900px)');
  const isLite = () => html.classList.contains('lite') || mqReduced.matches;
  const scrollBehavior = () => (isLite() ? 'auto' : 'smooth');

  /* ---------- Modos: ligero y accesible ---------- */
  const store = {
    get() { try { return localStorage.getItem('fa-modo') || ''; } catch (e) { return ''; } },
    set(v) { try { v ? localStorage.setItem('fa-modo', v) : localStorage.removeItem('fa-modo'); } catch (e) { /* sin almacenamiento */ } },
  };
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  if (saveData && !store.get()) html.classList.add('lite');

  function syncModeButtons() {
    $$('[data-mode]').forEach((b) => {
      const m = b.dataset.mode;
      const on = m === 'lite' ? html.classList.contains('lite') : html.classList.contains('a11y');
      b.setAttribute('aria-pressed', String(on));
    });
  }
  function setMode(mode, on) {
    if (mode === 'a11y') {
      html.classList.toggle('a11y', on);
      if (on) html.classList.add('lite');
    } else {
      html.classList.toggle('lite', on);
      if (!on) html.classList.remove('a11y');
    }
    const saved = ['lite', 'a11y'].filter((c) => html.classList.contains(c)).join(' ');
    store.set(saved);
    syncModeButtons();
    applyLite();
    onResize();
  }
  $$('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    setMode(b.dataset.mode, b.getAttribute('aria-pressed') !== 'true');
  }));
  syncModeButtons();

  /* ---------- Vídeo del caso (con sonido, al tocar) ---------- */
  const caseFrame = $('[data-case]');
  if (caseFrame) {
    const vid = $('.case__vid', caseFrame);
    $('.case__play', caseFrame).addEventListener('click', () => {
      if (!vid.src) vid.src = vid.dataset.src;
      vid.controls = true;
      caseFrame.classList.add('is-playing');
      const p = vid.play();
      if (p && p.catch) p.catch(() => {});
      vid.focus({ preventScroll: true });
    });
  }

  /* ---------- El hilo: se dibuja con el scroll ---------- */
  const drawables = [];
  $$('.rail i, .faith__line i').forEach((el) => drawables.push({ el, host: el.parentElement, kind: 'scale' }));
  $$('.elbow path').forEach((el) => drawables.push({ el, host: el.ownerSVGElement, kind: 'dash' }));

  function setDraw(d, p) {
    if (d.p === p) return;
    d.p = p;
    if (d.kind === 'scale') d.el.style.transform = `scaleY(${p})`;
    else d.el.style.strokeDashoffset = String(1.02 * (1 - p));
  }

  const hero = $('.hero');
  const firstRail = hero && hero.nextElementSibling ? $('.rail', hero.nextElementSibling) : null;

  /* revelación del titular palabra a palabra */
  const reveal = $('[data-reveal]');
  let revealWords = [];
  let revealDone = false;
  if (reveal) {
    reveal.setAttribute('aria-label', reveal.textContent.trim().replace(/\s+/g, ' '));
    const split = (node) => {
      Array.from(node.childNodes).forEach((n) => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
            const w = document.createElement('span');
            w.className = 'w';
            w.setAttribute('aria-hidden', 'true');
            w.textContent = part;
            frag.appendChild(w);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1) {
          n.setAttribute('aria-hidden', 'true');
          split(n);
        }
      });
    };
    split(reveal);
    revealWords = $$('.w', reveal);
  }
  function paintReveal(vh, r) {
    if (!reveal || revealDone) return;
    const p = clamp((vh * 0.88 - r.top) / (vh * 0.42));
    const n = revealWords.length;
    revealWords.forEach((w, i) => { w.style.opacity = String(clamp(p * (n + 1) - i, 0.4, 1)); });
    if (p >= 1) revealDone = true;
  }
  function finishReveal() {
    revealDone = true;
    revealWords.forEach((w) => { w.style.opacity = '1'; });
  }
  /* tope de 2,5 s: si el titular está a la vista ese tiempo, se completa */
  if (reveal && 'IntersectionObserver' in window) {
    let t = null;
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { if (!t) t = setTimeout(finishReveal, 2500); }
      else if (t) { clearTimeout(t); t = null; }
    }, { threshold: 0.6 }).observe(reveal);
  }

  /* ---------- Puntos del camino: siempre visibles abajo a la izquierda ----------
     Un punto por capítulo que falta. Al llegar a un capítulo su punto se enciende,
     desaparece y la lista se acorta (10, 9, 8…). Al subir, vuelven. */
  const dock = $('[data-dock]');
  const chapterSecs = $$('main section[data-chapter]').filter((s) => s !== hero && $('.chapter, .node', s));
  const chapters = chapterSecs.map((s) => $('.chapter, .node', s));
  const dots = [];
  let curDot = -2;
  if (dock && chapters.length > 1) {
    dock.style.setProperty('--n', String(chapters.length));
    /* cada punto lleva a su capítulo (la isla sigue siendo el menú accesible) */
    chapterSecs.forEach((sec, i) => {
      const d = document.createElement('a');
      d.className = 'dock__dot';
      d.href = `#${sec.id}`;
      d.tabIndex = -1;
      d.dataset.label = sec.dataset.chapter;
      d.style.setProperty('--i', String(i));
      d.addEventListener('click', (e) => {
        e.preventDefault();
        sec.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
      });
      dock.appendChild(d);
      dots.push(d);
    });
  }
  /* altura del punto de cada nodo dentro de su elemento (etiqueta: al medio; título: primera línea) */
  let nodeOffsets = chapters.map(() => 10);
  let dockGap = 14;
  let dockDot = 7;
  function placeDock() {
    if (!dots.length || !firstRail) return;
    const r = firstRail.getBoundingClientRect();
    dock.style.left = `${Math.round(r.left + r.width / 2 - 7)}px`;
    const cs = getComputedStyle(dock);
    dockGap = parseFloat(cs.getPropertyValue('--gap')) || 14;
    dockDot = parseFloat(cs.getPropertyValue('--dot')) || 7;
    nodeOffsets = chapters.map((c) => (c.classList.contains('node')
      ? parseFloat(getComputedStyle(c).fontSize) * 0.54
      : c.getBoundingClientRect().height / 2));
  }
  /* el punto de la columna desaparece justo cuando el nodo de la página, al subir, choca con él */
  function paintDock(tops, dockTop) {
    if (!dots.length) return;
    let cur = -1;
    for (let i = 0; i < tops.length; i++) {
      const dotY = dockTop + (tops.length - 1 - i) * dockGap + dockDot / 2;   /* el primer capítulo es el punto de abajo */
      if (tops[i] + nodeOffsets[i] <= dotY) cur = i;
    }
    if (cur === curDot) return;
    curDot = cur;
    dots.forEach((d, i) => {
      d.classList.toggle('is-past', i <= cur);
      d.classList.toggle('is-next', i === cur + 1);
    });
    dock.style.setProperty('--cut', `${(cur + 1) * dockGap}px`);
    dock.classList.toggle('is-done', cur >= dots.length - 1);
  }

  /* ---------- Paso actual del método: un solo destello a la vez ---------- */
  const steps = $$('[data-step]');
  let curStep = -1;
  const auras = steps.map((st) => $('.step__aura', st));
  const auraVal = auras.map(() => 0);
  function paintAuras(rects, vh) {
    rects.forEach((r, i) => {
      if (!auras[i]) return;
      const c = r.top + r.height / 2;
      let a = clamp(1 - Math.abs(c - vh * 0.5) / (vh * 0.42));
      a = Math.round(a * a * 100) / 100;
      if (Math.abs(a - auraVal[i]) < 0.02 && !(a === 0 && auraVal[i] !== 0)) return;
      auraVal[i] = a;
      auras[i].style.opacity = String(a);
    });
  }
  function pickStep(rects, vh) {
    let best = -1;
    let bestD = Infinity;
    const mid = vh * 0.5;
    rects.forEach((r, i) => {
      if (r.bottom < vh * 0.22 || r.top > vh * 0.78) return;
      const d = Math.abs(r.top + r.height / 2 - mid);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best === curStep) return;
    if (curStep >= 0) steps[curStep].classList.remove('is-current');
    if (best >= 0) steps[best].classList.add('is-current');
    curStep = best;
  }
  /* el SVG del destello toma el tamaño real de su tarjeta: así el trazo es uno solo y limpio */
  function fitBeams() {
    $$('.beam').forEach((svg) => {
      const host = svg.parentElement;
      const w = host.offsetWidth;
      const h = host.offsetHeight;
      if (!w || !h) return;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      const W = w - 2, H = h - 2, r = Math.min(17, W / 2, H / 2);
      const d = `M${1 + r} 1H${1 + W - r}A${r} ${r} 0 0 1 ${1 + W} ${1 + r}V${1 + H - r}A${r} ${r} 0 0 1 ${1 + W - r} ${1 + H}H${1 + r}A${r} ${r} 0 0 1 1 ${1 + H - r}V${1 + r}A${r} ${r} 0 0 1 ${1 + r} 1Z`;
      $$('path', svg).forEach((p) => p.setAttribute('d', d));
    });
  }

  /* ---------- Un solo bucle de scroll: primero se lee todo, después se escribe ---------- */
  let ticking = false;
  /* la punta del hilo dorado va pegada a la columna de puntos: el hilo baja hasta ella */
  const lit = new Set();
  function light(el) { if (!lit.has(el)) { lit.add(el); el.classList.add('is-lit'); } }
  function frame() {
    ticking = false;
    const vh = window.innerHeight;
    const lite = isLite();
    const dockTop = dots.length ? dock.getBoundingClientRect().top : 0;
    /* la punta entra unos píxeles por debajo de la cápsula: así el pequeño retraso del scroll
       en el móvil queda tapado y la línea siempre se ve conectada */
    const left = dots.length - (curDot + 1);
    const tuck = left > 0 ? Math.min(22, (left - 1) * dockGap + dockDot + 3) : 0;
    const pen = dots.length ? dockTop + tuck : vh * 0.62;
    const rects = lite ? null : drawables.map((d) => d.host.getBoundingClientRect());
    const stepRects = steps.map((s) => s.getBoundingClientRect());
    const tops = chapters.map((c) => c.getBoundingClientRect().top);
    const revealRect = !lite && reveal && !revealDone ? reveal.getBoundingClientRect() : null;

    /* la columna aparece al empezar a bajar, no al abrir la página */
    if (dots.length) dock.classList.toggle('is-ready', window.scrollY > 60);
    if (rects) drawables.forEach((d, i) => { const r = rects[i]; if (r.height > 0) setDraw(d, clamp((pen - r.top) / r.height)); });
    /* los nodos y las letras se encienden cuando la punta del hilo llega a ellos (y se quedan encendidos) */
    tops.forEach((t, i) => { if (t + nodeOffsets[i] <= pen) light(chapters[i]); });
    stepRects.forEach((r, i) => { if (r.top + r.height * 0.3 <= pen) light(steps[i]); });
    if (!lite) { pickStep(stepRects, vh); paintAuras(stepRects, vh); }
    paintDock(tops, dockTop);
    if (revealRect) paintReveal(vh, revealRect);
  }
  function onScroll() {
    if (!ticking) { ticking = true; requestAnimationFrame(frame); }
  }
  let resizeT;
  function relayout() { placeDock(); fitBeams(); onScroll(); }
  function onResize() { clearTimeout(resizeT); resizeT = setTimeout(relayout, 120); }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('load', relayout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
  if ('ResizeObserver' in window) {
    let roT;
    const ro = new ResizeObserver(() => { clearTimeout(roT); roT = setTimeout(fitBeams, 60); });
    $$('.step__body').forEach((el) => ro.observe(el));
  }

  function applyLite() {
    if (isLite()) {
      drawables.forEach((d) => setDraw(d, 1));
      finishReveal();
      $$('.chapter, .node, .step').forEach((el) => el.classList.add('is-lit'));
      if (curStep >= 0) { steps[curStep].classList.remove('is-current'); curStep = -1; }
      $$('.marker--view').forEach((m) => m.classList.add('is-marked'));
    }
    onScroll();
  }

  /* marcadores que se dibujan al llegar a ellos */
  const markIO = 'IntersectionObserver' in window ? new IntersectionObserver((entries, obs) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-marked'); obs.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -30% 0px' }) : null;
  $$('.marker--view').forEach((m) => (markIO ? markIO.observe(m) : m.classList.add('is-marked')));

  /* iconos de "Lo que ganas": en pantallas táctiles giran cuando el beneficio pasa por el centro */
  if ('IntersectionObserver' in window && !window.matchMedia('(hover: hover)').matches) {
    const gainIO = new IntersectionObserver((entries) => {
      entries.forEach((e) => e.target.classList.toggle('is-on', e.isIntersecting));
    }, { rootMargin: '-38% 0px -38% 0px' });
    $$('.gain').forEach((g) => gainIO.observe(g));
  }


  /* ---------- Isla ---------- */
  const island = $('[data-island]');
  const panel = $('[data-island-panel]');
  const toggle = $('[data-island-toggle]');
  const scrim = $('[data-island-scrim]');
  const chapterLabel = $('[data-island-chapter]');
  const countLabel = $('[data-island-count]');
  const list = $('[data-island-list]');
  const sections = $$('main section[data-chapter]');
  let clockTimer = null;

  sections.forEach((sec) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#${sec.id}`;
    a.textContent = sec.dataset.chapter;
    a.dataset.target = sec.id;
    li.appendChild(a);
    list.appendChild(li);
  });

  const clockFmt = (() => {
    try { return new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' }); }
    catch (e) { return null; }
  })();
  function tickClock() {
    const t = $('[data-clock]');
    if (t && clockFmt) t.textContent = clockFmt.format(new Date());
  }

  function openIsland() {
    if (island.classList.contains('is-open')) return;
    panel.hidden = false;
    scrim.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    tickClock();
    clockTimer = setInterval(tickClock, 30000);
    requestAnimationFrame(() => requestAnimationFrame(() => island.classList.add('is-open')));
  }
  function closeIsland(returnFocus) {
    if (!island.classList.contains('is-open') && panel.hidden) return;
    island.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    clearInterval(clockTimer);
    scrim.hidden = true;
    setTimeout(() => { if (!island.classList.contains('is-open')) panel.hidden = true; }, 320);
    if (returnFocus) toggle.focus({ preventScroll: true });
  }
  toggle.addEventListener('click', () => {
    if (island.classList.contains('is-open')) closeIsland(false);
    else { openIsland(); const first = $('a[aria-current="true"]', list) || $('a', list); first && setTimeout(() => first.focus({ preventScroll: true }), 60); }
  });
  scrim.addEventListener('click', () => closeIsland(false));
  $('[data-island-close]').addEventListener('click', () => closeIsland(true));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && island.classList.contains('is-open')) closeIsland(true); });
  list.addEventListener('click', (e) => { if (e.target.closest('a')) closeIsland(false); });

  /* escritorio: la muesca se abre al pasar el ratón */
  let hoverT;
  island.addEventListener('mouseenter', () => { if (mqDesktopHover.matches) { clearTimeout(hoverT); openIsland(); } });
  island.addEventListener('mouseleave', () => { if (mqDesktopHover.matches) { hoverT = setTimeout(() => closeIsland(false), 260); } });

  /* capítulo actual */
  if ('IntersectionObserver' in window) {
    const chapIO = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const idx = sections.indexOf(e.target);
        chapterLabel.textContent = e.target.dataset.chapter;
        countLabel.textContent = `${idx + 1}/${sections.length}`;
        $$('a', list).forEach((a) => a.setAttribute('aria-current', String(a.dataset.target === e.target.id)));
      });
    }, { rootMargin: '-46% 0px -53% 0px' });
    sections.forEach((s) => chapIO.observe(s));

    /* la isla aparece al dejar atrás el botón del hero y se esconde en la agenda */
    const vis = { hero: true, agenda: false, foot: false };
    const updateIsland = () => {
      const show = !vis.hero && !vis.agenda && !vis.foot;
      island.classList.toggle('is-shown', show);
      if (!show) closeIsland(false);
    };
    const watch = (el, key, opts) => {
      if (!el) return;
      new IntersectionObserver(([e]) => { vis[key] = e.isIntersecting; updateIsland(); }, opts).observe(el);
    };
    watch($('#hero-acciones'), 'hero', { threshold: 0 });
    watch($('#agenda'), 'agenda', { rootMargin: '0px 0px -35% 0px' });
    watch($('.foot'), 'foot', { threshold: 0 });
  } else {
    island.classList.add('is-shown');
  }

  /* ---------- Calendly dentro de la página ----------
     Se carga solo cuando te acercas a la agenda (nunca al abrir la página).
     En la versión sin internet se muestra un aviso en su lugar. */
  const slot = $('[data-calendly-slot]');
  const slotMsg = slot ? $('[data-calendly-msg] p', slot) : null;
  const EMBED = !window.FA_SIN_EMBED;
  let calendlyState = 'idle';
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function loadCalendly() {
    if (!slot || calendlyState !== 'idle') return;
    if (!EMBED) {
      calendlyState = 'offline';
      slot.dataset.state = 'offline';
      slotMsg.textContent = 'Aquí aparece el calendario para elegir día y hora. Se carga cuando hay conexión a internet.';
      return;
    }
    calendlyState = 'loading';
    slot.dataset.state = 'loading';
    loadScript('https://assets.calendly.com/assets/external/widget.js').then(() => {
      const box = document.createElement('div');
      box.className = 'calendly-inline-widget';
      slot.appendChild(box);
      /* el calendario avisa cuánto mide su contenido: la caja se ajusta (sin hueco ni scroll interno) */
      window.addEventListener('message', (e) => {
        if (!/^https:\/\/([a-z0-9-]+\.)?calendly\.com$/.test(e.origin)) return;
        const d = e.data;
        if (!d || d.event !== 'calendly.page_height' || !d.payload) return;
        const h = parseFloat(d.payload.height);
        if (h >= 300) box.style.height = `${Math.ceil(h)}px`;
      });
      window.Calendly.initInlineWidget({ url: CALENDLY_URL, parentElement: box });
      slot.dataset.state = 'ready';
      calendlyState = 'ready';
    }).catch(() => {
      calendlyState = 'error';
      slot.dataset.state = 'error';
      slotMsg.innerHTML = 'No pudimos cargar el calendario. <a href="https://calendly.com/marianosmokvina/faith-agency-strategic-call" target="_blank" rel="noopener">Ábrelo aquí</a> o escríbenos por WhatsApp.';
    });
  }
  if (slot) {
    if (!EMBED) loadCalendly();
    else if ('IntersectionObserver' in window) {
      const calIO = new IntersectionObserver(([e]) => {
        if (!e.isIntersecting) return;
        calIO.disconnect();
        idle(loadCalendly);
      }, { rootMargin: '1000px 0px' });
      calIO.observe(slot);
    } else loadCalendly();
  }

  /* todos los "Agenda tu llamada" llevan al calendario */
  $$('[data-agendar]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    closeIsland(false);
    loadCalendly();
    $('#agenda').scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  }));

  /* icono que gira al tocar (móvil) */
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.btn');
    if (!b || !$('.btn__icon', b)) return;
    b.classList.add('is-pressed');
    setTimeout(() => b.classList.remove('is-pressed'), 700);
  }, { passive: true });

  /* ---------- Cuestionario "¿Es para mí?" ---------- */
  const quiz = $('[data-quiz]');
  if (quiz) {
    const form = $('form', quiz);
    const stepsQ = $$('.quiz__step', quiz);
    const bars = $$('.quiz__progress span', quiz);
    const back = $('[data-quiz-back]', quiz);
    const restart = $('[data-quiz-restart]', quiz);
    const status = $('[data-quiz-status]', quiz);
    const results = $$('.quiz__result', quiz);
    const answers = {};
    let current = 0;
    const frases = {
      a: 'Tú te dedicas a tu negocio; nosotros hacemos que tu contenido salga con constancia.',
      b: 'Las ideas y los guiones los ponemos nosotros.',
      c: 'Cada vídeo va a tener un objetivo: que la persona correcta te escriba.',
      d: 'Tus redes pueden sumarse a tus recomendaciones como fuente de clientes.',
    };

    function show(i) {
      current = i;
      stepsQ.forEach((s, k) => s.classList.toggle('is-active', k === i));
      bars.forEach((b, k) => b.classList.toggle('is-done', k <= i));
      back.hidden = i === 0;
      status.textContent = `Pregunta ${i + 1} de ${stepsQ.length}`;
    }
    function labelOf(q) {
      const input = form.querySelector(`input[name="q${q}"]:checked`);
      return input ? input.parentElement.textContent.trim() : '';
    }
    function finish() {
      const q1 = answers.q1, q2 = answers.q2, q3 = answers.q3, q4 = answers.q4;
      let result = 'B';
      if (q2 === 'c' || q3 === 'c') result = 'C';
      else if (q1 === 'a' && (q2 === 'a' || q2 === 'b') && (q3 === 'a' || q3 === 'b')) result = 'A';

      const msg = `Hola, hice el test de la web. Mis respuestas: ${labelOf(1)} · ${labelOf(2)} · ${labelOf(3)} · ${labelOf(4)}. Me gustaría saber si pueden ayudarme.`;
      $$('[data-wa-quiz]', quiz).forEach((a) => { a.href = waLink(msg); });

      const box = results.find((r) => r.dataset.result === result);
      if (result === 'A') $('[data-frase]', box).textContent = frases[q4] || '';
      if (result === 'B') {
        const ids = [];
        if (q1 === 'c') ids.push('faq-inversion');
        if (q1 === 'b') ids.push('faq-encima');
        if (q2 === 'd') ids.push('faq-parte');
        if (q3 === 'b') ids.push('faq-tiempo');
        ids.push('faq-llamada', 'faq-inversion', 'faq-precio');
        const pick = [...new Set(ids)].slice(0, 3);
        const holder = $('[data-quiz-faqs]', box);
        holder.innerHTML = '';
        pick.forEach((id) => {
          const src = document.getElementById(id);
          if (!src) return;
          const c = src.cloneNode(true);
          c.removeAttribute('id');
          c.open = false;
          holder.appendChild(c);
        });
      }
      form.hidden = true;
      $('.quiz__progress', quiz).hidden = true;
      results.forEach((r) => { r.hidden = r !== box; });
      restart.hidden = false;
      status.textContent = '';
      box.focus({ preventScroll: true });
      const top = quiz.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight * 0.5) quiz.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    }

    form.addEventListener('change', (e) => {
      const input = e.target;
      if (input.type !== 'radio') return;
      answers[input.name] = input.value;
      const next = current + 1;
      setTimeout(() => { next < stepsQ.length ? show(next) : finish(); }, 280);
    });
    back.addEventListener('click', () => { if (current > 0) show(current - 1); });
    restart.addEventListener('click', () => {
      form.reset();
      Object.keys(answers).forEach((k) => delete answers[k]);
      form.hidden = false;
      $('.quiz__progress', quiz).hidden = false;
      results.forEach((r) => { r.hidden = true; });
      restart.hidden = true;
      show(0);
      const first = form.querySelector('input');
      first && first.focus({ preventScroll: true });
    });
    show(0);
  }

  /* ---------- Arranque ---------- */
  relayout();
  applyLite();
  mqReduced.addEventListener?.('change', applyLite);
})();
