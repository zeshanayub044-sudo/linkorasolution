import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const origin = 'https://linkorasolution.com';
export const privatePages = ['attendance.html', 'attendance-admin.html', 'tennis-portal.html', 'blog-admin.html', 'careers-admin.html'];
export function decode(value = '') {
  return value.replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : +n))
    .replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}
function attrs(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(m => [m[1].toLowerCase(), decode(m[2] ?? m[3] ?? m[4])]));
}
const text = html => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
export function robotsAllows(robots, path, agent = 'googlebot') {
  const groups = []; let agents = [], rules = [];
  const finish = () => { if (agents.length) groups.push({ agents, rules }); agents = []; rules = []; };
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const m = /^([a-z-]+):\s*(.*)$/i.exec(line); if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === 'user-agent') { if (rules.length) finish(); agents.push(value.toLowerCase()); }
    else if ((key === 'allow' || key === 'disallow') && agents.length && value) rules.push({ allow:key === 'allow', pattern:value });
  }
  finish();
  const specific = groups.filter(g => g.agents.includes(agent.toLowerCase()));
  const selected = specific.length ? specific : groups.filter(g => g.agents.includes('*'));
  let best = -1, allowed = true;
  for (const rule of selected.flatMap(g => g.rules)) {
    const end = rule.pattern.endsWith('$'), pattern = end ? rule.pattern.slice(0, -1) : rule.pattern;
    const regex = '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*') + (end ? '$' : '');
    const length = pattern.replaceAll('*', '').length;
    if (new RegExp(regex).test(path) && (length > best || (length === best && rule.allow))) { best = length; allowed = rule.allow; }
  }
  return allowed;
}
export function inspectHtml(html, url, status = 200) {
  const clean = html.replace(/<!--[\s\S]*?-->/g, ''), head = clean.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map(m => attrs(m[0]));
  const meta = name => metas.filter(m => (m.name || m.property || '').toLowerCase() === name).map(m => m.content || '');
  const canonicals = [...head.matchAll(/<link\b[^>]*>/gi)].map(m => attrs(m[0])).filter(a => /(?:^|\s)canonical(?:\s|$)/i.test(a.rel || '')).map(a => a.href);
  const main = (clean.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const headings = [...main.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map(m => ({ level: +m[1], text: text(m[2]) }));
  const schema = [], schemaErrors = [];
  for (const m of head.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (attrs(m[1]).type?.toLowerCase() !== 'application/ld+json') continue;
    try { schema.push(JSON.parse(m[2])); } catch { schemaErrors.push('Invalid JSON-LD'); }
  }
  return { url, status, title: text(head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''), descriptions: meta('description'),
    canonicals, robots: [...meta('robots'), ...meta('googlebot')].join(','), headings, schema, schemaErrors,
    openGraph: Object.fromEntries(['og:title', 'og:description', 'og:url', 'og:image'].map(k => [k, meta(k)])),
    links: [...main.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(m => ({ href: attrs(m[1]).href, text: text(m[2]) })),
    images: [...clean.matchAll(/<img\b[^>]*>/gi)].map(m => attrs(m[0])), words: text(main.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')).split(/\s+/).filter(Boolean).length };
}
export function validatePages(pages) {
  const errors = [], seenTitles = new Map(), seenDescriptions = new Map();
  for (const p of pages) {
    const fail = message => errors.push(p.url + ': ' + message), path = new URL(p.url).pathname;
    if (privatePages.some(f => path === '/' + f) || ['/blog-post.html', '/career-job.html'].includes(path)) fail('Private/generic route in public sitemap');
    if (p.status !== 200) fail('HTTP ' + p.status);
    if (!p.title) fail('Missing title');
    if (p.descriptions.length !== 1 || !p.descriptions[0]?.trim()) fail('Expected one nonempty description');
    if (p.canonicals.length !== 1 || p.canonicals[0] !== p.url) fail('Expected exact self-canonical');
    if (/(?:^|[\s,])(?:noindex|none)(?:$|[\s,])/i.test(p.robots) || /(?:^|[\s,])(?:noindex|none)(?:$|[\s,])/i.test(p.xRobots || '')) fail('Public indexing blocked');
    if (p.headings.filter(h => h.level === 1).length !== 1) fail('Expected one initial H1');
    for (let i = 1; i < p.headings.length; i++) if (p.headings[i].level > p.headings[i - 1].level + 1) fail('Skipped heading level: ' + p.headings[i].text);
    for (const [field, values] of Object.entries(p.openGraph)) if (values.length !== 1 || !values[0].trim()) fail('Missing/duplicate ' + field);
    if (p.openGraph['og:url'][0] !== p.url) fail('Open Graph URL differs from canonical');
    for (const message of p.schemaErrors) fail(message);
    for (const image of p.images) if (!Object.hasOwn(image, 'alt')) fail('Image missing alt: ' + image.src);
    for (const [value, seen, label] of [[p.title, seenTitles, 'title'], [p.descriptions[0], seenDescriptions, 'description']]) {
      if (value && seen.has(value)) fail('Duplicate ' + label + ' with ' + seen.get(value));
      if (value) seen.set(value, p.url);
    }
  }
  return errors;
}
export async function audit({ site = '_site', live = false } = {}) {
  const get = async path => {
    if (!live) return { html: readFileSync(resolve(site, '.' + (path === '/' ? '/index.html' : path)), 'utf8'), status: 200, headers: {} };
    const r = await fetch(origin + path, { signal: AbortSignal.timeout(20000) });
    return { html: await r.text(), status: r.status, finalUrl: r.url, headers: Object.fromEntries(['content-type','x-robots-tag','cache-control','server'].map(k => [k, r.headers.get(k)])) };
  };
  const sitemap = await get('/sitemap.xml'), urls = [...sitemap.html.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => decode(m[1]));
  if (sitemap.status !== 200 || !urls.length) throw Error('Sitemap unavailable or empty');
  if (urls.some(u => new URL(u).origin !== origin)) throw Error('Unexpected sitemap host');
  const pages = await Promise.all(urls.map(async url => {
    const r = await get(new URL(url).pathname); return { ...inspectHtml(r.html, url, r.status), headers: r.headers, finalUrl: r.finalUrl, xRobots: r.headers['x-robots-tag'] || '' };
  }));
  const exclusions = await Promise.all(readdirSync('.').filter(f => f.endsWith('.html') && !urls.includes(origin + '/' + f) && f !== 'index.html').map(async file => {
    const r = await get('/' + file), p = inspectHtml(r.html, origin + '/' + file, r.status);
    return { file, status: r.status, classification: 'NON-INDEXABLE', robots: p.robots };
  }));
  const errors = validatePages(pages);
  if (new Set(urls).size !== urls.length) errors.push('Duplicate sitemap URL');
  for (const p of exclusions) if (!/noindex|none/i.test(p.robots)) errors.push(p.file + ': excluded application/template missing noindex');
  const robots = await get('/robots.txt');
  if (robots.status !== 200) errors.push('robots.txt unavailable');
  for (const url of urls) if (!robotsAllows(robots.html, new URL(url).pathname)) errors.push(url + ': robots.txt blocks Googlebot');
  return { date: new Date().toISOString(), live, pages, exclusions, robots: robots.html, errors };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await audit({ live: process.argv.includes('--live') });
  const output = process.argv.indexOf('--output');
  if (output >= 0) { const file = resolve(process.argv[output + 1]); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(report, null, 2) + '\n'); }
  console.log(report.pages.length + ' canonical public pages and ' + report.exclusions.length + ' exclusions audited.');
  if (report.errors.length) { console.error(report.errors.join('\n')); process.exitCode = 1; }
}
