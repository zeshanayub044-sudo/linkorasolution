import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const runtime =
  process.env.PLAYWRIGHT_MODULE ||
  "C:/Users/ME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
const { chromium, firefox, webkit } = await import(pathToFileURL(runtime).href),
  root = resolve("_site");
const server = createServer((q, r) => {
  try {
    const path = new URL(q.url, "http://local").pathname,
      file = resolve(root, "." + (path === "/" ? "/index.html" : path));
    if (!file.startsWith(root)) throw Error();
    r.setHeader(
      "Content-Type",
      {
        ".js": "application/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
      }[extname(file)] || "application/octet-stream",
    );
    r.end(readFileSync(file));
  } catch {
    r.writeHead(404);
    r.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base =
    process.env.SMOKE_BASE || "http://127.0.0.1:" + server.address().port,
  out = resolve(process.env.SMOKE_REPORT_DIR || "docs/theme-seo");
mkdirSync(out, { recursive: true });
const evidence = {
    date: new Date().toISOString().slice(0, 10),
    base,
    browsers: [],
    checks: [],
    performance: [],
    limitations: [],
  },
  results = [];
const flavors = [
  {
    name: "Edge Chromium",
    engine: chromium,
    options: {
      executablePath:
        process.env.EDGE_EXECUTABLE ||
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    },
  },
];
if (existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe"))
  flavors.push({
    name: "Chrome",
    engine: chromium,
    options: {
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    },
  });
for (const [name, engine] of [
  ["Firefox", firefox],
  ["WebKit", webkit],
]) {
  if (existsSync(engine.executablePath()))
    flavors.push({ name, engine, options: {} });
  else
    evidence.limitations.push(name + " runtime unavailable; no test claimed.");
}
const routes = JSON.parse(
  (await (await fetch(base + "/public-routes.js")).text()).match(
    /Object\.freeze\((.*)\)/,
  )[1],
);
const articlePaths = routes.blog.map(slug => "/blog/" + slug + ".html");
const jobPaths = routes.jobs.map(slug => "/jobs/" + slug + ".html");
const pages = [
  "/index.html",
  "/about.html",
  "/services.html",
  "/backlinks.html",
  "/guest-posting.html",
  "/on-page-seo.html",
  "/gmb.html",
  "/contact.html",
  "/blog.html",
  "/careers.html",
  "/privacy.html",
].concat(articlePaths, jobPaths);
function contrast(a, b) {
  const lum = (c) => {
    const rgb = c
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number)
      .map((x) => {
        x /= 255;
        return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const x = lum(a),
    y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
try {
  for (const flavor of flavors) {
    const browser = await flavor.engine.launch({
      headless: true,
      ...flavor.options,
    });
    evidence.browsers.push(flavor.name);
    try {
      for (const width of flavor.name === "Edge Chromium"
        ? [320, 375, 390, 768, 1024, 1440, 1920]
        : [390, 1440]) {
        for (const theme of ["dark", "light"]) {
          const context = await browser.newContext({
            viewport: { width, height: 1000 },
            reducedMotion: "reduce",
          });
          await context.addInitScript(
            ({ theme }) => {
              if (theme === "light" && !localStorage.getItem("linkora-theme"))
                localStorage.setItem("linkora-theme", "light");
              window.smokeMetrics = { cls: 0, lcp: 0 };
              try {
                new PerformanceObserver((l) =>
                  l.getEntries().forEach((e) => {
                    if (!e.hadRecentInput) smokeMetrics.cls += e.value;
                  }),
                ).observe({ type: "layout-shift", buffered: true });
                new PerformanceObserver((l) =>
                  l
                    .getEntries()
                    .forEach((e) => (smokeMetrics.lcp = e.startTime)),
                ).observe({ type: "largest-contentful-paint", buffered: true });
              } catch {}
              requestAnimationFrame(function firstBodyFrame() {
                if (document.body)
                  window.firstFrameTheme =
                    document.documentElement.dataset.theme;
                else requestAnimationFrame(firstBodyFrame);
              });
            },
            { theme },
          );
          const page = await context.newPage(),
            errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          for (const path of pages) {
            const response = await page.goto(base + path, {
              waitUntil: "domcontentloaded",
            });
            assert.equal(response.status(), 200, path);
            await page.locator("[data-theme-toggle]").waitFor();
            await page.locator(".leadership-card").waitFor();
            await page.evaluate(() => document.fonts.ready);
            assert.equal(
              await page.locator("html").getAttribute("data-theme"),
              theme,
            );
            await page.waitForFunction(() => window.firstFrameTheme);
            assert.equal(
              await page.evaluate(() => window.firstFrameTheme),
              theme,
              path + " first-frame theme",
            );
            assert.equal(
              await page
                .locator("[data-theme-toggle]")
                .getAttribute("aria-pressed"),
              String(theme === "light"),
            );
            assert.equal(await page.locator("h1").count(), 1, path);
            assert.equal(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1,
              ),
              true,
              path + " overflow " + width,
            );
            assert.equal(
              await page
                .locator("meta[name=robots]")
                .evaluateAll((xs) =>
                  xs.some((x) => x.content.includes("noindex")),
                ),
              false,
              path + " indexability",
            );
            assert.equal(await page.locator("link[rel=canonical]").count(), 1);
            for (const schema of await page
              .locator('script[type="application/ld+json"]')
              .allTextContents())
              JSON.parse(schema);
            assert.equal(await page.locator(".leadership-card").count(), 1);
            assert.equal(
              /ibrahim/i.test(
                await page.locator(".leadership-section").innerText(),
              ),
              false,
            );
            const palette = await page.evaluate(() => {
              const s = getComputedStyle(document.documentElement);
              return {
                text: s.getPropertyValue("--text"),
                muted: s.getPropertyValue("--text-muted"),
                dim: s.getPropertyValue("--text-dim"),
                accent: s.getPropertyValue("--teal"),
                bg: getComputedStyle(document.body).backgroundColor,
                surface: s.getPropertyValue("--surface"),
              };
            });
            const rgb = (hex) => {
              let a = hex.trim().slice(1);
              if (a.length === 3)
                a = a
                  .split("")
                  .map((x) => x + x)
                  .join("");
              return (
                "rgb(" +
                [0, 2, 4]
                  .map((i) => parseInt(a.slice(i, i + 2), 16))
                  .join(",") +
                ")"
              );
            };
            for (const token of ["text", "muted", "dim", "accent"])
              assert.ok(
                contrast(rgb(palette[token]), rgb(palette.surface)) >= 4.5,
                path + " " + token + " contrast",
              );
            if (
              ["index", "contact", "backlinks"].some(
                (s) => path === "/" + s + ".html",
              ) ||
              articlePaths.includes(path) || jobPaths.includes(path)
            ) {
              await page.locator("img").evaluateAll(async (xs) => {
                xs.forEach((i) => (i.loading = "eager"));
                await Promise.all(xs.map((i) => i.decode().catch(() => {})));
              });
              const broken = await page
                .locator("img")
                .evaluateAll((xs) =>
                  xs
                    .filter((i) => !i.complete || !i.naturalWidth)
                    .map((i) => i.src),
                );
              assert.deepEqual(broken, [], path + " images");
            }
            if (
              flavor.name === "Edge Chromium" &&
              [390, 1440].includes(width) &&
              ["/index.html", "/contact.html", ...articlePaths, ...jobPaths].includes(path) &&
              process.env.QA_OUT
            ) {
              mkdirSync(process.env.QA_OUT, { recursive: true });
              await page.screenshot({
                path: resolve(
                  process.env.QA_OUT,
                  articlePaths.includes(path) || jobPaths.includes(path)
                    ? path.split('/').pop().replace('.html', '') + "-" + theme + "-" + width + ".png"
                    : path.slice(1, -5) + "-" + theme + "-" + width + ".png",
                ),
                fullPage: true,
              });
            }
            evidence.checks.push({
              browser: flavor.name,
              width,
              theme,
              path,
              passed: true,
            });
            evidence.performance.push({
              width,
              theme,
              path,
              ...(await page.evaluate(() => smokeMetrics)),
            });
          }
          await page.goto(base + "/index.html");
          const toggle = page.locator("[data-theme-toggle]");
          await toggle.focus();
          await page.keyboard.press("Enter");
          const next = theme === "dark" ? "light" : "dark";
          assert.equal(
            await page.locator("html").getAttribute("data-theme"),
            next,
          );
          await page.reload();
          assert.equal(
            await page.locator("html").getAttribute("data-theme"),
            next,
          );
          await page.goto(base + "/about.html");
          assert.equal(
            await page.locator("html").getAttribute("data-theme"),
            next,
          );
          if (width <= 1120) {
            assert.equal(
              await page.locator("nav.links").evaluate((e) => e.inert),
              true,
            );
            await page.locator(".nav-toggle").click();
            assert.equal(
              await page.locator(".nav-toggle").getAttribute("aria-expanded"),
              "true",
            );
            assert.equal(
              await page.locator("nav.links").evaluate((e) => e.inert),
              false,
            );
            await page.keyboard.press("Escape");
            assert.equal(
              await page.locator(".nav-toggle").getAttribute("aria-expanded"),
              "false",
            );
          } else {
            await page.locator(".services-nav > a").hover();
            await page
              .locator(".services-dropdown__panel")
              .waitFor({ state: "visible" });
            const box = await page
              .locator(".services-dropdown__panel")
              .boundingBox();
            assert.ok(box.x >= 0 && box.x + box.width <= width);
          }
          assert.deepEqual(errors, []);
          await context.close();
          console.log(
            flavor.name +
              " " +
              width +
              " " +
              theme +
              ": " +
              pages.length +
              " pages passed.",
          );
        }
      }
    } finally {
      await browser.close();
    }
  }
  writeFileSync(
    resolve(
      out,
      process.env.SMOKE_BASE ? "production-smoke.json" : "local-smoke.json",
    ),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    "Smoke matrix passed. " +
      evidence.checks.length +
      " page/theme/device checks.",
  );
} finally {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
