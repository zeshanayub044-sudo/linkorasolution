import test from "node:test";
import assert from "node:assert/strict";
import {
  renderText,
  seo,
  canonicalUrl,
} from "../scripts/build-public-site.mjs";
test("published content renderer escapes markup and allows only ordinary web links", () => {
  const html = renderText(
    "# Heading\n\n<script>alert(1)</script> [safe](contact.html?service=Google%20Business%20Profile%20(GMB)) [unsafe](javascript:alert(1))\n\n- First\n- Second",
  );
  assert.match(html, /<h2>Heading<\/h2>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(
    html,
    /href="https:\/\/linkorasolution.com\/contact.html\?service=Google%20Business%20Profile%20\(GMB\)"/,
  );
  assert.match(html, /<ul><li>First<\/li>/);
});
test("snapshot SEO is unique, escaped, and contains one canonical", () => {
  const html = seo(
    '<head><title>Old</title><meta name="robots" content="noindex"><link rel="canonical" href="old"></head>',
    {
      title: "New & safe",
      description: 'A "quote"',
      url: "https://linkorasolution.com/blog/test.html",
      schema: {
        "@type": "BlogPosting",
        headline: "</script><script>alert(1)</script>",
      },
    },
  );
  assert.match(html, /New &amp; safe/);
  assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
  assert.match(html, /content="index,follow"/);
  assert.doesNotMatch(html, /<script>alert/);
});

test("Custom canonical requires HTTPS without embedded credentials", () => {
  assert.equal(
    canonicalUrl("https://example.com/article", "fallback"),
    "https://example.com/article",
  );
  assert.equal(canonicalUrl("javascript:alert(1)", "fallback"), "fallback");
  assert.equal(
    canonicalUrl("https://person:private@example.com/", "fallback"),
    "fallback",
  );
});
