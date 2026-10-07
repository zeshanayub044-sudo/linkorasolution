(function () {
  'use strict';

  var config = window.LINKORA_BLOG_CONFIG || {};
  var imagePrefix = config.url + '/storage/v1/object/public/blog-images/';

  function configured() {
    return /^https:\/\//.test(config.url || '') &&
      /^sb_publishable_/.test(config.publishableKey || '') &&
      !!(window.supabase && window.supabase.createClient);
  }

  function createClient(editor) {
    if (!configured()) throw new Error('The blog service is unavailable. Please try again later.');
    return window.supabase.createClient(config.url, config.publishableKey, {
      auth: editor
        ? { storageKey: 'linkora.blog.auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        : { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
  }

  function slugify(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 140).replace(/-$/g, '');
  }

  function validSlug(value) {
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value || '') && value.length <= 140;
  }

  function imageUrl(value) {
    return typeof value === 'string' && value.startsWith(imagePrefix) ? value : '';
  }

  function formatDate(value) {
    if (!value) return '—';
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function readingTime(value) {
    var words = String(value || '').trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 220));
  }

  // Posts are plain text with optional # headings and dash lists. Every block
  // uses textContent, so stored markup can never execute in a reader's browser.
  function renderContent(host, value) {
    host.replaceChildren();
    String(value || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).forEach(function (block) {
      var lines = block.trim().split('\n');
      if (!lines[0]) return;
      var heading = lines.length === 1 && /^(#{1,3})\s+(.+)$/.exec(lines[0]);
      if (heading) {
        var level = Math.min(4, heading[1].length + 1);
        var title = document.createElement('h' + level);
        title.textContent = heading[2];
        host.appendChild(title);
      } else if (lines.every(function (line) { return /^-\s+/.test(line); })) {
        var list = document.createElement('ul');
        lines.forEach(function (line) {
          var item = document.createElement('li');
          item.textContent = line.replace(/^-\s+/, '');
          list.appendChild(item);
        });
        host.appendChild(list);
      } else {
        var paragraph = document.createElement('p');
        paragraph.textContent = lines.join('\n');
        host.appendChild(paragraph);
      }
    });
  }

  function postUrl(slug) { return 'blog-post.html?slug=' + encodeURIComponent(slug); }

  window.LinkoraBlog = Object.freeze({
    config: config, createClient: createClient, slugify: slugify, validSlug: validSlug,
    imageUrl: imageUrl, formatDate: formatDate, readingTime: readingTime,
    renderContent: renderContent, postUrl: postUrl
  });
}());
