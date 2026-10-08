import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export function secretRules(source) {
  const failures = [];
  const patterns = [
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
    ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{20,}\b/],
    ['credential-bearing database URL', /postgres(?:ql)?:\/\/[^\s:'"]+:[^\s@'"]+@/i],
    ['literal secret', /(?:password|service[_-]?role[_-]?key|webhook[_-]?secret|database[_-]?password)\s*[:=]\s*["'](?!\s*$)([^"'\r\n]{8,})["']/gi],
  ];
  for (const [label, pattern] of patterns) {
    const matches = source.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'));
    for (const match of matches) {
      if (label === 'literal secret' && /^(?:your[ _-]|replace|example|placeholder|test[ _-]|<|\$\{|SUPABASE_|GOOGLE_)/i.test(match[1])) continue;
      failures.push(label); break;
    }
  }
  for (const token of source.match(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g) || []) {
    try {
      if (JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).role === 'service_role') failures.push('service-role JWT');
    } catch { /* Non-JWT text is not a credential. */ }
  }
  return [...new Set(failures)];
}

export function hasConflict(source) {
  return /^(?:<{7}(?: |$)|={7}\s*$|>{7}(?: |$))/m.test(source);
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  process.chdir(root);
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const files = git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
  const failures = [];
  const fail = (file, reason) => failures.push(file + ': ' + reason);
  const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, { stdio: 'inherit', ...options });
    if (result.error || result.status !== 0) throw new Error(command + ' check failed');
  };
  for (const file of [...new Set(files)]) {
    if (!existsSync(file)) continue;
    if (/(^|\/)(?:\.env(?:\..+)?|id_rsa|id_ed25519)$/.test(file) && !file.endsWith('.example')) fail(file, 'credential file cannot be committed');
    const bytes = readFileSync(file);
    if (bytes.includes(0)) continue;
    const source = bytes.toString('utf8');
    if (hasConflict(source)) fail(file, 'unresolved conflict marker');
    for (const rule of secretRules(source)) fail(file, rule); // Never print matching values.
    if (/\.(?:js|mjs|cjs|gs)$/.test(file)) {
      const result = spawnSync(process.execPath, file.endsWith('.gs') ? ['--check'] : ['--check', file], { input: file.endsWith('.gs') ? source : undefined, encoding: 'utf8' });
      if (result.status !== 0) fail(file, 'JavaScript syntax: ' + result.stderr.trim());
    }
    if (file.endsWith('.html')) {
      for (const match of source.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
        const url = match[1];
        if (/^(?:[a-z]+:|\/\/|#)/i.test(url)) continue;
        const [path, fragment] = url.split('#');
        const target = resolve(dirname(resolve(file)), decodeURIComponent(path.split('?')[0]));
        if (!target.startsWith(root + '/') && !target.startsWith(root + '\\') && target !== root) { fail(file, 'link escapes repository'); continue; }
        if (!existsSync(target)) { fail(file, 'missing local reference ' + url); continue; }
        if (fragment && /\.html$/.test(target)) {
          const html = readFileSync(target, 'utf8');
          const escaped = decodeURIComponent(fragment).replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&');
          if (!new RegExp('(?:id|name)\\s*=\\s*["\\\']' + escaped + '["\\\']').test(html)) fail(file, 'missing anchor ' + url);
        }
      }
    }
  }
  const versions = new Set();
  for (const file of files.filter(f => /^supabase\/migrations\/.*\.sql$/.test(f))) {
    const version = file.match(/\/(\d{14})_[^/]+\.sql$/)?.[1];
    if (!version || versions.has(version)) fail(file, 'invalid or duplicate migration version');
    versions.add(version);
  }
  if (failures.length) throw new Error(failures.join('\n'));
  run('git', ['-c', 'core.whitespace=cr-at-eol', 'diff', '--check']);
  run('git', ['-c', 'core.whitespace=cr-at-eol', 'diff', '--cached', '--check']);
  const baseIndex = process.argv.indexOf('--base');
  if (baseIndex >= 0) {
    const base = process.argv[baseIndex + 1];
    if (!base || !/^[a-zA-Z0-9_./-]+$/.test(base)) throw new Error('Invalid base ref');
    run('git', ['-c', 'core.whitespace=cr-at-eol', 'diff', '--check', base + '...HEAD']);
  }
  run(process.execPath, ['--test', 'tests/intro.test.mjs', 'tests/validation.test.mjs']);
  run(process.execPath, ['tests/google-apps-script.test.cjs']);
  run(process.execPath, ['tests/attendance-matrix.test.cjs']);
  console.log('Repository validation passed: syntax, links, conflicts, migration versions, credential patterns and existing tests.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
