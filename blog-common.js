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
  function inline(host, value) {
    var pattern = /\[([^\]\n]+)\]\(((?:[^\s()]|\([^\s()]*\))+)\)/g, match, cursor = 0;
    while ((match = pattern.exec(value))) {
      host.appendChild(document.createTextNode(value.slice(cursor, match.index)));
      var link = null; try { var url = new URL(match[2], document.baseURI); if (/^https?:$/.test(url.protocol) && !url.username && !url.password) { link = document.createElement('a'); link.href = url.href; link.textContent = match[1]; link.target = '_blank'; link.rel = 'noopener noreferrer'; } } catch (_) { /* unsafe URLs remain plain text */ }
      host.appendChild(link || document.createTextNode(match[0])); cursor = pattern.lastIndex;
    }
    host.appendChild(document.createTextNode(value.slice(cursor)));
  }
  function renderContent(host, value) {
    host.replaceChildren();
    String(value || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).forEach(function (block) {
      var lines = block.trim().split('\n');
      if (!lines[0]) return;
      var heading = lines.length === 1 && /^(#{1,3})\s+(.+)$/.exec(lines[0]);
      if (heading) {
        var level = Math.min(4, heading[1].length + 1);
        var title = document.createElement('h' + level);
        inline(title, heading[2]);
        host.appendChild(title);
      } else if (lines.every(function (line) { return /^-\s+/.test(line); })) {
        var list = document.createElement('ul');
        lines.forEach(function (line) {
          var item = document.createElement('li');
          inline(item, line.replace(/^-\s+/, ''));
          list.appendChild(item);
        });
        host.appendChild(list);
      } else {
        var paragraph = document.createElement('p');
        inline(paragraph, lines.join('\n'));
        host.appendChild(paragraph);
      }
    });
  }

  function canonicalUrl(value, fallback) { try { var url = new URL(value); if (url.protocol === 'https:' && !url.username && !url.password) return url.href; } catch (_) {} return fallback; }
  async function validatePublication(post) {
    if (!post.excerpt || !post.content) throw new Error('A published article needs an excerpt and content.');
    var value = String(post.canonical_url || '').trim();
    if (!value) return; // The generated article URL is the default canonical.
    var canonical = canonicalUrl(value, '');
    if (!canonical || new URL(canonical).hash) throw new Error('Use an HTTPS canonical URL without credentials or a fragment, or leave it blank.');
    var url = new URL(canonical);
    if (!['linkorasolution.com', 'www.linkorasolution.com'].includes(url.hostname)) return;
    if (url.href === 'https://linkorasolution.com/blog/' + post.slug + '.html') return; // A new article is generated after publishing.
    if (url.port) throw new Error('Use the normal public website URL for the canonical, or leave it blank.');
    var response;
    try {
      response = await fetch(url.href, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(10000) });
    } catch (_) { throw new Error('The canonical page could not be verified. Use a working public URL or leave it blank for this article.'); }
    if (!response.ok) throw new Error('The canonical page returned HTTP ' + response.status + '. Use a working public URL or leave it blank for this article.');
    var page = new DOMParser().parseFromString(await response.text(), 'text/html');
    var robots = Array.from(page.querySelectorAll('meta')).filter(function (meta) {
      return ['robots', 'googlebot'].includes((meta.getAttribute('name') || '').toLowerCase());
    }).map(function (meta) { return meta.content; }).join(',') + ',' + (response.headers.get('X-Robots-Tag') || '');
    if (/(?:^|[\s,])(?:noindex|none)(?:$|[\s,])/i.test(robots)) throw new Error('The canonical page is not indexable. Choose a public original article URL or leave this field blank.');
    var preferred = page.querySelector('link[rel="canonical"]')?.getAttribute('href');
    if (!preferred) throw new Error('The canonical page has no preferred public URL. Leave this field blank to use this article’s URL.');
    if (new URL(preferred, response.url || url.href).href !== url.href) throw new Error('Use the original page’s preferred canonical URL, or leave this field blank.');
  }
  function postUrl(slug) { return window.LINKORA_PUBLIC_ROUTES?.blog.includes(slug) ? '/blog/' + encodeURIComponent(slug) + '.html' : '/blog-post.html?slug=' + encodeURIComponent(slug); }

  window.LinkoraBlog = Object.freeze({
    config: config, createClient: createClient, slugify: slugify, validSlug: validSlug,
    imageUrl: imageUrl, formatDate: formatDate, readingTime: readingTime,
    renderContent: renderContent, postUrl: postUrl, canonicalUrl: canonicalUrl, validatePublication: validatePublication
  });
}());
