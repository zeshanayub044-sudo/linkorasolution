// Shared navigation, accessibility, and reusable site sections
document.addEventListener('DOMContentLoaded', function () {
  var links = document.querySelector('nav.links');

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

  // Shared Founder & CEO profile across public pages.
  var main = document.querySelector('main');
  if (main && !document.querySelector('.leadership-section')) {
    var leadership = document.createElement('section');
    leadership.className = 'leadership-section border-top';
    leadership.setAttribute('aria-labelledby', 'leadership-title');
    leadership.innerHTML = '<div class="wrap"><div class="section-head"><span class="mono">Leadership</span><h2 id="leadership-title">Meet the Leadership Behind LINKORA SOLUTION</h2></div><div class="leadership-grid"><article class="leadership-card reveal in" aria-labelledby="founder-name"><img class="founder-photo" src="assets/founder.jpg" alt="Muhammad Muneeb, founder and CEO of LINKORA SOLUTION" width="500" height="500" loading="lazy" decoding="async"><div class="leadership-details"><h3 id="founder-name" class="founder-name">MUHAMMAD MUNEEB</h3><p class="leadership-role">Founder &amp; CEO</p><div class="leadership-bio"><p>Helping businesses turn their online presence into <strong>visibility, qualified leads, and real growth.</strong></p><p>Founder and CEO of <strong>LINKORA SOLUTION</strong>, delivering strategic digital marketing, SEO, lead generation, and growth solutions for businesses ready to scale.</p><p class="founder-vision"><strong>Our vision:</strong> Build sustainable search visibility through thoughtful strategy, quality work and transparent communication.</p></div></div></article></div></div>';
    main.appendChild(leadership);
  }

  var servicePages = {'Backlinks':'backlinks.html','Guest Posting':'guest-posting.html','On-Page SEO':'on-page-seo.html','Google Business Profile (GMB)':'gmb.html'};
  var serviceAnchors = {
    'On-Page SEO': 'on-page-seo', 'Off-Page SEO': 'off-page-seo', Backlinks: 'backlinks',
    'Guest Posting': 'guest-posting', 'Blog Writing': 'blog-writing', 'DA Increase': 'da-increase',
    'Guest Post Sites Sheet': 'guest-post-sheet', 'Technical SEO': 'technical-seo',
    'Google Business Profile (GMB)': 'gmb-optimization',
    'Web Development': 'web-development',
    '12-Website Monthly SEO Plan': 'multi-site-seo'
  };
  // The desktop submenu shares the same destinations as the service cards.
  var servicesLink = links && links.querySelector('a[href="services.html"]');
  if (servicesLink) {
    var servicesNav = document.createElement('div');
    servicesNav.className = 'services-nav';
    servicesLink.parentNode.insertBefore(servicesNav, servicesLink);
    servicesNav.appendChild(servicesLink);

    var servicesDropdown = document.createElement('div');
    servicesDropdown.className = 'services-dropdown';
    servicesDropdown.setAttribute('role', 'group');
    servicesDropdown.setAttribute('aria-label', 'Explore services');
    var servicesPanel = document.createElement('div');
    servicesPanel.className = 'services-dropdown__panel';
    var servicesTitle = document.createElement('span');
    servicesTitle.className = 'mono services-dropdown__title';
    servicesTitle.textContent = 'Explore services';
    servicesPanel.appendChild(servicesTitle);
    var servicesGrid = document.createElement('div');
    servicesGrid.className = 'services-dropdown__grid';
    Object.keys(serviceAnchors).forEach(function (service) {
      var serviceLink = document.createElement('a');
      serviceLink.href = servicePages[service] || 'services.html#' + serviceAnchors[service];
      serviceLink.textContent = service;
      serviceLink.target = location.pathname.endsWith('/services.html') ? '_self' : '_blank';
      serviceLink.rel = 'noopener noreferrer';
      servicesGrid.appendChild(serviceLink);
    });
    servicesPanel.appendChild(servicesGrid);
    servicesDropdown.appendChild(servicesPanel);
    servicesNav.appendChild(servicesDropdown);
  }

  document.querySelectorAll('.card').forEach(function (card) {
    var heading = card.querySelector('h3');
    if (!heading || !serviceAnchors[heading.textContent.trim()] || card.querySelector('.service-link')) return;
    var service = heading.textContent.trim();
    card.classList.add('service-card');
    var link = document.createElement('a');
    link.className = 'service-link';
    link.href = servicePages[service] || 'services.html#' + serviceAnchors[service];
    link.textContent = 'Learn more about ' + service;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    card.appendChild(link);
  });

  // Service orders: collect the essentials first, then prepare a complete WhatsApp order.
  // This runs only on the services page, so cards elsewhere keep their normal links.
  var serviceSections = document.querySelectorAll('main > section[id]');
  var isServicesPage = document.querySelector('nav.links a.active[href="services.html"]');
  if (isServicesPage && serviceSections.length) {
    var orderModal = document.createElement('div');
    orderModal.className = 'order-modal';
    orderModal.setAttribute('aria-hidden', 'true');
    orderModal.innerHTML = '<div class="order-modal__backdrop" data-close-order></div><div class="order-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="order-title"><button class="order-modal__close" type="button" aria-label="Close order form" data-close-order>&times;</button><span class="mono">Start an order</span><h2 id="order-title">Order a service</h2><p class="order-modal__service" aria-live="polite"></p><form class="order-form"><input type="hidden" name="service"><div class="field"><label for="order-name">Your name</label><input id="order-name" name="name" type="text" autocomplete="name" required></div><div class="field"><label for="order-company">Business name</label><input id="order-company" name="company" type="text" autocomplete="organization"></div><div class="field"><label for="order-website">Website URL</label><input id="order-website" name="website" type="url" placeholder="https://yourwebsite.com"></div><div class="field"><label for="order-contact">WhatsApp number or email</label><input id="order-contact" name="contact" type="text" required></div><div class="field"><label for="order-notes">What do you need?</label><textarea id="order-notes" name="notes" placeholder="Tell us about your goals, niche, or quantity needed."></textarea></div><button class="btn btn-whatsapp" type="submit">Send order on WhatsApp</button></form></div>';
    document.body.appendChild(orderModal);

    var selectedService = '';
    var lastTrigger = null;
    var serviceLabel = orderModal.querySelector('.order-modal__service');
    var orderForm = orderModal.querySelector('.order-form');

    function openOrder(service, trigger) {
      selectedService = service;
      lastTrigger = trigger;
      orderModal.querySelector('[name="service"]').value = service;
      serviceLabel.textContent = 'Selected: ' + service;
      orderModal.classList.add('is-open');
      orderModal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
      orderModal.querySelector('#order-name').focus();
    }

    function closeOrder() {
      orderModal.classList.remove('is-open');
      orderModal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('modal-open');
      if (lastTrigger) lastTrigger.focus();
    }

    serviceSections.forEach(function (section) {
      var serviceHeading = section.querySelector('.section-head h2');
      if (!serviceHeading) return;
      var serviceName = serviceHeading.textContent.trim();
      var orderName = section.getAttribute('data-order-service') || serviceName;
      var sectionHead = section.querySelector('.section-head');
      var sectionButton = document.createElement('button');
      sectionButton.type = 'button';
      sectionButton.className = 'btn btn-gold order-service';
      sectionButton.textContent = 'Order ' + serviceName;
      sectionButton.addEventListener('click', function () { openOrder(orderName, sectionButton); });
      sectionHead.appendChild(sectionButton);

      section.querySelectorAll('.card').forEach(function (card) {
        var cardHeading = card.querySelector('h3');
        var choice = cardHeading ? cardHeading.textContent.trim() : '';
        var cardButton = document.createElement('button');
        cardButton.type = 'button';
        cardButton.className = 'order-card-button';
        cardButton.textContent = 'Order on WhatsApp';
        cardButton.addEventListener('click', function () {
          openOrder(choice ? orderName + ' — ' + choice : orderName, cardButton);
        });
        card.appendChild(cardButton);
      });
    });

    document.querySelectorAll('.gmb-order-trigger').forEach(function (button) {
      button.addEventListener('click', function () {
        openOrder('Google Business Profile (GMB) Optimization', button);
      });
    });

    orderModal.addEventListener('click', function (event) {
      if (event.target.hasAttribute('data-close-order')) closeOrder();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && orderModal.classList.contains('is-open')) closeOrder();
    });
    orderForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!orderForm.reportValidity()) return;
      var data = new FormData(orderForm);
      var message = 'Hello LINKORA SOLUTION, I would like to place an order.\n\n'
        + 'Service: ' + selectedService + '\n'
        + 'Name: ' + data.get('name') + '\n'
        + 'Business: ' + (data.get('company') || 'Not provided') + '\n'
        + 'Website: ' + (data.get('website') || 'Not provided') + '\n'
        + 'Contact: ' + data.get('contact') + '\n'
        + 'Requirements: ' + (data.get('notes') || 'Not provided');
      window.LinkoraMarketing?.track('whatsapp_click', { context: 'service', service_name: selectedService, cta_location: 'order_modal' });
      window.open('https://wa.me/923216308339?text=' + encodeURIComponent(message), '_blank', 'noopener,noreferrer');
      closeOrder();
    });
  }

  var footer = document.querySelector('footer');
  if (footer) footer.innerHTML = '<div class="wrap"><div class="footer-grid"><div><div class="logo" style="margin-bottom:14px"><span class="mark"><img src="assets/linkora-mark.png" alt="LINKORA SOLUTION logo" width="96" height="96" loading="lazy" decoding="async"></span><span class="brandname">LINKORA SOLUTION</span></div><p>Practical SEO, link building and content support for businesses building sustainable search visibility.</p></div><div><h2>Services</h2><ul><li><a href="on-page-seo.html" target="_blank" rel="noopener noreferrer">On-Page SEO</a></li><li><a href="services.html#off-page-seo" target="_blank" rel="noopener noreferrer">Off-Page SEO</a></li><li><a href="backlinks.html" target="_blank" rel="noopener noreferrer">Backlinks</a></li><li><a href="guest-posting.html" target="_blank" rel="noopener noreferrer">Guest Posting</a></li><li><a href="gmb.html" target="_blank" rel="noopener noreferrer">Google Business Profile (GMB)</a></li></ul></div><div><h2>More services</h2><ul><li><a href="services.html#blog-writing" target="_blank" rel="noopener noreferrer">Blog Writing</a></li><li><a href="services.html#da-increase" target="_blank" rel="noopener noreferrer">DA Increase</a></li><li><a href="services.html#guest-post-sheet" target="_blank" rel="noopener noreferrer">Guest Post Sites Sheet</a></li><li><a href="services.html#technical-seo" target="_blank" rel="noopener noreferrer">Technical SEO</a></li><li><a href="services.html#web-development" target="_blank" rel="noopener noreferrer">Web Development</a></li><li><a href="services.html#multi-site-seo" target="_blank" rel="noopener noreferrer">12-Website SEO Plan</a></li></ul></div><div><h2>Company</h2><ul><li><a href="about.html" target="_blank" rel="noopener noreferrer">About</a></li><li><a href="blog.html" target="_blank" rel="noopener noreferrer">Blog</a></li><li><a href="careers.html" target="_blank" rel="noopener noreferrer">Careers</a></li><li><a href="contact.html" target="_blank" rel="noopener noreferrer">Contact</a></li><li><a href="privacy.html" target="_blank" rel="noopener noreferrer">Privacy &amp; cookies</a></li><li><a class="tennis-portal-link" href="tennis-portal.html">Employee Portal <span aria-hidden="true">↗</span></a></li><li><a href="https://wa.me/923216308339" target="_blank" rel="noopener noreferrer">WhatsApp: +92 321 6308339</a></li><li><a href="https://mail.google.com/mail/?view=cm&amp;fs=1&amp;to=linkoraseosolutions%40gmail.com" target="_blank" rel="noopener noreferrer">Email us</a></li></ul></div></div><div class="footer-bottom"><p>© <span class="year">2026</span> LINKORA SOLUTION. All rights reserved.</p><div class="footer-social"><a href="https://wa.me/923216308339" target="_blank" rel="noopener noreferrer" aria-label="Contact LINKORA SOLUTION on WhatsApp">WA</a></div></div></div>';
  // A section link within the current document remains an in-page scroll.
  document.querySelectorAll('a[href]').forEach(function (link) {
    var url = new URL(link.href, location.href);
    if (/^https?:$/.test(url.protocol) && !link.hasAttribute('download') && link.getAttribute('href') && !link.getAttribute('href').startsWith('#')) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    if (url.hash && url.origin === location.origin && url.pathname === location.pathname && url.search === location.search) {
      link.removeAttribute('target');
      link.removeAttribute('rel');
    }
  });
});
