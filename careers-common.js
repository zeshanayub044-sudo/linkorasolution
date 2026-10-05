(function () {
  'use strict';
  var config = window.LINKORA_CAREERS_CONFIG || {};
  function createClient(admin) {
    if (!/^https:\/\//.test(config.url || '') ||
        !/^sb_publishable_/.test(config.publishableKey || '') ||
        !window.supabase || !window.supabase.createClient) {
      throw new Error('The Careers service is unavailable. Please try again later.');
    }
    return window.supabase.createClient(config.url, config.publishableKey, {
      auth: admin
        ? { storageKey: 'linkora.careers.auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        : { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
  }
  function slugify(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 140).replace(/-$/g, '');
  }
  function validSlug(value) {
    return typeof value === 'string' && value.length <= 140 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
  }
  function node(tag, className, content) {
    var item = document.createElement(tag);
    if (className) item.className = className;
    if (content !== undefined) item.textContent = content;
    return item;
  }
  function formatDate(value) {
    if (!value) return '—';
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function employment(value) {
    return { full_time: 'Full-time', part_time: 'Part-time', internship: 'Internship', contract: 'Contract' }[value] || value || '—';
  }
  function workplace(value) {
    return { on_site: 'On-site', remote: 'Remote', hybrid: 'Hybrid' }[value] || value || '—';
  }
  function salary(job) {
    if (job.salary_min == null && job.salary_max == null) return '';
    var currency = job.salary_currency || '';
    var fmt = function (n) { return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }); };
    if (job.salary_min != null && job.salary_max != null) return currency + ' ' + fmt(job.salary_min) + '–' + fmt(job.salary_max);
    return currency + ' ' + (job.salary_min != null ? 'From ' + fmt(job.salary_min) : 'Up to ' + fmt(job.salary_max));
  }
  // Treat all job/candidate text as text. No stored HTML is interpreted.
  function renderText(host, value) {
    host.replaceChildren();
    String(value || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).forEach(function (block) {
      var lines = block.trim().split('\n');
      if (!lines[0]) return;
      if (lines.every(function (line) { return /^-\s+/.test(line); })) {
        var list = node('ul');
        lines.forEach(function (line) { list.appendChild(node('li', '', line.replace(/^-\s+/, ''))); });
        host.appendChild(list);
      } else {
        host.appendChild(node('p', '', lines.join('\n')));
      }
    });
  }
  function jobUrl(slug) { return 'career-job.html?slug=' + encodeURIComponent(slug); }
  window.LinkoraCareers = Object.freeze({
    config: config, createClient: createClient, slugify: slugify, validSlug: validSlug,
    node: node, formatDate: formatDate, employment: employment, workplace: workplace,
    salary: salary, renderText: renderText, jobUrl: jobUrl
  });
}());
