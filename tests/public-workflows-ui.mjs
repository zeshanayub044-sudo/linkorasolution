import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(
    pathToFileURL(
      process.env.PLAYWRIGHT_MODULE ||
        "C:/Users/ME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs",
    ).href
  ),
  root = resolve("_site");
const server = createServer((q, r) => {
  try {
    const f = resolve(root, "." + new URL(q.url, "http://local").pathname);
    if (!f.startsWith(root)) throw Error();
    r.setHeader(
      "Content-Type",
      {
        ".js": "application/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".json": "application/json",
      }[extname(f)] || "application/octet-stream",
    );
    r.end(readFileSync(f));
  } catch {
    r.writeHead(404);
    r.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port,
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.EDGE_EXECUTABLE ||
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  });
const checks = [];
try {
  const context = await browser.newContext({
      viewport: { width: 390, height: 900 },
      reducedMotion: "reduce",
    }),
    page = await context.newPage();
  let calls = [],
    fail = true;
  await page.route("**/functions/v1/marketing-lead", (route) => {
    calls.push(route.request().postDataJSON());
    return route.fulfill({
      status: fail ? 503 : 200,
      contentType: "application/json",
      body: fail ? "{}" : '{"accepted":true}',
    });
  });
  await page.goto(base + "/contact.html?utm_source=fixture-test");
  await page.locator("[data-theme-toggle]").click();
  await page.locator("[data-lead-form] button[type=submit]").click();
  assert.equal(calls.length, 0);
  await page.fill("[name=name]", "Disposable browser fixture");
  await page.fill("[name=email]", "invalid");
  await page.fill(
    "[name=message]",
    "This request is intercepted and never sent to production.",
  );
  await page.locator("[data-lead-form] button[type=submit]").click();
  assert.equal(calls.length, 0);
  await page.fill("[name=email]", "fixture@example.invalid");
  await page.selectOption("[name=service]", "Backlinks");
  await page.locator("[data-lead-form] button[type=submit]").click();
  await page
    .locator("[data-lead-status]")
    .filter({ hasText: "could not be saved" })
    .waitFor();
  const requestId = calls[0].requestId;
  fail = false;
  await page.locator("[data-lead-form] button[type=submit]").click();
  await page
    .locator("[data-lead-status]")
    .filter({ hasText: "Thank you" })
    .waitFor();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].requestId, requestId);
  assert.equal(calls[1].utm.utm_source, "fixture-test");
  checks.push(
    "Lead required/email validation, error/retry idempotency, UTM and success (intercepted network only).",
  );
  let resumeRequest;
  await page.route("**/functions/v1/career-apply", (route) => {
    resumeRequest = route.request();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        message: "Fixture resume accepted.",
      }),
    });
  });
  await page.goto(base + "/careers.html");
  await page
    .locator("#career-list-status")
    .filter({ hasText: /roles|positions|open/ })
    .waitFor();
  const form = page.locator("#career-general-form");
  for (const [name, value] of Object.entries({
    full_name: "Disposable browser fixture",
    email: "fixture@example.invalid",
    phone: "+92 300 0000000",
    primary_skill: "SEO",
    city: "Fixture city",
    country: "Pakistan",
    current_role: "SEO specialist",
    years_experience: "2",
    message:
      "A local intercepted browser fixture, never a production application.",
  })) {
    await form.locator("[name=" + name + "]").fill(value);
  }
  await form
    .locator("[name=resume]")
    .setInputFiles({
      name: "fixture.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Not a resume"),
    });
  await form.locator("[name=consent]").check();
  await form.locator("button[type=submit]").click();
  await page
    .locator("#career-general-message")
    .filter({ hasText: "PDF, DOC or DOCX" })
    .waitFor();
  assert.equal(resumeRequest, undefined);
  await form
    .locator("[name=resume]")
    .setInputFiles({
      name: "fixture.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n% Local browser fixture only\n%%EOF"),
    });
  await form.locator("button[type=submit]").click();
  await page
    .locator("#career-general-message")
    .filter({ hasText: "Fixture resume accepted" })
    .waitFor();
  assert.match(resumeRequest.headers()["content-type"], /multipart\/form-data/);
  checks.push(
    "Careers empty state, required form fields, rejected file type, PDF multipart and confirmation (intercepted only).",
  );
  const fixtureJob = {
    id: "00000000-0000-4000-8000-000000000010",
    slug: "fixture-test-role",
    title: "Fixture SEO role",
    department: "SEO",
    location: "Pakistan",
    employment_type: "full_time",
    workplace_type: "remote",
    experience_level: "Mid level",
    summary: "Local intercepted job fixture.",
    description: "A local job fixture for interface checks.",
    responsibilities: "- Review pages",
    requirements: "- SEO experience",
    status: "open",
    published_at: "2026-10-01T00:00:00Z",
  };
  await page.route("**/rest/v1/career_jobs*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([fixtureJob]),
    }),
  );
  await page.goto(base + "/career-job.html?slug=fixture-test-role");
  await page.locator("#career-job-detail h1").waitFor();
  assert.equal(
    await page.locator("meta[name=robots]").getAttribute("content"),
    "index,follow",
  );
  const application = page.locator("#career-application-form");
  for (const [name, value] of Object.entries({
    full_name: "Disposable browser fixture",
    email: "fixture@example.invalid",
    phone: "+92 300 0000000",
    city: "Fixture city",
    country: "Pakistan",
    years_experience: "2",
    current_role: "SEO specialist",
    linkedin_url: "https://www.linkedin.com/in/fixture",
    notice_period: "2 weeks",
    cover_letter:
      "A local intercepted browser fixture, never a production application.",
  })) {
    await application.locator("[name=" + name + "]").fill(value);
  }
  await application
    .locator("[name=resume]")
    .setInputFiles({
      name: "fixture.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n% Local fixture\n%%EOF"),
    });
  await application.locator("[name=consent]").check();
  await application.locator("button[type=submit]").click();
  await page
    .locator("#career-apply-panel")
    .filter({ hasText: "Fixture resume accepted" })
    .waitFor();
  checks.push(
    "Job detail and job-specific CV application validated with local API fixtures; no production job/application created.",
  );
  const routes = await page.evaluate(() => LINKORA_PUBLIC_ROUTES);
  if (routes.blog[0]) {
    const path = "/blog/" + routes.blog[0] + ".html";
    const nojs = await browser.newContext({ javaScriptEnabled: false });
    const raw = await nojs.newPage();
    await raw.goto(base + path);
    assert.equal(await raw.locator("h1").count(), 1);
    assert.ok(
      (await raw.locator(".blog-article__content").innerText()).length > 100,
    );
    assert.equal(
      await raw.locator("meta[name=robots]").getAttribute("content"),
      "index,follow",
    );
    await nojs.close();
    await page.route("**/rest/v1/blog_posts*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      }),
    );
    await page.goto(base + path);
    await page
      .locator("#blog-article-status")
      .filter({ hasText: "unavailable" })
      .waitFor();
    assert.equal(await page.locator(".blog-article__content").count(), 0);
    assert.equal(
      await page.locator("meta[name=robots]").getAttribute("content"),
      "noindex,follow",
    );
    assert.equal(await page.locator("#public-content-schema").count(), 0);
    checks.push(
      "Static Blog content and metadata without JavaScript; simulated unpublish removes snapshot/JSON-LD and sets noindex.",
    );
  }
  for (const file of ["blog-admin.html", "careers-admin.html"]) {
    await page.goto(base + "/" + file);
    await page
      .locator(file === "blog-admin.html" ? "#blog-login" : "#career-login")
      .waitFor();
    assert.equal(
      await page.locator("meta[name=robots]").getAttribute("content"),
      "noindex,nofollow",
    );
    assert.equal(
      await page
        .locator(
          file === "blog-admin.html" ? "#blog-dashboard" : "#career-dashboard",
        )
        .isVisible(),
      false,
    );
    await page.locator("[data-theme-toggle]").click();
    assert.equal(await page.locator(".nav-toggle").isVisible(), true);
    await page.locator(".nav-toggle").click();
    assert.equal(
      await page.locator(".nav-toggle").getAttribute("aria-expanded"),
      "true",
    );
  }
  checks.push(
    "Signed-out Blog/Careers admin remains protected/noindex; theme and mobile navigation work.",
  );
  await page.goto(base + "/index.html");
  const peer = await context.newPage();
  await peer.goto(base + "/about.html");
  const before = await page.locator("html").getAttribute("data-theme");
  await page.locator("[data-theme-toggle]").click();
  const after = before === "dark" ? "light" : "dark";
  await peer.waitForFunction(
    (t) => document.documentElement.dataset.theme === t,
    after,
  );
  const saved = await context.storageState();
  const reopened = await browser.newContext({
      storageState: saved,
      reducedMotion: "reduce",
    }),
    again = await reopened.newPage();
  await again.goto(base + "/contact.html");
  assert.equal(await again.locator("html").getAttribute("data-theme"), after);
  await reopened.close();
  checks.push(
    "Theme synchronizes open tabs and persists into a reopened browser context.",
  );
  const blocked = await browser.newContext({ reducedMotion: "reduce" });
  await blocked.addInitScript(() => {
    Storage.prototype.getItem = function () {
      throw Error("Storage blocked fixture");
    };
    Storage.prototype.setItem = function () {
      throw Error("Storage blocked fixture");
    };
  });
  const restricted = await blocked.newPage();
  await restricted.goto(base + "/index.html");
  assert.equal(
    await restricted.locator("html").getAttribute("data-theme"),
    "dark",
  );
  await restricted.locator("[data-theme-toggle]").click();
  assert.equal(
    await restricted.locator("html").getAttribute("data-theme"),
    "light",
  );
  await blocked.close();
  checks.push(
    "Blocked storage keeps the default and in-memory theme control usable.",
  );
  await context.close();
  writeFileSync(
    "docs/theme-seo/workflow-fixtures.json",
    JSON.stringify(
      { date: "2026-10-24", checks, productionWrites: 0 },
      null,
      2,
    ),
  );
  console.log(checks.join("\n"));
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
