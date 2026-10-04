(function () {
  'use strict';
  var blog = window.LinkoraBlog;
  var grid = document.getElementById('blog-grid');
  var status = document.getElementById('blog-status');
  var search = document.getElementById('blog-search');
  var category = document.getElementById('blog-category');
  var posts = [];
  var client;

  function element(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }

  function card(post) {
    var article = element('article', 'blog-card');
    var imageLink = element('a', 'blog-card__image');
    imageLink.href = blog.postUrl(post.slug);
    var image = blog.imageUrl(post.featured_image_url);
    if (image) {
      var picture = element('img');
      picture.src = image;
      picture.alt = '';
      picture.loading = 'lazy';
      imageLink.appendChild(picture);
    } else {
      var fallback = element('span', 'blog-card__fallback');
      var mark = element('img');
      mark.src = 'assets/linkora-mark.png';
      mark.alt = '';
      fallback.appendChild(mark);
      imageLink.appendChild(fallback);
    }
    article.appendChild(imageLink);

    var body = element('div', 'blog-card__body');
    body.appendChild(element('span', 'blog-card__category', post.category || 'Insights'));
    var title = element('h2');
    var titleLink = element('a', '', post.title);
    titleLink.href = blog.postUrl(post.slug);
    title.appendChild(titleLink);
    body.appendChild(title);
    body.appendChild(element('p', 'blog-card__excerpt', post.excerpt));
    var author = post.blog_authors && post.blog_authors.display_name || 'Linkora team';
    var meta = element('p', 'blog-card__meta', author + ' · ' + blog.formatDate(post.published_at) + ' · ' + post.reading_minutes + ' min read · ' + Number(post.view_count || 0).toLocaleString() + ' views');
    body.appendChild(meta);
    var more = element('a', 'blog-card__more', 'Read article →');
    more.href = blog.postUrl(post.slug);
    body.appendChild(more);
    article.appendChild(body);
    return article;
  }

  function render() {
    var term = search.value.trim().toLocaleLowerCase();
    var selected = category.value;
    var filtered = posts.filter(function (post) {
      var matchesCategory = !selected || post.category === selected;
      var text = [post.title, post.excerpt, post.category].join(' ').toLocaleLowerCase();
      return matchesCategory && (!term || text.includes(term));
    });
    grid.replaceChildren();
    if (!filtered.length) {
      grid.appendChild(element('div', 'blog-empty', posts.length ? 'No articles match your search.' : 'No published articles yet. Check back soon.'));
    } else {
      var fragment = document.createDocumentFragment();
      filtered.forEach(function (post) { fragment.appendChild(card(post)); });
      grid.appendChild(fragment);
    }
    status.textContent = filtered.length + ' article' + (filtered.length === 1 ? '' : 's') + (term || selected ? ' found' : ' published');
  }

  async function load() {
    status.textContent = 'Loading articles…';
    grid.replaceChildren();
    try {
      client = client || blog.createClient(false);
      var all = [];
      var offset = 0;
      var pageSize = 200;
      while (true) {
        var result = await client.from('blog_posts')
          .select('id,title,slug,excerpt,reading_minutes,featured_image_url,category,published_at,view_count,blog_authors(display_name,title)')
          .eq('status', 'published').order('published_at', { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (result.error) throw result.error;
        all.push.apply(all, result.data || []);
        if (!result.data || result.data.length < pageSize) break;
        offset += pageSize;
      }
      posts = all;
      var allCategories = element('option', '', 'All categories');
      allCategories.value = '';
      category.replaceChildren(allCategories);
      Array.from(new Set(posts.map(function (post) { return post.category; }).filter(Boolean)))
        .sort().forEach(function (name) {
          var option = element('option', '', name);
          option.value = name;
          category.appendChild(option);
        });
      render();
    } catch (error) {
      status.textContent = 'Articles could not be loaded right now.';
      var retry = element('button', 'btn btn-ghost', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', load);
      grid.appendChild(element('div', 'blog-empty', 'Please check your connection and try again.'));
      grid.lastChild.appendChild(retry);
      console.error('Blog loading failed', error);
    }
  }

  search.addEventListener('input', render);
  category.addEventListener('change', render);
  load();
}());
