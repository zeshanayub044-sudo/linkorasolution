(function () {
  'use strict';
  var career = window.LinkoraCareers;
  var grid = document.getElementById('career-jobs');
  var status = document.getElementById('career-list-status');
  var search = document.getElementById('career-search');
  var department = document.getElementById('career-department');
  var jobs = [];

  function card(job) {
    var article = career.node('article', 'career-card');
    var top = career.node('div', 'career-card__top');
    top.appendChild(career.node('span', 'career-pill', job.department));
    top.appendChild(career.node('span', 'career-card__date', 'Posted ' + career.formatDate(job.published_at)));
    article.appendChild(top);
    var title = career.node('h2');
    var titleLink = career.node('a', '', job.title);
    titleLink.href = career.jobUrl(job.slug);
    title.appendChild(titleLink); article.appendChild(title);
    article.appendChild(career.node('p', 'career-card__summary', job.summary));
    var info = career.node('div', 'career-card__facts');
    [job.location, career.employment(job.employment_type), career.workplace(job.workplace_type), job.experience_level]
      .forEach(function (value) { info.appendChild(career.node('span', '', value)); });
    article.appendChild(info);
    var more = career.node('a', 'btn btn-ghost', 'View details & apply →');
    more.href = career.jobUrl(job.slug);
    article.appendChild(more);
    return article;
  }
  function render() {
    var term = search.value.trim().toLowerCase();
    var selected = department.value;
    var filtered = jobs.filter(function (job) {
      return (!selected || job.department === selected) &&
        (!term || [job.title, job.department, job.location, job.summary].join(' ').toLowerCase().includes(term));
    });
    grid.replaceChildren();
    if (!filtered.length) {
      grid.appendChild(career.node('div', 'career-empty', jobs.length ? 'No roles match your search.' : 'There are no open roles right now. Please check back soon.'));
    } else {
      var fragment = document.createDocumentFragment();
      filtered.forEach(function (job) { fragment.appendChild(card(job)); });
      grid.appendChild(fragment);
    }
    status.textContent = filtered.length + ' open role' + (filtered.length === 1 ? '' : 's') + (term || selected ? ' found' : '');
  }
  async function load() {
    status.textContent = 'Loading open roles…';
    grid.replaceChildren();
    try {
      var client = career.createClient(false);
      var all = [];
      var offset = 0;
      while (true) {
        var result = await client.from('career_jobs')
          .select('id,title,slug,department,location,employment_type,workplace_type,experience_level,summary,published_at')
          .eq('status', 'open').order('published_at', { ascending: false }).range(offset, offset + 199);
        if (result.error) throw result.error;
        all.push.apply(all, result.data || []);
        if (!result.data || result.data.length < 200) break;
        offset += 200;
      }
      jobs = all;
      var first = career.node('option', '', 'All departments'); first.value = '';
      department.replaceChildren(first);
      Array.from(new Set(jobs.map(function (job) { return job.department; }))).sort().forEach(function (value) {
        var option = career.node('option', '', value); option.value = value; department.appendChild(option);
      });
      render();
    } catch (error) {
      status.textContent = 'Open roles could not be loaded.';
      var empty = career.node('div', 'career-empty', 'Please check your connection and try again.');
      var retry = career.node('button', 'btn btn-ghost', 'Try again'); retry.type = 'button'; retry.addEventListener('click', load);
      empty.appendChild(retry); grid.appendChild(empty);
      console.error('Careers listing unavailable', error);
    }
  }
  search.addEventListener('input', render);
  department.addEventListener('change', render);
  load();
}());
