// Shared navigation, accessibility, and reusable site sections
document.addEventListener('DOMContentLoaded', function () {
  var toggle = document.querySelector('.nav-toggle');
  var links = document.querySelector('nav.links');
  if (toggle && links) {
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', function () {
      links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', links.classList.contains('open') ? 'true' : 'false');
    });
    links.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { links.classList.remove('open'); });
    });
  }

  // Scroll reveal
  var revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && revealEls.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  }

  // Set the fixed copyright year requested for the 2026 site release.
  var yearEls = document.querySelectorAll('.year');
  yearEls.forEach(function (el) { el.textContent = '2026'; });

  // Founder details deliberately remain clear placeholders until supplied by the owner.
  var main = document.querySelector('main');
  if (main && !document.querySelector('.leadership-section')) {
    var leadership = document.createElement('section');
    leadership.className = 'leadership-section border-top';
    leadership.innerHTML = '<div class="wrap"><div class="leadership-card reveal in"><img class="founder-photo" src="assets/founder.jpg" alt="Muhammad Muneeb, founder of LINKORA SOLUTION" width="500" height="500" loading="lazy"><div><span class="mono">Leadership</span><h2>Meet the Leadership Behind LINKORA SOLUTION</h2><p class="founder-name">MUHAMMAD MUNEEB <span>· Founder &amp; Managing Director</span></p><p><strong>9+ years of experience in digital growth.</strong> Helping businesses turn their online presence into <strong>visibility, qualified leads, and real growth.</strong></p><p>Founder of <strong>Awwal Online</strong>, delivering strategic digital marketing, SEO, lead generation, and growth solutions for businesses ready to scale.</p><p class="founder-vision"><strong>Our vision:</strong> Build sustainable search visibility through thoughtful strategy, quality work and transparent communication.</p></div></div></div>';
    main.appendChild(leadership);
  }

  var serviceAnchors = {
    'On-Page SEO': 'on-page-seo', 'Off-Page SEO': 'off-page-seo', Backlinks: 'backlinks',
    'Guest Posting': 'guest-posting', 'Blog Writing': 'blog-writing', 'DA Increase': 'da-increase',
    'Guest Post Sites Sheet': 'guest-post-sheet', 'Technical SEO': 'technical-seo'
  };
  document.querySelectorAll('.card').forEach(function (card) {
    var heading = card.querySelector('h3');
    if (!heading || !serviceAnchors[heading.textContent.trim()] || card.querySelector('.service-link')) return;
    var service = heading.textContent.trim();
    card.classList.add('service-card');
    var link = document.createElement('a');
    link.className = 'service-link';
    link.href = 'services.html#' + serviceAnchors[service];
    link.textContent = 'Learn more about ' + service;
    card.appendChild(link);
  });

  var footer = document.querySelector('footer');
  if (footer) footer.innerHTML = '<div class="wrap"><div class="footer-grid"><div><div class="logo" style="margin-bottom:14px"><span class="mark"><img src="assets/linkora-icon.png" alt="LINKORA SOLUTION logo"></span><span class="brandname">LINKORA SOLUTION</span></div><p>Practical SEO, link building and content support for businesses building sustainable search visibility.</p></div><div><h5>Services</h5><ul><li><a href="services.html#on-page-seo">On-Page SEO</a></li><li><a href="services.html#off-page-seo">Off-Page SEO</a></li><li><a href="services.html#backlinks">Backlinks</a></li><li><a href="services.html#guest-posting">Guest Posting</a></li></ul></div><div><h5>More services</h5><ul><li><a href="services.html#blog-writing">Blog Writing</a></li><li><a href="services.html#da-increase">DA Increase</a></li><li><a href="services.html#guest-post-sheet">Guest Post Sites Sheet</a></li><li><a href="services.html#technical-seo">Technical SEO</a></li></ul></div><div><h5>Company</h5><ul><li><a href="about.html">About</a></li><li><a href="blog.html">Blog</a></li><li><a href="contact.html">Contact</a></li><li><a href="https://wa.me/923216308339" target="_blank" rel="noopener noreferrer">WhatsApp</a></li></ul></div></div><div class="footer-bottom"><p>© <span class="year">2026</span> LINKORA SOLUTION. All rights reserved.</p><div class="footer-social"><a href="https://wa.me/923216308339" target="_blank" rel="noopener noreferrer" aria-label="Contact LINKORA SOLUTION on WhatsApp">WA</a></div></div></div>';
});
