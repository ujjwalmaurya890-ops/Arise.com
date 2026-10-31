const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const system = read("src/theme-system.js");
const css = read("styles/design-system.css");
const type = read("styles/typography-upgrade.css");
const html = read("index.html");
const sw = read("service-worker.js");

function luminance(hex) {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = rgb.map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
function contrast(a, b) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}
function bestBlackOrWhite(background) {
  return contrast("#000000", background) >= contrast("#FFFFFF", background) ? "#000000" : "#FFFFFF";
}
function mixHex(foreground, background, amount) {
  return "#" + [1, 3, 5].map((i) => Math.round(
    parseInt(foreground.slice(i, i + 2), 16) * amount +
    parseInt(background.slice(i, i + 2), 16) * (1 - amount)
  ).toString(16).padStart(2, "0")).join("").toUpperCase();
}

const registryStart = system.indexOf("R={");
const registryEnd = system.indexOf("},Vr=", registryStart);
assert.ok(registryStart >= 0 && registryEnd > registryStart, "the built-in theme registry is discoverable");
const registrySource = system.slice(registryStart + 3, registryEnd);
const themePattern = /([A-Za-z][\w]*):\{label:"([^"]+)",mode:"(dark|light)",(.*?)(?=\},[A-Za-z][\w]*:\{label:|$)/gs;
const themes = [...registrySource.matchAll(themePattern)].map((match) => {
  const [, key, label, mode, body] = match;
  const colors = Object.fromEntries([...body.matchAll(/([A-Za-z][\w]*):"(#[0-9a-fA-F]{6})"/g)].map((m) => [m[1], m[2]]));
  return { key, label, mode, colors };
});

assert.equal(themes.length, 41, "all 41 built-in themes remain in the theme registry");
assert.ok(system.includes('function ur(r){var e=Yr(r),a=(e+.05)/.05,t=1.05/(e+.05);return a>=t?"#000000":"#FFFFFF"}'),
  "accent overrides choose the higher-contrast black or white label color");
assert.match(system, /n<4\.5&&\(i\.primaryContrast=ur\(i\.primary\)\)/,
  "theme application repairs built-in/imported primary contrast below WCAG AA");
assert.match(system, /"--primary-hover-contrast":ur\(c\.primaryHover\)/,
  "hover text contrast is supplied by the active theme");

const checkedPairs = [];
for (const theme of themes) {
  const c = theme.colors;
  assert.ok(c.background && c.surface && c.textPrimary && c.textSecondary && c.textTertiary && c.primary,
    `${theme.label} provides the base surface, text and brand palette`);
  for (const foreground of ["textPrimary", "textSecondary", "textTertiary", "link"]) {
    if (!c[foreground]) continue;
    for (const background of ["background", "surface"]) {
      const ratio = contrast(c[foreground], c[background]);
      assert.ok(ratio >= 4.5, `${theme.label}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1 (needs 4.5:1)`);
      checkedPairs.push(`${theme.label} ${foreground}/${background}`);
    }
  }
  for (const foreground of ["success", "warning", "danger", "info"]) {
    if (!c[foreground]) continue;
    const ratio = contrast(c[foreground], c.surface);
    assert.ok(ratio >= 4.5, `${theme.label}: ${foreground} on surface is ${ratio.toFixed(2)}:1`);
    checkedPairs.push(`${theme.label} ${foreground}/surface`);
    const tintedSurface = mixHex(c[foreground], c.surface, 0.04);
    const tintedRatio = contrast(c[foreground], tintedSurface);
    assert.ok(tintedRatio >= 4.5, `${theme.label}: ${foreground} on its semantic tint is ${tintedRatio.toFixed(2)}:1`);
    checkedPairs.push(`${theme.label} ${foreground}/semantic tint`);
  }
  const primaryFg = contrast(c.primaryContrast, c.primary) >= 4.5 ? c.primaryContrast : bestBlackOrWhite(c.primary);
  assert.ok(contrast(primaryFg, c.primary) >= 4.5, `${theme.label}: normalized primary label contrast`);
  const hoverFg = bestBlackOrWhite(c.primaryHover);
  assert.ok(contrast(hoverFg, c.primaryHover) >= 4.5, `${theme.label}: primary hover label contrast`);
  assert.ok(contrast(c.textPrimary, c.surface) >= 3, `${theme.label}: focus outline/text boundary remains visible`);
}

for (const token of [
  "--brand-primary", "--brand-secondary", "--surface-app", "--surface-card-elevated",
  "--text-heading", "--text-disabled", "--border-focus", "--success-fg", "--warning-bg",
  "--danger-border", "--info-fg", "--chart-primary", "--chart-tooltip-bg", "--space-1",
  "--space-16", "--radius-card", "--elevation-4", "--motion-standard", "--focus-ring"
]) assert.ok(css.includes(token + ":"), `semantic design token ${token} is defined`);

assert.ok(html.includes('href="./styles/design-system.css"'), "the shared visual system loads in the application");
assert.ok(sw.includes('"./styles/design-system.css"'), "the visual system stylesheet is cached by the service worker");
assert.ok(css.includes("prefers-reduced-motion: reduce"), "motion respects reduced-motion preferences");
assert.ok(css.includes("@media (max-width: 700px)"), "the shared system includes a compact-screen pass");
assert.ok(type.includes('--fs-h1:') && type.includes('--fs-body-lg:') && type.includes('--fs-code:'),
  "the type scale includes heading, body and code roles");
assert.ok(!html.includes("fonts.googleapis.com"), "the interface does not add external font requests");

console.log(`Design system checks passed: ${themes.length} themes and ${checkedPairs.length} text/status contrast pairs checked.`);
