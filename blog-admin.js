(function () {
  'use strict';
  var blog = window.LinkoraBlog;
  var client;
  var user;
  var role;
  var posts = [];
  var notice = document.getElementById('blog-admin-notice');
  var login = document.getElementById('blog-login');
  var dashboard = document.getElementById('blog-dashboard');
  var formPanel = document.getElementById('blog-edit-panel');
  var form = document.getElementById('blog-post-form');
  var rows = document.getElementById('blog-admin-rows');
  var saveButton = document.getElementById('blog-save');
  var imageFile = document.getElementById('blog-image-file');

  function show(message, kind) {
    notice.textContent = message;
    notice.dataset.kind = kind || '';
  }
  function field(name) { return form.elements.namedItem(name); }
  function cell(value) {
    var item = document.createElement('td');
    item.textContent = value == null ? '' : String(value);
    return item;
  }
  function errorMessage(error) {
    if (error && error.code === '23505') return 'This slug already exists. Choose another one.';
    if (error && error.code === '42501') return 'Access denied. Co-CEO authorization required.';
    return (error && error.message) || 'Something went wrong. Please try again.';
  }
  function resetEditor() {
    form.reset();
    field('id').value = '';
    field('featured_image_url').value = '';
    field('category').value = 'Insights';
    document.getElementById('blog-image-url').value = '';
    imageFile.value = '';
    field('slug').dataset.generated = 'yes';
    document.getElementById('blog-form-title').textContent = 'New article';
  }
  function openEditor(post) {
    resetEditor();
    if (post) {
      ['id', 'title', 'slug', 'category', 'excerpt', 'content', 'status', 'featured_image_url', 'seo_title', 'seo_description', 'canonical_url'].forEach(function (key) {
        field(key).value = post[key] || (key === 'category' ? 'Insights' : '');
      });
      document.getElementById('blog-image-url').value = post.featured_image_url || '';
      document.getElementById('blog-form-title').textContent = 'Edit article';
    }
    formPanel.hidden = false;
    formPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function canEdit() { return role === 'blog_admin'; }
  function canDelete() { return role === 'blog_admin'; }
  function action(label, handler, dangerous) {
    var button = document.createElement('button');
    button.type = 'button'; button.textContent = label;
    if (dangerous) button.className = 'danger';
    button.addEventListener('click', handler);
    return button;
  }
  function renderList() {
    var search = document.getElementById('blog-admin-search').value.trim().toLowerCase();
    var filter = document.getElementById('blog-admin-filter').value;
    rows.replaceChildren();
    posts.filter(function (post) {
      return (!filter || post.status === filter) &&
        (!search || [post.title, post.slug, post.category].join(' ').toLowerCase().includes(search));
    }).forEach(function (post) {
      var row = document.createElement('tr');
      row.appendChild(cell(post.title)); row.appendChild(cell(post.blog_authors && post.blog_authors.display_name || 'Unknown')); row.appendChild(cell(post.category));
      row.appendChild(cell(post.status)); row.appendChild(cell(blog.formatDate(post.updated_at)));
      row.appendChild(cell(Number(post.view_count || 0).toLocaleString()));
      var actions = cell('');
      if (canEdit(post)) {
        actions.appendChild(action('Edit', function () { openEditor(post); }));
        actions.appendChild(action(post.status === 'published' ? 'Unpublish' : 'Publish', function () { changeStatus(post); }));
      }
      if (post.status === 'published') {
        var view = document.createElement('a'); view.href = blog.postUrl(post.slug);
        view.textContent = 'View'; view.target = '_blank'; view.rel = 'noopener';
        view.style.color = 'var(--teal)'; view.style.marginRight = '12px';
        actions.appendChild(view);
      }
      if (canDelete(post)) actions.appendChild(action('Delete', function () { deletePost(post); }, true));
      row.appendChild(actions); rows.appendChild(row);
    });
    if (!rows.children.length) {
      var empty = document.createElement('tr');
      var message = cell('No articles match these filters.'); message.colSpan = 7;
      empty.appendChild(message); rows.appendChild(empty);
    }
  }
  async function loadPosts() {
    var all = [];
    var offset = 0;
    while (true) {
      var response = await client.from('blog_posts').select('*,blog_authors(display_name)')
        .order('updated_at', { ascending: false }).range(offset, offset + 199);
      if (response.error) throw response.error;
      all.push.apply(all, response.data || []);
      if (!response.data || response.data.length < 200) break;
      offset += 200;
    }
    posts = all;
    document.getElementById('stat-total').textContent = posts.length;
    document.getElementById('stat-published').textContent = posts.filter(function (post) { return post.status === 'published'; }).length;
    document.getElementById('stat-drafts').textContent = posts.filter(function (post) { return post.status === 'draft'; }).length;
    document.getElementById('stat-views').textContent = posts.reduce(function (sum, post) { return sum + Number(post.view_count || 0); }, 0).toLocaleString();
    renderList();
  }
  async function refreshAccess() {
    var identity = await client.auth.getUser();
    user = identity.data && identity.data.user;
    role = null;
    dashboard.hidden = true;
    document.getElementById('blog-signout').hidden = !user;
    if (!user) {
      login.hidden = false;
      show('Sign in with an active Co-CEO account.');
      return;
    }
    var roleResult = await client.rpc('blog_current_role');
    if (roleResult.error) throw roleResult.error;
    role = roleResult.data;
    if (role !== 'blog_admin') {
      posts = [];
      rows.replaceChildren();
      formPanel.hidden = true;
      login.hidden = true;
      show('Access denied. Co-CEO authorization required.', 'error');
      return;
    }
    login.hidden = true;
    dashboard.hidden = false;
    document.getElementById('blog-role-label').textContent = user.email + ' · Blog Admin';
    await loadPosts();
    show('Blog Editor ready.', 'success');
  }
  async function uploadImage(file) {
    var accepted = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
    if (!accepted.includes(file.type) || file.size > 5 * 1024 * 1024) {
      throw new Error('Choose a JPEG, PNG, WebP, or AVIF image under 5 MB.');
    }
    var extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' }[file.type];
    var path = user.id + '/' + crypto.randomUUID() + '.' + extension;
    var uploaded = await client.storage.from('blog-images').upload(path, file, { contentType: file.type, upsert: false });
    if (uploaded.error) throw uploaded.error;
    return client.storage.from('blog-images').getPublicUrl(path).data.publicUrl;
  }
  async function savePost(event) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    var slug = field('slug').value.trim();
    if (!blog.validSlug(slug)) { show('Use a lowercase slug with words separated by hyphens.', 'error'); return; }
    var status = field('status').value;
    var payload = {
      title: field('title').value.trim(), slug: slug,
      category: field('category').value.trim(), excerpt: field('excerpt').value.trim(),
      content: field('content').value.trim(), status: status,
      featured_image_url: field('featured_image_url').value || null,
      seo_title: field('seo_title').value.trim() || null,
      seo_description: field('seo_description').value.trim() || null,
      canonical_url: field('canonical_url').value.trim() || null
    };
    if (status === 'published' && (!payload.excerpt || !payload.content)) {
      show('A published article needs an excerpt and content.', 'error'); return;
    }
    saveButton.disabled = true;
    show('Saving article…');
    try {
      if (imageFile.files[0]) payload.featured_image_url = await uploadImage(imageFile.files[0]);
      var id = field('id').value;
      var result = id
        ? await client.from('blog_posts').update(payload).eq('id', id).select('id').single()
        : await client.from('blog_posts').insert(payload).select('id').single();
      if (result.error) throw result.error;
      formPanel.hidden = true;
      resetEditor();
      await loadPosts();
      show('Article saved successfully.', 'success');
    } catch (error) {
      show(errorMessage(error), 'error');
      console.error('Blog save failed', error);
    } finally { saveButton.disabled = false; }
  }
  async function changeStatus(post) {
    var next = post.status === 'published' ? 'draft' : 'published';
    if (!confirm((next === 'published' ? 'Publish' : 'Unpublish') + ' “' + post.title + '”?')) return;
    try {
      var result = await client.from('blog_posts').update({ status: next }).eq('id', post.id).select('id').single();
      if (result.error) throw result.error;
      await loadPosts();
      show('Article ' + (next === 'published' ? 'published.' : 'unpublished.'), 'success');
    } catch (error) { show(errorMessage(error), 'error'); }
  }
  async function deletePost(post) {
    if (!confirm('Permanently delete “' + post.title + '”? This cannot be undone.')) return;
    try {
      var result = await client.from('blog_posts').delete().eq('id', post.id).select('id').single();
      if (result.error) throw result.error;
      await loadPosts();
      show('Article deleted.', 'success');
    } catch (error) { show(errorMessage(error), 'error'); }
  }
  document.getElementById('blog-login-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var loginForm = event.currentTarget;
    var email = loginForm.elements.namedItem('email').value.trim();
    var password = loginForm.elements.namedItem('password').value;
    show('Signing in…');
    try {
      var response = await client.auth.signInWithPassword({ email: email, password: password });
      if (response.error) throw response.error;
      loginForm.reset();
      await refreshAccess();
    } catch (error) { show(errorMessage(error), 'error'); }
  });
  document.getElementById('blog-signout').addEventListener('click', async function () {
    var result = await client.auth.signOut();
    if (result.error) { show(errorMessage(result.error), 'error'); return; }
    posts = []; formPanel.hidden = true; await refreshAccess();
  });
  document.getElementById('blog-new').addEventListener('click', function () { openEditor(); });
  document.getElementById('blog-cancel').addEventListener('click', function () { formPanel.hidden = true; resetEditor(); });
  document.getElementById('blog-image-clear').addEventListener('click', function () {
    field('featured_image_url').value = ''; imageFile.value = '';
    document.getElementById('blog-image-url').value = '';
  });
  field('title').addEventListener('input', function () {
    if (!field('id').value && (!field('slug').value || field('slug').dataset.generated === 'yes')) {
      field('slug').value = blog.slugify(field('title').value);
      field('slug').dataset.generated = 'yes';
    }
  });
  field('slug').addEventListener('input', function () { field('slug').dataset.generated = 'no'; });
  form.addEventListener('submit', savePost);
  document.getElementById('blog-admin-search').addEventListener('input', renderList);
  document.getElementById('blog-admin-filter').addEventListener('change', renderList);
  document.getElementById('blog-preview').addEventListener('click', function () {
    document.getElementById('blog-preview-title').textContent = field('title').value || 'Untitled article';
    document.getElementById('blog-preview-excerpt').textContent = field('excerpt').value;
    blog.renderContent(document.getElementById('blog-preview-content'), field('content').value);
    document.getElementById('blog-preview-dialog').showModal();
  });
  var navToggle = document.querySelector('.nav-toggle');
  var navLinks = document.querySelector('nav.links');
  navToggle.addEventListener('click', function () {
    var expanded = navLinks.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(expanded));
  });
  try {
    client = blog.createClient(true);
    refreshAccess().catch(function (error) { show(errorMessage(error), 'error'); });
  } catch (error) { show(errorMessage(error), 'error'); }
}());
