/* Privacy-preserving analytics.
 *
 * No cookies, no local storage, no personal data, no cross-site tracking, and
 * nothing that would require a consent banner. It answers one question the
 * site could not otherwise answer: how far down the page people actually get,
 * and what they engage with once they are there.
 *
 * Nothing is loaded and no request is ever made while SITE_CODE is empty.
 * It also stays silent for anyone sending Do Not Track or Global Privacy
 * Control, and on localhost, so development traffic never pollutes the data.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Your GoatCounter site code: the first label of your dashboard URL.
   *   https://YOURCODE.goatcounter.com  ->  'YOURCODE'
   * Leave empty to disable analytics entirely.
   * ------------------------------------------------------------------ */
  var SITE_CODE = 'munawarkazmi';

  if (!SITE_CODE) return;

  /* ---- opt-outs, honoured before anything is requested -------------- */
  var dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
  if (dnt === '1' || dnt === 'yes' || navigator.globalPrivacyControl === true) return;

  var host = location.hostname;
  if (location.protocol === 'file:' || host === 'localhost' ||
      host === '127.0.0.1' || host === '') return;

  /* ---- loader -------------------------------------------------------
   * count.js sends the pageview itself on load. Events raised before it
   * arrives are queued rather than dropped; if it never arrives, the queue
   * is discarded and the page carries on exactly as if this file were absent.
   */
  var queue = [];
  var sent = {};
  var failed = false;

  window.goatcounter = window.goatcounter || {};

  function send(path, title) {
    window.goatcounter.count({ path: path, title: title, event: true });
  }

  function track(path, title) {
    if (failed || sent[path]) return;
    sent[path] = true;
    if (window.goatcounter && typeof window.goatcounter.count === 'function') send(path, title);
    else queue.push([path, title]);
  }

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.setAttribute('data-goatcounter', 'https://' + SITE_CODE + '.goatcounter.com/count');
  s.onload = function () {
    for (var i = 0; i < queue.length; i++) send(queue[i][0], queue[i][1]);
    queue.length = 0;
  };
  s.onerror = function () { failed = true; queue.length = 0; };
  document.head.appendChild(s);

  /* ---- how far down people actually get -----------------------------
   * Four milestones rather than one event per section: it answers the
   * funnel question with at most four beacons per visit, and each fires
   * the moment the section is genuinely in view rather than on unload,
   * where a request can be cancelled.
   */
  var MILESTONES = [
    ['research', 'Reached: Research'],
    ['projects', 'Reached: Projects'],
    ['experience', 'Reached: Experience'],
    ['contact', 'Reached: Contact']
  ];

  if (window.IntersectionObserver) {
    MILESTONES.forEach(function (m) {
      var el = document.getElementById(m[0]);
      if (!el) return;
      var io = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) {
          io.disconnect();
          track('depth/' + m[0], m[1]);
        }
      }, { threshold: 0, rootMargin: '0px 0px -20% 0px' });
      io.observe(el);
    });
  }

  /* ---- what people engage with once they are there ------------------ */
  function on(selector, type, path, title) {
    var nodes = document.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].addEventListener(type, function () { track(path, title); });
    }
  }

  on('details.now-more', 'toggle', 'engage/measurements-opened', 'Opened the Now measurements');
  on('.video-facade', 'click', 'engage/video-played', 'Played a research video');
  on('.project-filter-btn', 'click', 'engage/filter-used', 'Used a project filter');
  on('a[href$="Kazmi_Resume.pdf"]', 'click', 'engage/resume-opened', 'Opened the resume');
  on('#copyEmailBtn', 'click', 'engage/email-copied', 'Copied the email address');
  on('#copyCitationBtn', 'click', 'engage/citation-copied', 'Copied the citation');
  on('a[href$="guides.html"]', 'click', 'engage/guides-opened', 'Opened the plain-language guides');
})();
