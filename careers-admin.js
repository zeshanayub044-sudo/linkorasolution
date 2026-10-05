(function () {
  'use strict';
  var career = window.LinkoraCareers;
  var client;
  var account = null;
  var jobs = [];
  var applications = [];
  var resumes = [];
  var activeApplication = null;
  var activeResume = null;
  var notice = document.getElementById('career-admin-notice');
  var login = document.getElementById('career-login');
  var dashboard = document.getElementById('career-dashboard');
  var editor = document.getElementById('career-job-editor');
  var jobForm = document.getElementById('career-job-form');
  var appForm = document.getElementById('career-app-edit-form');
  var dialog = document.getElementById('career-app-dialog');
  var jobRows = document.getElementById('career-job-rows');
  var appRows = document.getElementById('career-app-rows');
  var resumeRows = document.getElementById('career-resume-rows');
  var generalDialog = document.getElementById('career-general-dialog');
  var generalForm = document.getElementById('career-general-edit-form');
  var jobFields = ['title','slug','department','location','employment_type','workplace_type','experience_level',
    'salary_min','salary_max','salary_currency','summary','description','responsibilities','requirements',
    'preferred_qualifications','benefits','status','closes_at'];

  function show(message, kind) { notice.textContent = message; notice.dataset.kind = kind || ''; }
  function field(name) { return jobForm.elements.namedItem(name); }
  function cell(value) { var td = document.createElement('td'); td.textContent = value == null ? '' : String(value); return td; }
  function action(label, callback, danger) {
    var button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.className = danger ? 'career-admin__danger' : 'career-admin__action';
    button.addEventListener('click', callback); return button;
  }
  function errorText(error) {
    if (error && error.code === '23505') return 'This job slug is already in use.';
    if (error && error.code === '42501') return 'Access denied. Co-CEO authorization required.';
    return error && error.message || 'The action could not be completed. Please try again.';
  }
  function localDatetime(value) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  function hidePrivate() {
    jobs = []; applications = []; resumes = []; account = null; activeApplication = null; activeResume = null;
    jobRows.replaceChildren(); appRows.replaceChildren(); resumeRows.replaceChildren();
    dashboard.hidden = true; editor.hidden = true;
    document.getElementById('career-signout').hidden = true;
    if (dialog.open) dialog.close();
    if (generalDialog.open) generalDialog.close();
    document.getElementById('career-resume-link').removeAttribute('href');
    document.getElementById('career-general-link').removeAttribute('href');
  }
  async function allRows(table, order) {
    var rows = [], offset = 0;
    while (true) {
      var result = await client.from(table).select('*').order(order, { ascending: false }).range(offset, offset + 199);
      if (result.error) throw result.error;
      rows.push.apply(rows, result.data || []);
      if (!result.data || result.data.length < 200) return rows;
      offset += 200;
    }
  }
  function renderJobs() {
    jobRows.replaceChildren();
    jobs.forEach(function (job) {
      var tr = document.createElement('tr');
      [job.title,job.department,job.location,job.published_at ? career.formatDate(job.published_at) : '—',
        applications.filter(function (app) { return app.job_id === job.id; }).length,job.status].forEach(function (value) { tr.appendChild(cell(value)); });
      var actions = cell('');
      actions.appendChild(action('Edit', function () { openEditor(job); }));
      if (job.status === 'open') actions.appendChild(action('Close', function () { changeJobStatus(job, 'closed'); }));
      else actions.appendChild(action('Publish', function () { changeJobStatus(job, 'open'); }));
      if (job.status === 'closed') actions.appendChild(action('Archive', function () { changeJobStatus(job, 'archived'); }));
      if (job.status === 'draft' && !applications.some(function (app) { return app.job_id === job.id; })) {
        actions.appendChild(action('Delete', function () { deleteJob(job); }, true));
      }
      tr.appendChild(actions); jobRows.appendChild(tr);
    });
    if (!jobs.length) { var tr = document.createElement('tr'); var td = cell('No jobs yet. Add a job to get started.'); td.colSpan = 7; tr.appendChild(td); jobRows.appendChild(tr); }
    document.getElementById('career-stat-open').textContent = jobs.filter(function (job) { return job.status === 'open'; }).length;
    document.getElementById('career-stat-draft').textContent = jobs.filter(function (job) { return job.status === 'draft'; }).length;
    document.getElementById('career-stat-closed').textContent = jobs.filter(function (job) { return job.status === 'closed'; }).length;
  }
  function renderApplications() {
    var term = document.getElementById('career-app-search').value.trim().toLowerCase();
    var jobId = document.getElementById('career-app-job-filter').value;
    var status = document.getElementById('career-app-status-filter').value;
    var from = document.getElementById('career-app-date-filter').value;
    appRows.replaceChildren();
    applications.filter(function (app) {
      return (!jobId || app.job_id === jobId) && (!status || app.application_status === status) &&
        (!from || app.created_at.slice(0, 10) >= from) &&
        (!term || (app.full_name + ' ' + app.email).toLowerCase().includes(term));
    }).forEach(function (app) {
      var tr = document.createElement('tr');
      [app.full_name, (jobs.find(function (job) { return job.id === app.job_id; }) || {}).title || 'Removed job',
        app.email,app.phone,app.years_experience + ' years',career.formatDate(app.created_at), app.application_status].forEach(function (value) { tr.appendChild(cell(value)); });
      var actions = cell(''); actions.appendChild(action('View', function () { openApplication(app); }));
      tr.appendChild(actions); appRows.appendChild(tr);
    });
    if (!appRows.children.length) { var empty = document.createElement('tr'); var message = cell('No applicants match these filters.'); message.colSpan = 8; empty.appendChild(message); appRows.appendChild(empty); }
    document.getElementById('career-stat-applications').textContent = applications.length;
    document.getElementById('career-stat-new').textContent = applications.filter(function (app) { return app.application_status === 'new'; }).length;
  }
  function renderResumes() {
    var term = document.getElementById('career-resume-search').value.trim().toLowerCase();
    var status = document.getElementById('career-resume-filter').value;
    resumeRows.replaceChildren();
    resumes.filter(function (resume) {
      return (!status || resume.status === status) &&
        (!term || [resume.full_name,resume.email,resume.primary_skill,resume.current_role || ''].join(' ').toLowerCase().includes(term));
    }).forEach(function (resume) {
      var tr = document.createElement('tr');
      [resume.full_name,resume.email,resume.phone,resume.primary_skill,resume.current_role || '—',
        resume.years_experience == null ? '—' : resume.years_experience + ' years',career.formatDate(resume.created_at),resume.status]
        .forEach(function (value) { tr.appendChild(cell(value)); });
      var actions = cell(''); actions.appendChild(action('View', function () { openResume(resume); }));
      tr.appendChild(actions); resumeRows.appendChild(tr);
    });
    if (!resumeRows.children.length) { var empty = document.createElement('tr'); var message = cell('No resumes match these filters.'); message.colSpan = 9; empty.appendChild(message); resumeRows.appendChild(empty); }
    document.getElementById('career-stat-resumes').textContent = resumes.length;
    document.getElementById('career-stat-resumes-new').textContent = resumes.filter(function (resume) { return resume.status === 'new'; }).length;
    [['shortlisted','career-stat-shortlisted'],['interview','career-stat-interview'],['hired','career-stat-hired']].forEach(function (pair) {
      document.getElementById(pair[1]).textContent = applications.filter(function (app) { return app.application_status === pair[0]; }).length +
        resumes.filter(function (resume) { return resume.status === pair[0]; }).length;
    });
  }
  async function refresh() {
    if (!account) return;
    try {
      show('Loading jobs and candidates…');
      var results = await Promise.all([allRows('career_jobs', 'updated_at'), allRows('career_applications', 'created_at'), allRows('career_resume_submissions', 'created_at')]);
      if (!account) return;
      jobs = results[0]; applications = results[1]; resumes = results[2];
      var filter = document.getElementById('career-app-job-filter'); var current = filter.value;
      var first = career.node('option', '', 'All jobs'); first.value = ''; filter.replaceChildren(first);
      jobs.forEach(function (job) { var item = career.node('option', '', job.title); item.value = job.id; filter.appendChild(item); });
      filter.value = current;
      renderJobs(); renderApplications(); renderResumes(); show('Dashboard is up to date.', 'success');
    } catch (error) { show(errorText(error), 'error'); }
  }
  async function checkAccess() {
    try {
      var result = await client.auth.getUser();
      if (result.error || !result.data.user) { hidePrivate(); login.hidden = false; show('Sign in to manage careers.'); return; }
      var role = await client.rpc('career_current_role');
      if (role.error) throw role.error;
      if (role.data !== 'careers_admin') {
        hidePrivate(); login.hidden = false; show('Access denied. Co-CEO authorization required.', 'error'); return;
      }
      account = result.data.user; login.hidden = true; dashboard.hidden = false;
      document.getElementById('career-signout').hidden = false;
      await refresh();
    } catch (error) { hidePrivate(); login.hidden = false; show(errorText(error), 'error'); }
  }
  function openEditor(job) {
    jobForm.reset(); field('id').value = job ? job.id : '';
    jobFields.forEach(function (key) {
      if (job) field(key).value = key === 'closes_at' ? localDatetime(job.closes_at) : job[key] == null ? '' : job[key];
    });
    document.getElementById('career-editor-heading').textContent = job ? 'Edit job' : 'New job';
    field('slug').dataset.generated = job ? 'no' : 'yes';
    editor.hidden = false; editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function payload() {
    var data = {};
    jobFields.forEach(function (key) { data[key] = field(key).value.trim(); });
    ['salary_min','salary_max'].forEach(function (key) { data[key] = data[key] === '' ? null : Number(data[key]); });
    data.salary_currency = data.salary_currency || null;
    data.closes_at = data.closes_at ? new Date(data.closes_at).toISOString() : null;
    return data;
  }
  async function changeJobStatus(job, status) {
    if (!confirm(status === 'closed' ? 'Close this job to new applications?' : status === 'archived' ? 'Archive this closed job?' : 'Publish this job publicly?')) return;
    var result = await client.from('career_jobs').update({ status: status }).eq('id', job.id).select('id');
    if (result.error) { show(errorText(result.error), 'error'); return; }
    if (!result.data.length) { show('Job update was not permitted.', 'error'); return; }
    await refresh(); show('Job ' + (status === 'open' ? 'published.' : status === 'archived' ? 'archived.' : 'closed.'), 'success');
  }
  async function deleteJob(job) {
    if (!confirm('Permanently delete this draft job? This cannot be undone.')) return;
    var result = await client.from('career_jobs').delete().eq('id', job.id).select('id');
    if (result.error) { show(errorText(result.error), 'error'); return; }
    if (!result.data.length) { show('This job cannot be deleted. Close or archive it instead.', 'error'); return; }
    await refresh(); show('Draft job deleted.', 'success');
  }
  function detail(label, value) {
    var list = document.getElementById('career-app-details');
    list.appendChild(career.node('dt', '', label));
    var dd = career.node('dd');
    if (typeof value === 'string' && /^https:\/\//i.test(value)) {
      try { var url = new URL(value); var link = career.node('a', '', value); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; dd.appendChild(link); }
      catch (_) { dd.textContent = value; }
    } else dd.textContent = value == null || value === '' ? '—' : String(value);
    list.appendChild(dd);
  }
  async function openApplication(app) {
    activeApplication = app;
    document.getElementById('career-app-title').textContent = app.full_name;
    document.getElementById('career-app-details').replaceChildren();
    var job = jobs.find(function (item) { return item.id === app.job_id; });
    [['Job', job ? job.title : 'Unavailable'],['Email',app.email],['Phone',app.phone],['City',app.city],['Country',app.country],
      ['LinkedIn',app.linkedin_url],['Portfolio',app.portfolio_url],['Experience',app.years_experience + ' years'],
      ['Current role',app.current_role],['Current company',app.current_company],['Expected salary',app.expected_salary],
      ['Notice period',app.notice_period],['Applied',new Date(app.created_at).toLocaleString()],['Consent recorded',new Date(app.consented_at).toLocaleString()]]
      .forEach(function (pair) { detail(pair[0], pair[1]); });
    career.renderText(document.getElementById('career-app-letter'), app.cover_letter);
    appForm.elements.namedItem('application_status').value = app.application_status;
    appForm.elements.namedItem('admin_notes').value = app.admin_notes || '';
    var resume = document.getElementById('career-resume-link'); resume.hidden = true; resume.removeAttribute('href');
    document.getElementById('career-resume-status').textContent = 'Creating a private CV link…';
    dialog.showModal();
    var signed = await client.storage.from('career-resumes').createSignedUrl(app.resume_path, 60);
    if (activeApplication !== app || !dialog.open) return;
    if (signed.error || !signed.data || !signed.data.signedUrl) {
      document.getElementById('career-resume-status').textContent = 'The CV could not be opened. Please try closing and reopening this application.';
    } else {
      resume.href = signed.data.signedUrl; resume.hidden = false;
      document.getElementById('career-resume-status').textContent = 'Private link expires in 60 seconds.';
    }
  }
  async function openResume(resume) {
    activeResume = resume;
    document.getElementById('career-general-title').textContent = resume.full_name;
    var list = document.getElementById('career-general-details'); list.replaceChildren();
    [['Email',resume.email],['Phone',resume.phone],['Primary skill',resume.primary_skill],
      ['City',resume.city],['Country',resume.country],['Current role',resume.current_role],
      ['Experience',resume.years_experience == null ? null : resume.years_experience + ' years'],
      ['LinkedIn',resume.linkedin_url],['Portfolio',resume.portfolio_url],
      ['Received',new Date(resume.created_at).toLocaleString()],
      ['Consent recorded',new Date(resume.consented_at).toLocaleString()]]
      .forEach(function (pair) {
        list.appendChild(career.node('dt', '', pair[0]));
        var dd = career.node('dd');
        if (typeof pair[1] === 'string' && /^https:\/\//i.test(pair[1])) {
          var link = career.node('a', '', pair[1]); link.href = pair[1]; link.target = '_blank'; link.rel = 'noopener noreferrer'; dd.appendChild(link);
        } else dd.textContent = pair[1] == null || pair[1] === '' ? '—' : String(pair[1]);
        list.appendChild(dd);
      });
    document.getElementById('career-general-note').textContent = resume.message || 'No note provided.';
    generalForm.elements.namedItem('status').value = resume.status;
    generalForm.elements.namedItem('admin_notes').value = resume.admin_notes || '';
    document.getElementById('career-general-review-message').textContent = '';
    var link = document.getElementById('career-general-link'); link.hidden = true; link.removeAttribute('href');
    document.getElementById('career-general-link-status').textContent = 'Creating a private resume link…';
    generalDialog.showModal();
    var signed = await client.storage.from('career-resumes').createSignedUrl(resume.resume_path, 60);
    if (activeResume !== resume || !generalDialog.open) return;
    if (signed.error || !signed.data || !signed.data.signedUrl) {
      document.getElementById('career-general-link-status').textContent = 'The resume could not be opened. Please close and reopen this candidate.';
    } else {
      link.href = signed.data.signedUrl; link.hidden = false;
      document.getElementById('career-general-link-status').textContent = 'Private link expires in 60 seconds.';
    }
  }
  document.getElementById('career-close-general').addEventListener('click', function () { generalDialog.close(); });
  generalDialog.addEventListener('close', function () {
    activeResume = null; var link = document.getElementById('career-general-link'); link.hidden = true; link.removeAttribute('href');
  });
  generalForm.addEventListener('submit', async function (event) {
    event.preventDefault(); if (!activeResume) return;
    var button = generalForm.querySelector('button[type=submit]'); button.disabled = true;
    try {
      var result = await client.from('career_resume_submissions').update({
        status: generalForm.elements.namedItem('status').value,
        admin_notes: generalForm.elements.namedItem('admin_notes').value.trim()
      }).eq('id', activeResume.id).select('id');
      if (result.error) throw result.error;
      if (!result.data.length) throw new Error('Resume update was not permitted.');
      generalDialog.close(); await refresh(); show('Resume review saved.', 'success');
    } catch (error) {
      var feedback = document.getElementById('career-general-review-message');
      feedback.textContent = errorText(error); feedback.dataset.kind = 'error';
      show(errorText(error), 'error');
    } finally { button.disabled = false; }
  });
  document.getElementById('career-close-dialog').addEventListener('click', function () { dialog.close(); });
  dialog.addEventListener('close', function () { activeApplication = null; var link = document.getElementById('career-resume-link'); link.hidden = true; link.removeAttribute('href'); });
  document.getElementById('career-login-form').addEventListener('submit', async function (event) {
    event.preventDefault(); var form = event.currentTarget;
    show('Signing in…');
    var result = await client.auth.signInWithPassword({ email: form.elements.namedItem('email').value.trim(), password: form.elements.namedItem('password').value });
    form.elements.namedItem('password').value = '';
    if (result.error) { show(errorText(result.error), 'error'); return; }
    await checkAccess();
  });
  document.getElementById('career-signout').addEventListener('click', async function () {
    hidePrivate(); await client.auth.signOut(); login.hidden = false; show('Signed out.');
  });
  document.getElementById('career-new-job').addEventListener('click', function () { openEditor(null); });
  document.getElementById('career-cancel-job').addEventListener('click', function () { editor.hidden = true; });
  field('title').addEventListener('input', function () { if (field('slug').dataset.generated === 'yes') field('slug').value = career.slugify(field('title').value); });
  field('slug').addEventListener('input', function () { field('slug').dataset.generated = 'no'; });
  jobForm.addEventListener('submit', async function (event) {
    event.preventDefault(); if (!jobForm.reportValidity()) return;
    var button = document.getElementById('career-save-job'); button.disabled = true;
    try {
      var data = payload();
      if ((data.salary_min !== null || data.salary_max !== null) && !data.salary_currency) throw new Error('Enter a currency when adding salary.');
      var id = field('id').value;
      var query = id ? client.from('career_jobs').update(data).eq('id', id) : client.from('career_jobs').insert(data);
      var result = await query.select('id');
      if (result.error) throw result.error;
      if (!result.data.length) throw new Error('Job save was not permitted.');
      editor.hidden = true; await refresh(); show('Job saved.', 'success');
    } catch (error) { show(errorText(error), 'error'); } finally { button.disabled = false; }
  });
  appForm.addEventListener('submit', async function (event) {
    event.preventDefault(); if (!activeApplication) return;
    var button = appForm.querySelector('button[type=submit]'); button.disabled = true;
    try {
      var result = await client.from('career_applications').update({
        application_status: appForm.elements.namedItem('application_status').value,
        admin_notes: appForm.elements.namedItem('admin_notes').value.trim()
      }).eq('id', activeApplication.id).select('id');
      if (result.error) throw result.error;
      if (!result.data.length) throw new Error('Application update was not permitted.');
      dialog.close(); await refresh(); show('Application review saved.', 'success');
    } catch (error) { show(errorText(error), 'error'); } finally { button.disabled = false; }
  });
  ['career-app-search','career-app-job-filter','career-app-status-filter','career-app-date-filter'].forEach(function (id) {
    var input = document.getElementById(id); input.addEventListener(id === 'career-app-search' ? 'input' : 'change', renderApplications);
  });
  document.getElementById('career-resume-search').addEventListener('input', renderResumes);
  document.getElementById('career-resume-filter').addEventListener('change', renderResumes);
  document.getElementById('career-resume-refresh').addEventListener('click', refresh);
  document.getElementById('career-refresh').addEventListener('click', refresh);
  var toggle = document.querySelector('.nav-toggle'), links = document.querySelector('nav.links');
  toggle.addEventListener('click', function () { links.classList.toggle('open'); toggle.setAttribute('aria-expanded', String(links.classList.contains('open'))); });
  document.querySelector('.year').textContent = new Date().getFullYear();
  try {
    client = career.createClient(true);
    client.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') { hidePrivate(); login.hidden = false; show('Signed out.'); }
    });
    checkAccess();
  } catch (error) { show(errorText(error), 'error'); }
}());
