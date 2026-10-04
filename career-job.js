(function () {
  'use strict';
  var career = window.LinkoraCareers;
  var detail = document.getElementById('career-job-detail');
  var applyPanel = document.getElementById('career-apply-panel');
  var form = document.getElementById('career-application-form');
  var formMessage = document.getElementById('career-form-message');
  var submitButton = document.getElementById('career-submit');
  var slug = new URLSearchParams(location.search).get('slug');
  var submitting = false;

  function meta(name, content, property) {
    var selector = 'meta[' + (property ? 'property' : 'name') + '="' + name + '"]';
    var item = document.querySelector(selector) || career.node('meta');
    item.setAttribute(property ? 'property' : 'name', name);
    item.content = content;
    if (!item.parentNode) document.head.appendChild(item);
  }
  function notFound(message) {
    document.title = 'Job unavailable | LINKORA SOLUTIONS';
    document.getElementById('career-job-status').textContent = message;
    applyPanel.hidden = true;
  }
  function seo(job) {
    var title = job.title + ' | Careers at LINKORA SOLUTIONS';
    var url = location.origin + '/career-job.html?slug=' + encodeURIComponent(job.slug);
    document.title = title;
    meta('description', job.summary);
    meta('robots', 'index,follow');
    meta('og:title', title, true); meta('og:description', job.summary, true);
    meta('og:url', url, true); meta('og:image', location.origin + '/assets/linkora-logo.png', true);
    meta('twitter:title', title); meta('twitter:description', job.summary);
    meta('twitter:image', location.origin + '/assets/linkora-logo.png');
    var canonical = document.querySelector('link[rel=canonical]') || career.node('link');
    canonical.rel = 'canonical'; canonical.href = url;
    if (!canonical.parentNode) document.head.appendChild(canonical);
    var structured = {
      '@context': 'https://schema.org', '@type': 'JobPosting', title: job.title,
      description: [job.description, job.responsibilities, job.requirements].filter(Boolean).join('\n\n'),
      datePosted: job.published_at, validThrough: job.closes_at || undefined,
      employmentType: { full_time: 'FULL_TIME', part_time: 'PART_TIME', internship: 'INTERN', contract: 'CONTRACTOR' }[job.employment_type],
      hiringOrganization: { '@type': 'Organization', name: 'LINKORA SOLUTIONS', sameAs: 'https://linkorasolution.com', logo: 'https://linkorasolution.com/assets/linkora-logo.png' },
      url: url
    };
    if (job.workplace_type === 'remote') structured.jobLocationType = 'TELECOMMUTE';
    else structured.jobLocation = { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: job.location } };
    var json = career.node('script'); json.type = 'application/ld+json';
    json.textContent = JSON.stringify(structured).replace(/</g, '\\u003c');
    document.head.appendChild(json);
  }
  function section(title, body) {
    if (!body) return null;
    var wrapper = career.node('section', 'career-detail__section');
    wrapper.appendChild(career.node('h2', '', title));
    var content = career.node('div', 'career-detail__text');
    career.renderText(content, body);
    wrapper.appendChild(content);
    return wrapper;
  }
  function render(job) {
    seo(job);
    document.getElementById('career-job-status').remove();
    detail.appendChild(career.node('span', 'career-pill', job.department));
    detail.appendChild(career.node('h1', '', job.title));
    detail.appendChild(career.node('p', 'career-detail__summary', job.summary));
    var facts = career.node('div', 'career-detail__facts');
    [job.location, career.employment(job.employment_type), career.workplace(job.workplace_type), job.experience_level,
      career.salary(job)].filter(Boolean).forEach(function (value) { facts.appendChild(career.node('span', '', value)); });
    detail.appendChild(facts);
    var dates = 'Posted ' + career.formatDate(job.published_at);
    if (job.closes_at) dates += ' · Apply by ' + career.formatDate(job.closes_at);
    detail.appendChild(career.node('p', 'career-detail__dates', dates));
    var apply = career.node('a', 'btn btn-whatsapp career-detail__apply', 'Apply for this role');
    apply.href = '#career-apply-panel'; detail.appendChild(apply);
    [['The role', job.description], ['Responsibilities', job.responsibilities], ['Requirements', job.requirements],
      ['Preferred qualifications', job.preferred_qualifications], ['Benefits', job.benefits]].forEach(function (pair) {
      var block = section(pair[0], pair[1]); if (block) detail.appendChild(block);
    });
    form.elements.namedItem('job_id').value = job.id;
    applyPanel.hidden = false;
  }
  async function load() {
    if (!career.validSlug(slug)) { notFound('This job could not be found.'); return; }
    try {
      var client = career.createClient(false);
      var result = await client.from('career_jobs').select('id,title,slug,department,location,employment_type,workplace_type,experience_level,salary_min,salary_max,salary_currency,summary,description,responsibilities,requirements,preferred_qualifications,benefits,status,published_at,closes_at')
        .eq('slug', slug).eq('status', 'open').maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) { notFound('This job is unavailable or no longer open.'); return; }
      render(result.data);
    } catch (error) {
      notFound('This job could not be loaded. Please try again later.');
      console.error('Career job unavailable', error);
    }
  }
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (submitting || !form.reportValidity()) return;
    var file = form.elements.namedItem('resume').files[0];
    var allowed = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!file || !allowed.includes(file.type) || file.size > 8 * 1024 * 1024) {
      formMessage.textContent = 'Attach a PDF, DOC or DOCX CV under 8 MB.';
      formMessage.dataset.kind = 'error'; return;
    }
    submitting = true; submitButton.disabled = true;
    formMessage.textContent = 'Submitting your application…'; formMessage.dataset.kind = '';
    try {
      var response = await fetch(career.config.url + '/functions/v1/career-apply', {
        method: 'POST', headers: { apikey: career.config.publishableKey }, body: new FormData(form)
      });
      var result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'The application could not be submitted.');
      form.reset(); form.hidden = true;
      var success = career.node('p', 'career-form-message', result.message || 'Application received. Thank you for applying.');
      success.dataset.kind = 'success'; applyPanel.appendChild(success);
    } catch (error) {
      formMessage.textContent = error.message || 'A network error occurred. Please try again.';
      formMessage.dataset.kind = 'error';
    } finally { submitting = false; submitButton.disabled = false; }
  });
  load();
}());
