/* Light and dark themes, and the two transitions that go with moving
 * around the site: the reveal when the theme changes, and the direction a
 * page slides in from.
 *
 * This file is loaded in the head, before the stylesheet has painted, so the
 * right theme is on the page from the first frame and a visitor who chose
 * dark never sees a white flash.
 *
 * The choice is the visitor's own and stays on their device: it is one word
 * in localStorage, read by nothing but this file and sent nowhere. With no
 * stored choice the page follows the system setting and keeps following it.
 */
(function () {
  'use strict';

  var KEY = 'theme';
  var root = document.documentElement;
  var system = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'dark' || v === 'light' ? v : null;
    } catch (e) { return null; }
  }

  function current() {
    return stored() || (system && system.matches ? 'dark' : 'light');
  }

  function apply(theme) {
    root.setAttribute('data-theme', theme);
    /* The browser chrome follows the page ground rather than staying white. */
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0F1115' : '#FCFCFD');
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
      buttons[i].setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    }
  }

  apply(current());

  /* Follow the system while the visitor has expressed no preference here. */
  if (system) {
    var onSystemChange = function () { if (!stored()) apply(current()); };
    if (system.addEventListener) system.addEventListener('change', onSystemChange);
    else if (system.addListener) system.addListener(onSystemChange);
  }

  /* The new theme opens as a circle from the button that was pressed. Where
     the browser cannot do that, or the visitor has asked for less motion,
     the theme simply changes. */
  function reveal(button, theme) {
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || calm) { apply(theme); return; }
    var r = button.getBoundingClientRect();
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    var far = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    root.style.setProperty('--reveal-x', x + 'px');
    root.style.setProperty('--reveal-y', y + 'px');
    root.style.setProperty('--reveal-r', Math.ceil(far) + 'px');
    root.classList.add('theme-reveal');
    var done = function () {
      root.classList.remove('theme-reveal');
      root.style.removeProperty('--reveal-x');
      root.style.removeProperty('--reveal-y');
      root.style.removeProperty('--reveal-r');
    };
    try {
      document.startViewTransition(function () { apply(theme); }).finished.then(done, done);
    } catch (e) { apply(theme); done(); }
  }

  /* Which way the next page slides in. A project page sits to the right of
     the page that lists it, so opening one moves forward and returning moves
     back. The stylesheet does the rest. */
  window.addEventListener('pagereveal', function (ev) {
    if (!ev.viewTransition || !window.navigation || !navigation.activation || !navigation.activation.from) return;
    var deep = function (url) { return /\/projects\//.test(new URL(url).pathname); };
    var from = deep(navigation.activation.from.url), to = deep(location.href);
    if (from !== to && ev.viewTransition.types) ev.viewTransition.types.add(to ? 'forward' : 'back');
  });

  /* The button ships hidden, so a page without scripting shows no control
     that does nothing. It still gets the system theme from the stylesheet. */
  function wire() {
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].hidden = false;
      buttons[i].addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(KEY, next); } catch (e) { /* private mode: the choice lasts for this page */ }
        reveal(this, next);
      });
    }
    apply(root.getAttribute('data-theme') || current());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
