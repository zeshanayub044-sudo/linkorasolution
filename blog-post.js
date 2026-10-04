(function () {
  'use strict';
  var blog = window.LinkoraBlog;
  var article = document.getElementById('blog-article');
  var relatedSection = document.getElementById('blog-related');
  var relatedGrid = document.getElementById('blog-related-grid');
  var slug = new URLSearchParams(location.search).get('slug');

  function node(tag, className, value) {
    var item = document.createElement(tag);
    if (className) item.className = className;
    if (value !== undefined) item.textContent = value;
    return item;
  }
  function meta(name, value, property) {
    var selector = 'meta[' + (property ? 'property' : 'name') + '="' + name + '"]';
    var item = document.querySelector(selector);
    if (!item) {
      item = node('meta');
      item.setAttribute(property ? 'property' : 'name', name);
      document.head.appendChild(item);
    }
    item.content = value || '';
  }
  function notFound(message) {
    document.title = 'Article not found | LINKORA SOLUTIONS';
    var status = document.getElementById('blog-article-status');
    status.textContent = message;
  }
  function setSeo(post, author) {
    var title = post.seo_title || post.title;
    var description = post.seo_description || post.excerpt;
    var url = post.canonical_url || location.origin + '/blog-post.html?slug=' + encodeURIComponent(post.slug);
    document.title = title + ' | LINKORA SOLUTIONS';
    meta('description', description);
    meta('robots', 'index,follow');
    meta('og:title', title, true);
    meta('og:description', description, true);
    meta('og:url', url, true);
    meta('og:image', blog.imageUrl(post.featured_image_url) || location.origin + '/assets/linkora-logo.png', true);
    meta('twitter:title', title);
    meta('twitter:description', description);
    meta('twitter:image', blog.imageUrl(post.featured_image_url) || location.origin + '/assets/linkora-logo.png');
    var canonical = document.querySelector('link[rel=canonical]') || node('link');
    canonical.rel = 'canonical'; canonical.href = url;
    if (!canonical.parentNode) document.head.appendChild(canonical);
    var json = node('script');
    json.type = 'application/ld+json';
    json.textContent = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Article', headline: post.title,
      description: description, image: blog.imageUrl(post.featured_image_url) || undefined,
      datePublished: post.published_at, dateModified: post.updated_at,
      author: { '@type': 'Person', name: author.display_name || 'Linkora team' },
      publisher: { '@type': 'Organization', name: 'LINKORA SOLUTIONS', logo: { '@type': 'ImageObject', url: location.origin + '/assets/linkora-logo.png' } },
      mainEntityOfPage: url
    }).replace(/</g, '\\u003c');
    document.head.appendChild(json);
  }
  function render(post) {
    var author = post.blog_authors || {};
    setSeo(post, author);
    document.getElementById('blog-article-status').remove();
    article.appendChild(node('span', 'blog-article__category', post.category));
    article.appendChild(node('h1', '', post.title));
    article.appendChild(node('p', 'blog-article__lead', post.excerpt));
    var dateLine = 'Published ' + blog.formatDate(post.published_at);
    if (new Date(post.updated_at).getTime() - new Date(post.published_at).getTime() > 60000) {
      dateLine += ' · Updated ' + blog.formatDate(post.updated_at);
    }
    article.appendChild(node('p', 'blog-article__meta', dateLine + ' · ' + post.reading_minutes + ' min read · ' + Number(post.view_count || 0).toLocaleString() + ' views'));
    var image = blog.imageUrl(post.featured_image_url);
    if (image) {
      var cover = node('img', 'blog-article__image');
      cover.src = image; cover.alt = post.title;
      article.appendChild(cover);
    }
    var byline = node('div', 'blog-article__author');
    if (author.avatar_url && /^https:\/\//.test(author.avatar_url)) {
      var avatar = node('img', 'blog-article__avatar');
      avatar.src = author.avatar_url; avatar.alt = '';
      byline.appendChild(avatar);
    }
    var identity = node('div');
    identity.appendChild(node('strong', '', author.display_name || 'Linkora team'));
    if (author.title) identity.appendChild(node('span', '', author.title));
    byline.appendChild(identity);
    article.appendChild(byline);
    var content = node('div', 'blog-article__content');
    blog.renderContent(content, post.content);
    article.appendChild(content);
    var share = node('div', 'blog-share');
    share.appendChild(node('span', '', 'Share this article:'));
    var current = encodeURIComponent(location.href);
    [['LinkedIn', 'https://www.linkedin.com/sharing/share-offsite/?url=' + current],
      ['X', 'https://twitter.com/intent/tweet?url=' + current + '&text=' + encodeURIComponent(post.title)],
      ['Email', 'mailto:?subject=' + encodeURIComponent(post.title) + '&body=' + current]].forEach(function (pair) {
      var link = node('a', '', pair[0]);
      link.href = pair[1];
      if (pair[0] !== 'Email') { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      share.appendChild(link);
    });
    article.appendChild(share);
  }
  async function loadRelated(client, post) {
    var result = await client.from('blog_posts').select('title,slug,excerpt,category,published_at')
      .eq('status', 'published').neq('id', post.id).order('published_at', { ascending: false }).limit(3);
    if (result.error || !result.data || !result.data.length) return;
    result.data.forEach(function (other) {
      var card = node('article', 'blog-card');
      var body = node('div', 'blog-card__body');
      body.appendChild(node('span', 'blog-card__category', other.category));
      var h2 = node('h2'); var link = node('a', '', other.title); link.href = blog.postUrl(other.slug);
      h2.appendChild(link); body.appendChild(h2);
      body.appendChild(node('p', 'blog-card__excerpt', other.excerpt));
      body.appendChild(node('p', 'blog-card__meta', blog.formatDate(other.published_at)));
      card.appendChild(body); relatedGrid.appendChild(card);
    });
    relatedSection.hidden = false;
  }
  async function load() {
    if (!blog.validSlug(slug)) { notFound('This article could not be found.'); return; }
    try {
      var client = blog.createClient(false);
      var result = await client.from('blog_posts')
        .select('id,title,slug,excerpt,content,reading_minutes,featured_image_url,category,published_at,updated_at,view_count,seo_title,seo_description,canonical_url,blog_authors(display_name,title,bio,avatar_url)')
        .eq('slug', slug).eq('status', 'published').maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) { notFound('This article is unavailable or has not been published.'); return; }
      render(result.data);
      try {
        var key = 'linkora.blog.view.' + slug;
        if (!sessionStorage.getItem(key)) {
          var count = await client.rpc('blog_record_view', { p_slug: slug });
          if (!count.error) sessionStorage.setItem(key, '1');
        }
      } catch (_) { /* A blocked storage/RPC call must not hide the article. */ }
      loadRelated(client, result.data).catch(function (error) { console.error('Related articles unavailable', error); });
    } catch (error) {
      notFound('The article could not be loaded. Please try again later.');
      console.error('Article loading failed', error);
    }
  }
  load();
}());
