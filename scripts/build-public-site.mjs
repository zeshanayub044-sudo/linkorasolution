import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  cpSync,
  existsSync,
  rmSync,
  lstatSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
export const origin = "https://linkorasolution.com";
export const escape = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
export function canonicalUrl(value, fallback) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password)
      return url.href;
  } catch {}
  return fallback;
}
export function inline(text) {
  let out = "",
    cursor = 0;
  const pattern = /\[([^\]\n]+)\]\(((?:[^\s()]|\([^\s()]*\))+)\)/g;
  for (const match of text.matchAll(pattern)) {
    out += escape(text.slice(cursor, match.index));
    let link;
    try {
      const url = new URL(match[2], origin + "/");
      if (/^https?:$/.test(url.protocol) && !url.username && !url.password)
        link = url.href;
    } catch {}
    out += link
      ? '<a href="' +
        escape(link) +
        '" target="_blank" rel="noopener noreferrer">' +
        escape(match[1]) +
        "</a>"
      : escape(match[0]);
    cursor = match.index + match[0].length;
  }
  return out + escape(text.slice(cursor));
}
export function renderText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.trim().split("\n");
      if (!lines[0]) return "";
      const heading = lines.length === 1 && /^(#{1,3})\s+(.+)$/.exec(lines[0]);
      if (heading) {
        const level = Math.min(4, heading[1].length + 1);
        return "<h" + level + ">" + inline(heading[2]) + "</h" + level + ">";
      }
      if (lines.every((l) => /^-\s+/.test(l)))
        return (
          "<ul>" +
          lines
            .map((l) => "<li>" + inline(l.replace(/^-\s+/, "")) + "</li>")
            .join("") +
          "</ul>"
        );
      return "<p>" + inline(lines.join("\n")) + "</p>";
    })
    .join("\n");
}
export async function publicRows(configFile, table, fields, filter) {
  const config = readFileSync(configFile, "utf8"),
    url = config.match(/url:\s*'([^']+)'/)[1],
    key = config.match(/publishableKey:\s*'([^']+)'/)[1],
    rows = [];
  for (let offset = 0; ; offset += 500) {
    const response = await fetch(
      url +
        "/rest/v1/" +
        table +
        "?select=" +
        encodeURIComponent(fields) +
        "&" +
        filter +
        "&order=slug&offset=" +
        offset +
        "&limit=500",
      { headers: { apikey: key }, signal: AbortSignal.timeout(20000) },
    );
    if (!response.ok)
      throw Error(
        "Public content API failed; no deployment output written (" +
          response.status +
          ")",
      );
    const page = await response.json();
    if (!Array.isArray(page)) throw Error("Invalid content response");
    rows.push(...page);
    if (page.length < 500) break;
  }
  for (const row of rows) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug) || row.slug.length > 140)
      throw Error("Unsafe public slug");
  }
  return rows;
}
export function seo(
  html,
  { title, description, url, robots = "index,follow", schema, image },
) {
  html = html.replace(
    /<title>[^<]*<\/title>/,
    "<title>" + escape(title) + "</title>",
  );
  for (const [key, value, attr] of [
    ["description", description, "name"],
    ["robots", robots, "name"],
    ["og:title", title, "property"],
    ["og:description", description, "property"],
    ["og:url", url, "property"],
    ["og:image", image || origin + "/assets/linkora-mark.png", "property"],
    ["twitter:title", title, "name"],
    ["twitter:description", description, "name"],
    ["twitter:image", image || origin + "/assets/linkora-mark.png", "name"],
  ]) {
    const tag =
        "<meta " + attr + '="' + key + '" content="' + escape(value) + '">',
      pattern = new RegExp("<meta " + attr + '="' + key + '"[^>]*>');
    html = pattern.test(html)
      ? html.replace(pattern, tag)
      : html.replace("</head>", tag + "\n</head>");
  }
  html = html
    .replace(/<link rel="canonical"[^>]*>/g, "")
    .replace(
      "</head>",
      '<link rel="canonical" href="' + escape(url) + '">\n</head>',
    );
  if (schema)
    html = html.replace(
      "</head>",
      '<script id="public-content-schema" type="application/ld+json">' +
        JSON.stringify(schema).replaceAll("<", "\\u003c") +
        "</script>\n</head>",
    );
  return html;
}
export function blogArticle(post) {
  const author = post.blog_authors || {},
    date = new Date(post.published_at).toISOString().slice(0, 10),
    image =
      post.featured_image_url &&
      /^https:\/\/nbvylffxmjmovyfhbytu.supabase.co\/storage\/v1\/object\/public\/blog-images\//.test(
        post.featured_image_url,
      )
        ? post.featured_image_url
        : null;
  return (
    '<span class="blog-article__category">' +
    escape(post.category) +
    "</span><h1>" +
    escape(post.title) +
    '</h1><p class="blog-article__lead">' +
    escape(post.excerpt) +
    '</p><p class="blog-article__meta">Published <time datetime="' +
    escape(post.published_at) +
    '">' +
    date +
    "</time> · " +
    Number(post.reading_minutes) +
    " min read</p>" +
    (image
      ? '<img class="blog-article__image" src="' +
        escape(image) +
        '" alt="' +
        escape(post.title) +
        '" width="1280" height="720" decoding="async">'
      : "") +
    '<div class="blog-article__author"><div><strong>' +
    escape(author.display_name || "LINKORA SOLUTION editorial team") +
    "</strong>" +
    (author.title ? "<span>" + escape(author.title) + "</span>" : "") +
    '</div></div><div class="blog-article__content">' +
    renderText(post.content) +
    '</div><a class="btn btn-gold" href="contact.html" target="_blank" rel="noopener noreferrer">Discuss Your Project</a>'
  );
}
export async function build() {
  const [posts, jobs] = await Promise.all([
    publicRows(
      "blog-config.js",
      "blog_posts",
      "id,title,slug,excerpt,content,reading_minutes,featured_image_url,category,published_at,updated_at,seo_title,seo_description,canonical_url,blog_authors(display_name,title)",
      "status=eq.published",
    ),
    publicRows(
      "careers-config.js",
      "career_jobs",
      "id,title,slug,summary,description,responsibilities,requirements,preferred_qualifications,benefits,department,location,employment_type,workplace_type,experience_level,published_at,updated_at,closes_at",
      "status=eq.open",
    ),
  ]);
  const open = jobs.filter(
      (j) => !j.closes_at || new Date(j.closes_at) > new Date(),
    ),
    root = process.cwd(),
    out = resolve(root, "_site");
  if (out !== resolve(root, "_site") || lstatSync(root).isSymbolicLink())
    throw Error("Unsafe output");
  if (existsSync(out)) {
    if (lstatSync(out).isSymbolicLink())
      throw Error("Output must not be a symlink");
    rmSync(out, { recursive: true });
  }
  mkdirSync(out);
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  for (const file of new Set(files)) {
    if (!existsSync(file)) continue;
    if (
      !(
        /^[^/]+\.(html|css|js|webmanifest|ico)$/.test(file) ||
        file === "CNAME" ||
        file === "robots.txt" ||
        file.startsWith("assets/") ||
        /^content\/(company|proof|proof.schema|services)\.json$/.test(file)
      )
    )
      continue;
    const target = resolve(out, file);
    if (
      !target.startsWith(
        out + String.fromCharCode(process.platform === "win32" ? 92 : 47),
      )
    )
      throw Error("Unsafe copy path");
    mkdirSync(dirname(target), { recursive: true });
    cpSync(file, target);
  }
  const write = (file, content) => {
    mkdirSync(dirname(resolve(out, file)), { recursive: true });
    writeFileSync(resolve(out, file), content);
  };
  const blogRoutes = posts.map((p) => p.slug),
    jobRoutes = open.map((j) => j.slug);
  write(
    "public-routes.js",
    "window.LINKORA_PUBLIC_ROUTES=Object.freeze(" +
      JSON.stringify({ blog: blogRoutes, jobs: jobRoutes }) +
      ");\n",
  );
  for (const post of posts) {
    const url = canonicalUrl(
        post.canonical_url,
        origin + "/blog/" + post.slug + ".html",
      ),
      author = post.blog_authors || {},
      image =
        /^https:\/\/nbvylffxmjmovyfhbytu\.supabase\.co\/storage\/v1\/object\/public\/blog-images\//.test(
          post.featured_image_url || "",
        )
          ? post.featured_image_url
          : undefined;
    const schema = {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: post.title,
      description: post.seo_description || post.excerpt,
      datePublished: post.published_at,
      dateModified: post.updated_at,
      image,
      author: {
        "@type":
          !author.display_name || author.display_name === "LINKORA SOLUTION"
            ? "Organization"
            : "Person",
        name: author.display_name || "LINKORA SOLUTION editorial team",
      },
      publisher: {
        "@type": "Organization",
        name: "LINKORA SOLUTION",
        logo: {
          "@type": "ImageObject",
          url: origin + "/assets/linkora-mark.png",
        },
      },
      mainEntityOfPage: url,
    };
    let html = readFileSync("blog-post.html", "utf8")
      .replace("<head>", '<head>\n<base href="/">')
      .replace(
        "<body>",
        '<body data-blog-slug="' + post.slug + '" data-prerendered="true">',
      );
    html = html.replace(
      '<p id="blog-article-status" role="status">Loading article…</p>',
      blogArticle(post),
    );
    html = seo(html, {
      title: (post.seo_title || post.title) + " | LINKORA SOLUTION",
      description: post.seo_description || post.excerpt,
      url,
      schema,
      image,
    });
    write("blog/" + post.slug + ".html", html);
  }
  let listing = readFileSync("blog.html", "utf8");
  listing = listing.replace(
    '<div id="blog-grid" class="blog-grid" aria-live="polite"></div>',
    '<div id="blog-grid" class="blog-grid" aria-live="polite">' +
      (posts
        .map(
          (p) =>
            '<article class="blog-card"><div class="blog-card__body"><h2><a href="/blog/' +
            p.slug +
            '.html" target="_blank" rel="noopener noreferrer">' +
            escape(p.title) +
            '</a></h2><p class="blog-card__excerpt">' +
            escape(p.excerpt) +
            "</p></div></article>",
        )
        .join("") || '<p class="blog-empty">No published articles yet.</p>') +
      "</div>",
  );
  write("blog.html", listing);
  for (const job of open) {
    const url = origin + "/jobs/" + job.slug + ".html";
    let html = readFileSync("career-job.html", "utf8")
      .replace("<head>", '<head>\n<base href="/">')
      .replace(
        "<body>",
        '<body data-job-slug="' + job.slug + '" data-prerendered="true">',
      );
    const content =
      "<h1>" +
      escape(job.title) +
      '</h1><p class="career-detail__summary">' +
      escape(job.summary) +
      "</p><p>" +
      escape(job.location) +
      " · " +
      escape(job.department) +
      "</p>" +
      [
        ["The role", job.description],
        ["Responsibilities", job.responsibilities],
        ["Requirements", job.requirements],
        ["Preferred qualifications", job.preferred_qualifications],
        ["Benefits", job.benefits],
      ]
        .filter((x) => x[1])
        .map(
          ([title, body]) =>
            '<section class="career-detail__section"><h2>' +
            title +
            '</h2><div class="career-detail__text">' +
            renderText(body) +
            "</div></section>",
        )
        .join("") +
      '<a href="/jobs/' + job.slug + '.html#career-apply-panel" class="btn btn-whatsapp">Apply for this role</a>';
    html = html.replace(
      '<p id="career-job-status" role="status">Loading job…</p>',
      content,
    );
    html = seo(html, {
      title: job.title + " | Careers at LINKORA SOLUTION",
      description: job.summary,
      url,
    });
    write("jobs/" + job.slug + ".html", html);
  }
  let careerListing = readFileSync("careers.html", "utf8").replace(
    '<div id="career-jobs" class="career-grid" aria-live="polite"></div>',
    '<div id="career-jobs" class="career-grid" aria-live="polite">' +
      (open
        .map(
          (j) =>
            '<article class="career-card"><h2><a href="/jobs/' +
            j.slug +
            '.html" target="_blank" rel="noopener noreferrer">' +
            escape(j.title) +
            "</a></h2><p>" +
            escape(j.summary) +
            "</p></article>",
        )
        .join("") ||
        '<p class="career-empty">No open positions currently. You can submit your resume below for future consideration.</p>') +
      "</div>",
  );
  write("careers.html", careerListing);
  const pages = [
    "",
    "about.html",
    "services.html",
    "backlinks.html",
    "guest-posting.html",
    "on-page-seo.html",
    "gmb.html",
    "contact.html",
    "blog.html",
    "careers.html",
    "privacy.html",
  ]
    .map((path) => ({ url: origin + "/" + path }))
    .concat(
      posts
        .filter(
          (p) =>
            canonicalUrl(
              p.canonical_url,
              origin + "/blog/" + p.slug + ".html",
            ) ===
            origin + "/blog/" + p.slug + ".html",
        )
        .map((p) => ({
          url: origin + "/blog/" + p.slug + ".html",
          modified: p.updated_at,
        })),
      open.map((j) => ({
        url: origin + "/jobs/" + j.slug + ".html",
        modified: j.updated_at,
      })),
    );
  write(
    "sitemap.xml",
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      pages
        .map(
          (p) =>
            "  <url><loc>" +
            escape(p.url) +
            "</loc>" +
            (p.modified
              ? "<lastmod>" + new Date(p.modified).toISOString() + "</lastmod>"
              : "") +
            "</url>",
        )
        .join("\n") +
      "\n</urlset>\n",
  );
  const commit =
      process.env.GITHUB_SHA ||
      execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    digest = createHash("sha256")
      .update(JSON.stringify({ commit, posts, jobs: open }))
      .digest("hex");
  write(
    "public-build.json",
    JSON.stringify({
      builtAt: new Date().toISOString(),
      commit,
      digest,
      publishedPosts: posts.length,
      openJobs: open.length,
    }),
  );
  write(".nojekyll", "");
  console.log(
    "Public build: " +
      posts.length +
      " published articles; " +
      open.length +
      " open jobs. Draft/private data excluded.",
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve("scripts/build-public-site.mjs")
)
  await build();
