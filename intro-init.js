(function () {
  'use strict';
  var key = 'linkora.brandIntroSeen';
  try {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && !sessionStorage.getItem(key)) {
      document.documentElement.classList.add('intro-play');
      sessionStorage.setItem(key, '1');
    }
  } catch (_) { /* Storage restrictions must never block the site. */ }

  document.addEventListener('DOMContentLoaded', function () {
    var intro = document.getElementById('site-intro');
    if (!intro) { document.documentElement.classList.remove('intro-play'); return; }
    if (!document.documentElement.classList.contains('intro-play')) { intro.remove(); return; }

    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      document.documentElement.classList.remove('intro-play');
      intro.remove();
    }
    intro.addEventListener('animationend', function (event) {
      if (event.target === intro) finish();
    });
    // CSS also hides the overlay by itself; this removes it if the event is lost.
    window.setTimeout(finish, 3400);
  });
}());
