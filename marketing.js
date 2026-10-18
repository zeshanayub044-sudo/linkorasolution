(function () {
  'use strict';
  // This file is included only on public marketing pages, never Employee/Admin pages.
  var config = window.LINKORA_MARKETING_CONFIG || {};
  var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  var campaign = {};
  try { campaign = JSON.parse(sessionStorage.getItem('linkora.campaign') || '{}'); } catch (_) { /* storage is optional */ }
  var query = new URLSearchParams(location.search);
  if (keys.some(function (k) { return query.has(k); })) {
    campaign = {};
    keys.forEach(function (k) { if (query.has(k)) campaign[k] = query.get(k).slice(0, 120); });
    try { sessionStorage.setItem('linkora.campaign', JSON.stringify(campaign)); } catch (_) { /* optional */ }
  }
  var permitted = new Set(['lead_form_start', 'lead_form_submit', 'lead_form_success', 'whatsapp_click', 'phone_click', 'email_click', 'service_view', 'service_cta_click', 'contact_cta_click', 'blog_cta_click', 'career_application']);
  var consent = false;
  try { consent = localStorage.getItem('linkora.analytics.consent') === 'granted'; } catch (_) { /* default denied */ }
  function track(name, detail) {
    if (!permitted.has(name)) return;
    // Only controlled event labels and pathname. Never form values, query strings, UTM or PII.
    var data = { page_path: location.pathname, context: /^(contact|service|blog|career|public)$/.test(detail) ? detail : 'public' };
    document.dispatchEvent(new CustomEvent('linkora:conversion', { detail: { name: name, parameters: data } }));
    if (consent && typeof window.gtag === 'function') window.gtag('event', name, data);
  }
  window.LinkoraMarketing = Object.freeze({ track: track });
  function loadAnalytics() {
    if (!consent || !/^G-[A-Z0-9]+$/.test(config.ga4MeasurementId || '') || document.querySelector('[data-linkora-analytics]') || window.gtag) return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    window.gtag('js', new Date());
    window.gtag('config', config.ga4MeasurementId, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false, page_location: location.origin + location.pathname, page_referrer: '', page_title: '' });
    window.gtag('event', 'page_view', { page_location: location.origin + location.pathname, page_referrer: '', page_title: '' });
    var tag = document.createElement('script'); tag.async = true; tag.dataset.linkoraAnalytics = 'true';
    tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(config.ga4MeasurementId); document.head.appendChild(tag);
  }
  document.addEventListener('DOMContentLoaded', function () {
    loadAnalytics();
    if (/^G-[A-Z0-9]+$/.test(config.ga4MeasurementId || '')) {
      var privacy = document.createElement('aside'); privacy.className = 'analytics-choice';
      privacy.innerHTML = '<p>Optional analytics helps us understand public website use. It excludes form content and private portals.</p><button type="button" data-accept>Allow analytics</button><button type="button" data-decline>Decline / withdraw</button>';
      document.body.appendChild(privacy);
      privacy.querySelector('[data-accept]').onclick = function () { consent = true; try { localStorage.setItem('linkora.analytics.consent', 'granted'); } catch (_) {} loadAnalytics(); privacy.remove(); };
      privacy.querySelector('[data-decline]').onclick = function () { consent = false; try { localStorage.setItem('linkora.analytics.consent', 'denied'); } catch (_) {} if (window.gtag) window.gtag('consent', 'update', { analytics_storage: 'denied' }); privacy.remove(); };
    }
    if (document.body.dataset.service) track('service_view', 'service');
    document.addEventListener('click', function (event) {
      var link = event.target.closest('a[href]'); if (!link) return;
      var url = new URL(link.href, location.href);
      if (url.hostname === 'wa.me') track('whatsapp_click');
      else if (url.protocol === 'tel:') track('phone_click');
      else if (url.protocol === 'mailto:' || url.hostname === 'mail.google.com') track('email_click');
      else if (link.matches('[data-service-cta]')) track('service_cta_click', 'service');
      else if (url.pathname.endsWith('/contact.html')) track(location.pathname.includes('blog') ? 'blog_cta_click' : 'contact_cta_click', 'contact');
    });
    document.querySelectorAll('form[data-lead-form]').forEach(function (form) {
      var busy = false, started = false, requestId = crypto.randomUUID();
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
          track('lead_form_success', 'contact'); form.reset(); requestId = crypto.randomUUID(); started = false;
        } catch (error) { message.textContent = error.name === 'TimeoutError' ? 'Confirmation is taking longer than expected. Retry to check the same request without duplicating it.' : error.message; }
        finally { busy = false; submit.disabled = false; }
      });
    });
  });
}());
