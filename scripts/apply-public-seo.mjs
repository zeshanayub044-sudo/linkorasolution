import { readFileSync, writeFileSync } from "node:fs";
const pages = JSON.parse(readFileSync("content/seo-pages.json", "utf8"));
const escape = (s) =>
  s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
for (const [file, seo] of Object.entries(pages)) {
  let html = readFileSync(file, "utf8");
  html = html.replace(
    /<title>[^<]*<\/title>/,
    "<title>" + escape(seo.title) + "</title>",
  );
  for (const [name, value, property] of [
    ["description", seo.description],
    ["og:title", seo.title, true],
    ["og:description", seo.description, true],
    ["twitter:title", seo.title],
    ["twitter:description", seo.description],
  ]) {
    const attribute = property ? "property" : "name",
      pattern = new RegExp("<meta " + attribute + '="' + name + '"[^>]*>');
    const tag =
      "<meta " + attribute + '="' + name + '" content="' + escape(value) + '">';
    html = pattern.test(html)
      ? html.replace(pattern, tag)
      : html.replace("</head>", tag + "\n</head>");
  }
  const label = {
    "about.html": "About",
    "services.html": "Services",
    "backlinks.html": "Backlinks",
    "guest-posting.html": "Guest Posting",
    "on-page-seo.html": "On-Page SEO",
    "gmb.html": "Google Business Profile",
    "contact.html": "Contact",
    "blog.html": "Blog",
    "careers.html": "Careers",
    "privacy.html": "Privacy",
  }[file];
  if (!html.includes('class="breadcrumbs"'))
    html = html.replace(
      "<main>",
      '<main><nav class="breadcrumbs" aria-label="Breadcrumb"><div class="wrap"><a href="index.html" target="_blank" rel="noopener noreferrer">Home</a><span aria-hidden="true"> / </span><span aria-current="page">' +
        label +
        "</span></div></nav>",
    );
  if (
    !html.includes('id="page-breadcrumb-schema"') &&
    ![
      "backlinks.html",
      "guest-posting.html",
      "on-page-seo.html",
      "gmb.html",
    ].includes(file)
  ) {
    const data = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: "https://linkorasolution.com/",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: label,
          item: "https://linkorasolution.com/" + file,
        },
      ],
    };
    html = html.replace(
      "</head>",
      '<script id="page-breadcrumb-schema" type="application/ld+json">' +
        JSON.stringify(data) +
        "</script>\n</head>",
    );
  }
  writeFileSync(file, html);
}
