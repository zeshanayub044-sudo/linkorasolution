(function () {
  'use strict';
  if (window.LinkoraMarketing) return; // One controller/listener set, even if included twice.
  // This file is included only on public marketing pages, never Employee/Admin pages.
  var config = window.LINKORA_MARKETING_CONFIG || {};
  var publicDocuments = new Set(['/', '/index.html', '/about.html', '/services.html', '/backlinks.html', '/guest-posting.html', '/on-page-seo.html', '/gmb.html', '/contact.html', '/blog.html', '/blog-post.html', '/careers.html', '/career-job.html', '/privacy.html']);
  function publicPath(path) {
    var documentPath = path === '/' || path.endsWith('.html') ? path : path + '.html';
    return publicDocuments.has(documentPath) || /^\/(blog|jobs)\/[a-z0-9]+(?:-[a-z0-9]+)*\.html$/.test(documentPath);
  }
  if (!publicPath(location.pathname)) return; // Defense in depth if accidentally included privately.
  var serviceNames = {
    'on-page-seo': 'On-Page SEO', 'off-page-seo': 'Off-Page SEO', backlinks: 'Backlinks',
    'guest-posting': 'Guest Posting', 'blog-writing': 'Blog Writing', 'da-increase': 'DA Increase',
    'guest-post-sheet': 'Guest Post Sites Sheet', 'technical-seo': 'Technical SEO',
    'gmb-optimization': 'Google Business Profile (GMB)', 'web-development': 'Web Development',
    'multi-site-seo': '12-Website Monthly SEO Plan'
  };
  function safeService(value) {
    if (typeof value !== 'string') return '';
    var base = value.split(' — ')[0];
    return Object.values(serviceNames).find(function (name) { return base === name || (name === 'Google Business Profile (GMB)' && base === name + ' Optimization'); }) || '';
  }
  function publicPage() {
    if (!publicPath(location.pathname)) return null;
    var content = document.getElementById('blog-article') || document.getElementById('career-job-detail');
    if (content && content.dataset.analyticsReady !== 'true') return null;
    var path = location.pathname;
    if (/^\/(blog-post|career-job)(?:\.html)?$/.test(path)) {
      var slug = content && content.dataset.analyticsSlug;
      if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
      path += '?slug=' + encodeURIComponent(slug); // Confirmed public CMS identifier only.
    }
    return { path: path, location: location.origin + path, title: document.title.slice(0, 300) };
  }
  function safeReferrer() {
    try {
      var ref = new URL(document.referrer);
      if (!/^https?:$/.test(ref.protocol)) return '';
      if (ref.origin !== location.origin) return ref.origin + '/';
      return publicPath(ref.pathname) ? ref.origin + ref.pathname : '';
    } catch (_) { return ''; }
  }
  var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  var campaign = {};
  try { campaign = JSON.parse(sessionStorage.getItem('linkora.campaign') || '{}'); } catch (_) { /* storage is optional */ }
  var query = new URLSearchParams(location.search);
  if (!campaign || typeof campaign !== 'object' || Array.isArray(campaign)) campaign = {};
  if (keys.some(function (k) { return query.has(k); })) {
    campaign = {};
    keys.forEach(function (k) { if (query.has(k)) campaign[k] = query.get(k).slice(0, 120); });
    try { sessionStorage.setItem('linkora.campaign', JSON.stringify(campaign)); } catch (_) { /* optional */ }
  }
  var permitted = new Set(['lead_form_start', 'lead_form_submit', 'lead_form_success', 'generate_lead', 'quote_request', 'whatsapp_click', 'phone_click', 'email_click', 'service_view', 'service_cta_click', 'contact_cta_click', 'blog_cta_click', 'career_application']);
  var consentKey = 'linkora.analytics.consent', storedChoice = null;
  var consent = false;
  try { storedChoice = localStorage.getItem(consentKey); } catch (_) { /* default denied */ }
  consent = storedChoice === 'granted';
  var measurementId = config.ga4MeasurementId || '', configured = false, consentInitialized = false, googleConsentGranted = false;
  var enabled = /^G-[A-Z0-9]+$/.test(measurementId), serviceViewed = false;
  if (enabled) window['ga-disable-' + measurementId] = !consent;
  function track(name, detail) {
    if (!permitted.has(name)) return;
    var page = publicPage(); if (!page) return;
    detail = typeof detail === 'string' ? { context: detail } : detail || {};
    // Never spread arbitrary caller/DOM data, URLs, contact details, campaign or form values.
    var data = { page_path: page.path, source_page: page.path, context: /^(contact|service|blog|career|public)$/.test(detail.context) ? detail.context : 'public' };
    var service = safeService(detail.service_name || document.body.dataset.service);
    if (service) data.service_name = service;
    if (/^(header|footer|services_menu|service_card|service_section|order_modal|lead_form|content)$/.test(detail.cta_location)) data.cta_location = detail.cta_location;
    document.dispatchEvent(new CustomEvent('linkora:conversion', { detail: { name: name, parameters: data } }));
    if (consent && configured && typeof window.gtag === 'function') window.gtag('event', name, Object.assign({ send_to: measurementId }, data));
  }
  window.LinkoraMarketing = Object.freeze({ track: track, openPreferences: function () { showChoices(true); } });
  function carryCampaign(link) {
    if (!link || (link.getAttribute('href') || '').startsWith('#')) return;
    if (!keys.some(function (key) { return typeof campaign[key] === 'string' && campaign[key]; })) return;
    var url = new URL(link.href, location.href);
    // New tabs with noopener do not inherit sessionStorage. Carry attribution only
    // into known public documents, never private portals or third-party URLs.
    if (url.origin !== location.origin || !/^\/(?:index\.html|services\.html|about\.html|contact\.html|blog\.html|blog-post\.html|careers\.html|career-job\.html|backlinks\.html|guest-posting\.html|on-page-seo\.html|gmb\.html|privacy\.html|blog\/[a-z0-9-]+\.html|jobs\/[a-z0-9-]+\.html)?$/.test(url.pathname)) return;
    keys.forEach(function (key) { if (typeof campaign[key] === 'string' && !url.searchParams.has(key)) url.searchParams.set(key, campaign[key]); });
    link.href = url.href;
    if (url.hash && url.pathname === location.pathname && url.search === location.search) { link.removeAttribute('target'); link.removeAttribute('rel'); }
  }
  function loadAnalytics() {
    var page = publicPage();
    if (!consent || !enabled || !page) return;
    window['ga-disable-' + measurementId] = false;
    window.dataLayer = window.dataLayer || [];
    if (typeof window.gtag !== 'function') window.gtag = function () { window.dataLayer.push(arguments); };
    if (!consentInitialized) {
      window.gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
      consentInitialized = true;
    }
    if (!googleConsentGranted) {
      window.gtag('consent', 'update', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
      googleConsentGranted = true;
    }
    if (!configured) {
      window.gtag('js', new Date());
      // One standard config-generated page view; no extra manual page_view.
      window.gtag('config', measurementId, { send_page_view: true, allow_google_signals: false, allow_ad_personalization_signals: false, page_location: page.location, page_referrer: safeReferrer(), page_title: page.title });
      configured = true;
    }
    if (!document.querySelector('script[src^="https://www.googletagmanager.com/gtag/js"]')) {
      var tag = document.createElement('script'); tag.async = true; tag.dataset.linkoraAnalytics = 'true';
      tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(measurementId);
      tag.onerror = function () { tag.remove(); }; // A blocked tag must never break the page.
      document.head.appendChild(tag);
    }
    if (!serviceViewed && safeService(document.body.dataset.service)) {
      serviceViewed = true; track('service_view', { context: 'service', cta_location: 'content' });
    }
  }
  function clearAnalyticsCookies() {
    try {
      var names = document.cookie.split(';').map(function (part) { return part.trim().split('=')[0]; }).filter(function (name) { return name === '_ga' || name === '_ga_' + measurementId.slice(2).replace(/-/g, '_'); });
      var host = location.hostname.split('.'), domains = [''];
      for (var i = 0; i < host.length - 1; i++) domains.push(host.slice(i).join('.'));
      names.forEach(function (name) { domains.forEach(function (domain) { document.cookie = name + '=; Max-Age=0; path=/' + (domain ? '; domain=' + domain : '') + '; SameSite=Lax'; }); });
    } catch (_) { /* Storage restrictions must not break consent or navigation. */ }
  }
  function setConsent(choice, persist) {
    consent = choice === 'granted'; storedChoice = consent ? 'granted' : 'denied';
    if (persist) { try { localStorage.setItem(consentKey, storedChoice); } catch (_) { /* current tab only */ } }
    if (enabled) window['ga-disable-' + measurementId] = !consent;
    if (consent) loadAnalytics();
    else {
      googleConsentGranted = false;
      if (consentInitialized && typeof window.gtag === 'function') window.gtag('consent', 'update', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
      clearAnalyticsCookies();
    }
    document.querySelector('.analytics-choice')?.remove();
  }
  function showChoices(focus) {
    if (!enabled || document.querySelector('.analytics-choice')) return;
    var privacy = document.createElement('aside'); privacy.className = 'analytics-choice';
    privacy.setAttribute('aria-label', 'Analytics preferences');
    privacy.innerHTML = '<p>Allow Google Analytics to measure public page views and service interactions? Form contents and private portals are excluded. <a href="privacy.html#analytics">Privacy details</a></p><button type="button" data-accept>Allow analytics</button><button type="button" data-decline>' + (consent ? 'Withdraw analytics' : 'Decline analytics') + '</button>';
    if (storedChoice === 'granted' || storedChoice === 'denied') privacy.innerHTML += '<button type="button" data-close-analytics>Close</button>';
    document.body.appendChild(privacy);
    privacy.querySelector('[data-accept]').onclick = function () { setConsent('granted', true); };
    privacy.querySelector('[data-decline]').onclick = function () { setConsent('denied', true); };
    privacy.querySelector('[data-close-analytics]')?.addEventListener('click', function () { privacy.remove(); });
    if (focus) privacy.querySelector('button').focus();
  }
  function ctaLocation(element) {
    if (element.closest('.order-modal')) return 'order_modal';
    if (element.closest('.services-dropdown')) return 'services_menu';
    if (element.closest('header')) return 'header';
    if (element.closest('footer')) return 'footer';
    if (element.closest('.card, .service-feature')) return 'service_card';
    if (element.closest('section[id]')) return 'service_section';
    return 'content';
  }
  function serviceFor(element, url) {
    if (url && url.origin === location.origin) {
      var pageKey = { '/backlinks.html': 'backlinks', '/guest-posting.html': 'guest-posting', '/on-page-seo.html': 'on-page-seo', '/gmb.html': 'gmb-optimization' }[url.pathname];
      if (pageKey) return serviceNames[pageKey];
      if (url.pathname === '/services.html' && serviceNames[url.hash.slice(1)]) return serviceNames[url.hash.slice(1)];
    }
    return serviceNames[element.closest('section[id]')?.id] || safeService(document.body.dataset.service);
  }
  document.addEventListener('DOMContentLoaded', function () {
    loadAnalytics();
    if (enabled) {
      if (storedChoice !== 'granted' && storedChoice !== 'denied') showChoices(false);
      setTimeout(function () {
        var host = document.querySelector('.footer-bottom') || document.querySelector('footer');
        if (!host || document.querySelector('[data-analytics-preferences]')) return;
        var preferences = document.createElement('button'); preferences.type = 'button'; preferences.className = 'analytics-settings';
        preferences.dataset.analyticsPreferences = ''; preferences.textContent = 'Analytics preferences';
        preferences.onclick = function () { showChoices(true); }; host.appendChild(preferences);
      }, 0);
    }
    document.addEventListener('linkora:public-page-ready', loadAnalytics);
    document.addEventListener('linkora:public-page-unavailable', function () { if (enabled) window['ga-disable-' + measurementId] = true; });
    window.addEventListener('storage', function (event) { if (event.key === consentKey) setConsent(event.newValue, false); });
    document.querySelectorAll('a[href]').forEach(carryCampaign);
    ['pointerdown', 'focusin'].forEach(function (name) { document.addEventListener(name, function (event) { carryCampaign(event.target.closest('a[href]')); }, true); });
    document.addEventListener('click', function (event) {
      var action = event.target.closest('a[href], .order-service, .order-card-button, .gmb-order-trigger'); if (!action) return;
      var link = action.matches('a[href]') ? action : null;
      if (link) carryCampaign(link);
      var url = link ? new URL(link.href, location.href) : null;
      var service = serviceFor(action, url), info = { context: service ? 'service' : 'public', service_name: service, cta_location: ctaLocation(action) };
      if (action.matches('[data-service-cta], .order-service, .order-card-button, .gmb-order-trigger') || (url && url.origin === location.origin && (url.pathname === '/services.html' || (service && /^\/(backlinks|guest-posting|on-page-seo|gmb)\.html$/.test(url.pathname))))) track('service_cta_click', info);
      if (!url) return;
      if (url.hostname === 'wa.me') track('whatsapp_click', info);
      else if (url.protocol === 'tel:') track('phone_click', info);
      else if (url.protocol === 'mailto:' || url.hostname === 'mail.google.com') track('email_click', info);
      else if (url.pathname.endsWith('/contact.html')) track(location.pathname.includes('blog') ? 'blog_cta_click' : 'contact_cta_click', { context: 'contact', service_name: service, cta_location: info.cta_location });
    });
    document.querySelectorAll('form[data-lead-form]').forEach(function (form) {
      var busy = false, started = false, requestId = crypto.randomUUID(), completed = new Set();
      var message = form.querySelector('[data-lead-status]'), submit = form.querySelector('button[type=submit]');
      var service = form.elements.namedItem('service');
      if (query.has('service') && service && Array.from(service.options).some(function (o) { return o.value === query.get('service'); })) service.value = query.get('service');
      form.addEventListener('focusin', function () { if (!started) { track('lead_form_start', 'contact'); started = true; } });
      form.addEventListener('input', function () { if (!busy) requestId = crypto.randomUUID(); });
      form.addEventListener('submit', async function (event) {
        event.preventDefault(); if (busy || !form.reportValidity()) return;
        busy = true; submit.disabled = true; message.textContent = 'Sending your request…'; track('lead_form_submit', 'contact');
        var data = Object.fromEntries(new FormData(form));
        data.requestId = requestId; data.source_page = location.pathname; data.utm = campaign;
        try {
          var response = await fetch(config.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.publishableKey }, body: JSON.stringify(data), signal: AbortSignal.timeout(15000) });
          if (!response.ok) throw new Error(response.status === 429 ? 'Too many requests. Please wait before trying again.' : 'Your request could not be saved. Please retry or contact us on WhatsApp.');
          var result = await response.json(); if (!result.accepted) throw new Error('Your request could not be saved. Please try again.');
          message.textContent = 'Thank you. Your request has been received. Our team will review your requirements and contact you shortly.';
          // The existing backend deliberately acknowledges its honeypot without saving.
          if (!data.company_site && !completed.has(requestId)) {
            completed.add(requestId);
            var info = { context: 'contact', service_name: service && service.value, cta_location: 'lead_form' };
            track('lead_form_success', info); track('generate_lead', info);
            if (form.hasAttribute('data-quote-request')) track('quote_request', info);
          }
          form.reset(); requestId = crypto.randomUUID(); started = false;
        } catch (error) { message.textContent = error.name === 'TimeoutError' ? 'Confirmation is taking longer than expected. Retry to check the same request without duplicating it.' : error.message; }
        finally { busy = false; submit.disabled = false; }
      });
    });
  });
}());
