/* Motion for the whole site.
 *
 * Three things, all of them quiet and all of them off under
 * prefers-reduced-motion: content below the fold rises into place as it
 * is scrolled to, with a short stagger inside a group; numbers count up
 * the first time they are seen; bars and bands grow from nothing. Nothing
 * here is needed to read the page: without this script every element is
 * simply already in place.
 */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.documentElement;
  if (reduce || !('IntersectionObserver' in window)) { root.classList.add('motion-off'); return; }
  root.classList.add('motion-on');

  /* ---- what rises: one class on a container staggers its children ---- */
  var GROUPS = '.stack, .rows, .demos, .quad, .stats, .refs, .talks, .doors, .facts, .xp, .metric-row, .lab-verdict, .sl-steps, .guide-list';
  var SINGLES = '.section-head, .group-head, .entry, .lab-story, .lab, figure:not(.lab):not(.demo), .after-rows, .bio, .mail, .site-footer, .block > h2, .block > p, .block > ul, .block > ol, .block > .data-table-scroll, .hero > *, .lab-next, .about-me > *';

  function prepare() {
    var vh = window.innerHeight || 800, items = [];
    function consider(el, delay) {
      var r = el.getBoundingClientRect();
      if (r.top < vh * 0.92 && r.bottom > 0) return; /* already in view: leave it alone, no flash */
      el.classList.add('will-rise'); if (delay) el.style.transitionDelay = delay + 'ms';
      items.push(el);
    }
    Array.prototype.forEach.call(document.querySelectorAll(GROUPS), function (g) {
      var kids = g.children, n = 0;
      for (var i = 0; i < kids.length; i++) { if (kids[i].matches('script, style')) continue; consider(kids[i], Math.min(n * 60, 360)); n++; }
      g.setAttribute('data-rise-group', '');
    });
    Array.prototype.forEach.call(document.querySelectorAll(SINGLES), function (el) {
      if (el.classList.contains('will-rise') || el.closest('[data-rise-group]') === el.parentNode) return;
      consider(el, 0);
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-risen'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    items.forEach(function (el) { io.observe(el); });
  }

  /* ---- numbers count up once ---- */
  var NUMS = '.stat-num, .row-num, .quad-num, .metric-num, .trust-bar-val';
  function countable(text) {
    /* one number, optionally with commas and a decimal, with a short prefix or suffix: 589, 1,350, 4.3x, 95%, 38/38, 10.3 µs */
    var m = /^([^\d]*)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(.*)$/.exec(text.trim());
    if (!m || /[eE]\d|[−-]\d|→|·|&/.test(text) || text.length > 16) return null;
    if (!/^(\/\d+)?[^\d]*$/.test(m[4])) return null; /* one number, or one over another; never two side by side */
    var whole = m[2].replace(/,/g, ''), dec = m[3] ? m[3].slice(1) : '';
    if (whole.length > 7) return null;
    return { pre: m[1], value: parseFloat(whole + (dec ? '.' + dec : '')), decimals: dec.length, commas: m[2].indexOf(',') >= 0, post: m[4] };
  }
  function fmt(v, c) {
    var s = v.toFixed(c.decimals);
    if (c.commas) { var parts = s.split('.'); parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); s = parts.join('.'); }
    return c.pre + s + c.post;
  }
  function counters() {
    var els = Array.prototype.filter.call(document.querySelectorAll(NUMS), function (el) {
      if (el.closest('.lab, .demo') || el.children.length) return false; /* the figures' own readouts change on their own */
      return countable(el.textContent) !== null;
    });
    if (!els.length) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return; io.unobserve(e.target);
        var el = e.target, c = countable(el.textContent), done = el.textContent, t0 = null, D = 900 + Math.min(600, c.value > 100 ? 600 : c.value * 6);
        el.style.minWidth = el.getBoundingClientRect().width + 'px';
        function frame(t) {
          if (t0 === null) t0 = t; var k = Math.min(1, (t - t0) / D), e2 = 1 - Math.pow(1 - k, 3);
          el.textContent = k < 1 ? fmt(c.value * e2, c) : done;
          if (k < 1) requestAnimationFrame(frame); else el.style.minWidth = '';
        }
        requestAnimationFrame(frame);
      });
    }, { threshold: 0.6 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---- bars and bands grow ---- */
  function bars() {
    var els = document.querySelectorAll('.bar > span, .ivl-band, .trust-bar-fill');
    if (!els.length) return;
    Array.prototype.forEach.call(els, function (el) { el.classList.add('will-grow'); });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-grown'); io.unobserve(e.target); } });
    }, { threshold: 0.4 });
    Array.prototype.forEach.call(els, function (el) { io.observe(el); });
  }

  function boot() { prepare(); counters(); bars(); root.classList.add('motion-ready'); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
