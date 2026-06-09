"use strict";

const fs = require("fs");
const path = require("path");

// ─── ANSI colors ─────────────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};

function log(msg) { process.stdout.write(msg + "\n"); }
function ok(msg)  { log(`${c.green}✔${c.reset} ${msg}`); }
function warn(msg){ log(`${c.yellow}⚠${c.reset} ${msg}`); }
function info(msg){ log(`${c.cyan}→${c.reset} ${msg}`); }

// ─── File helpers ─────────────────────────────────────────────────────────────
function findFiles(dir, exts = [".scss", ".sass", ".css"]) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  function walk(d) {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", ".git", "dist", "build", ".next", "coverage"].includes(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile() && exts.some(e => entry.name.endsWith(e))) {
        results.push(fullPath);
      }
    }
  }
  walk(dir);
  return results;
}

function findJsFiles(dir) {
  return findFiles(dir, [".js", ".ts", ".mjs", ".cjs", ".jsx", ".tsx"]);
}

// ─── Step 1: Update package.json ─────────────────────────────────────────────
function migratePackageJson(rootDir, dryRun) {
  const pkgPath = path.join(rootDir, "package.json");
  if (!fs.existsSync(pkgPath)) return false;

  const raw = fs.readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw);
  let changed = false;

  for (const depKey of ["dependencies", "devDependencies", "peerDependencies"]) {
    if (pkg[depKey]) {
      if (pkg[depKey]["node-sass"]) {
        if (!dryRun) {
          pkg[depKey]["sass"] = "^1.0.0";
          delete pkg[depKey]["node-sass"];
        }
        ok(`package.json — replaced node-sass → sass`);
        changed = true;
      }
      // Also handle sass-loader if present — recommend update
      if (pkg[depKey]["sass-loader"]) {
        warn(`sass-loader found — ensure version ≥ 13.0.0 for Dart Sass compatibility`);
      }
    }
  }

  if (changed && !dryRun) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }
  return changed;
}

// ─── Step 2: Fix SCSS syntax ─────────────────────────────────────────────────
// Patterns that break when moving from node-sass to dart-sass
const SCSS_FIXES = [
  // /deep/ → ::v-deep (Vue deep selector)
  {
    re: /\s*\/deep\/\s*/g,
    replace: " ::v-deep ",
    description: "/deep/ → ::v-deep",
  },
  // @import with tilde (webpack-specific) — warn only, can't auto-fix safely
  // division operator — warn only
  // ::v-deep old Vue 2 syntax already handled above
];

function fixScssFile(filePath, dryRun) {
  let content = fs.readFileSync(filePath, "utf8");
  let changed = false;
  const warnings = [];

  for (const fix of SCSS_FIXES) {
    if (fix.re.test(content)) {
      if (!dryRun) {
        content = content.replace(fix.re, fix.replace);
      }
      changed = true;
    }
    fix.re.lastIndex = 0;
  }

  // Detect deprecated @import (warn, don't auto-fix — too risky)
  if (content.includes("@import")) {
    warnings.push("@import is deprecated in Dart Sass — consider migrating to @use/@forward");
  }

  // Detect division operator (warn)
  if (/\$[\w-]+\s*\/\s*\$[\w-]+/.test(content)) {
    warnings.push("Division operator / is deprecated — use math.div() from sass:math");
  }

  if (changed && !dryRun) {
    fs.writeFileSync(filePath, content);
  }

  return { changed, warnings };
}

// ─── Step 3: Fix webpack/vite configs ────────────────────────────────────────
function migrateWebpackConfig(filePath, dryRun) {
  let content = fs.readFileSync(filePath, "utf8");
  let changed = false;

  // Replace 'node-sass' with 'sass' in config files
  if (content.includes("node-sass") || content.includes("node_sass")) {
    if (!dryRun) {
      content = content
        .split("'node-sass'").join("'sass'")
        .split('"node-sass"').join('"sass"')
        .split("node_sass").join("sass");
      fs.writeFileSync(filePath, content);
    }
    changed = true;
  }

  return changed;
}

// ─── REPORT ──────────────────────────────────────────────────────────────────
function printReport(stats) {
  log("");
  log(`${c.bold}────────────────────────────────────${c.reset}`);
  log(`${c.bold}  node-sass-migrate — Summary${c.reset}`);
  log(`${c.bold}────────────────────────────────────${c.reset}`);
  ok(`package.json updated:      ${stats.pkgUpdated ? "yes" : "no"}`);
  ok(`SCSS files scanned:        ${stats.scssScanned}`);
  ok(`SCSS files modified:       ${stats.scssModified}`);
  ok(`Config files updated:      ${stats.configsUpdated}`);
  log("");

  if (stats.warnings.length > 0) {
    log(`${c.yellow}Manual fixes needed:${c.reset}`);
    for (const w of stats.warnings) {
      warn(w);
    }
    log("");
  }

  log(`${c.cyan}Next steps:${c.reset}`);
  info("Run: npm install (to install sass and remove node-sass)");
  info("Run your build to check for remaining issues");
  info("Full migration guide: https://nodesassmigrate.netlify.app");
  log(`${c.dim}Need help? Visit https://nodesassmigrate.netlify.app${c.reset}`);
  log("");
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
function run(args) {
  const targetDir = args[0] || ".";
  const dryRun = args.includes("--dry-run");
  const resolvedDir = path.resolve(targetDir);

  log("");
  log(`${c.bold}${c.cyan}node-sass-migrate v1.0.0${c.reset}`);
  log(`${c.dim}Migrating: ${resolvedDir}${c.reset}`);
  if (dryRun) warn("Dry-run mode — no files will be written");
  log("");

  const stats = {
    pkgUpdated: false,
    scssScanned: 0,
    scssModified: 0,
    configsUpdated: 0,
    warnings: [],
  };

  // Step 1: package.json
  info("Updating package.json...");
  stats.pkgUpdated = migratePackageJson(resolvedDir, dryRun);

  // Step 2: SCSS files
  info("Scanning SCSS/Sass files...");
  const scssFiles = findFiles(resolvedDir);
  stats.scssScanned = scssFiles.length;
  info(`Found ${scssFiles.length} SCSS/Sass files`);

  for (const file of scssFiles) {
    const { changed, warnings } = fixScssFile(file, dryRun);
    if (changed) {
      stats.scssModified++;
      ok(`  fixed: ${path.relative(resolvedDir, file)}`);
    }
    for (const w of warnings) {
      stats.warnings.push(`${path.relative(resolvedDir, file)}: ${w}`);
    }
  }

  // Step 3: webpack/vite/gulp configs
  info("Scanning build config files...");
  const configPatterns = ["webpack.config.js", "webpack.config.ts", "vite.config.js", "vite.config.ts", "gulpfile.js", "gulpfile.ts", ".storybook/main.js"];
  for (const cfg of configPatterns) {
    const cfgPath = path.join(resolvedDir, cfg);
    if (fs.existsSync(cfgPath)) {
      const changed = migrateWebpackConfig(cfgPath, dryRun);
      if (changed) {
        stats.configsUpdated++;
        ok(`  updated: ${cfg}`);
      }
    }
  }

  printReport(stats);
}

module.exports = { run };
