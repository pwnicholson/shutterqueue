const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const RELEASE_DIR = path.resolve(__dirname, "..", "release");
const PRODUCT_NAME = "ShutterQueue";

function walkDir(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      out.push(full);
      walkDir(full, out);
    }
  }
  return out;
}

function findMacApps(baseDir) {
  const dirs = [baseDir, ...walkDir(baseDir)];
  return dirs.filter((d) => d.toLowerCase().endsWith(".app"));
}

function pickNewest(paths) {
  let best = null;
  let bestMs = -1;
  for (const p of paths) {
    let ms = -1;
    try {
      ms = fs.statSync(p).mtimeMs;
    } catch {
      ms = -1;
    }
    if (ms > bestMs) {
      best = p;
      bestMs = ms;
    }
  }
  return best;
}

function existsDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function existsFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function findFilesRecursively(rootDir, predicate, out = []) {
  if (!existsDir(rootDir)) return out;
  for (const name of fs.readdirSync(rootDir)) {
    const full = path.join(rootDir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      findFilesRecursively(full, predicate, out);
    } else if (stat.isFile() && predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

function getBinaryArchs(binaryPath) {
  try {
    const raw = execFileSync("lipo", ["-archs", binaryPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return String(raw || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function fail(messages) {
  const list = Array.isArray(messages) ? messages : [String(messages || "Unknown verification failure")];
  console.error("\n[verify:mac:universal] FAILED");
  for (const m of list) {
    console.error(`- ${m}`);
  }
  console.error("\nBuild output is not safe to publish as a universal mac build.");
  process.exit(1);
}

(function main() {
  const errors = [];

  if (!existsDir(RELEASE_DIR)) {
    fail(`Release output folder not found: ${RELEASE_DIR}`);
  }

  const apps = findMacApps(RELEASE_DIR).filter((p) => path.basename(p).toLowerCase() === `${PRODUCT_NAME.toLowerCase()}.app` || p.toLowerCase().includes(".app"));
  if (!apps.length) {
    fail(`No .app bundle found under: ${RELEASE_DIR}`);
  }

  const appPath = pickNewest(apps);
  if (!appPath) {
    fail("Could not determine newest .app bundle to verify.");
  }

  const binaryPath = path.join(appPath, "Contents", "MacOS", PRODUCT_NAME);
  if (!existsFile(binaryPath)) {
    errors.push(`App binary not found at expected path: ${binaryPath}`);
  }

  const archs = existsFile(binaryPath) ? getBinaryArchs(binaryPath) : [];
  if (!archs.includes("arm64") || !archs.includes("x86_64")) {
    errors.push(`App binary is not universal arm64+x86_64. Found architectures: ${archs.join(", ") || "none"}`);
  }

  const unpackedNodeModules = path.join(appPath, "Contents", "Resources", "app.asar.unpacked", "node_modules");
  if (!existsDir(unpackedNodeModules)) {
    errors.push(`Unpacked node_modules not found: ${unpackedNodeModules}`);
  }

  const requiredDirs = [
    "sharp",
    path.join("@img", "sharp-darwin-arm64"),
    path.join("@img", "sharp-libvips-darwin-arm64"),
    path.join("@img", "sharp-darwin-x64"),
    path.join("@img", "sharp-libvips-darwin-x64"),
  ];

  for (const rel of requiredDirs) {
    const full = path.join(unpackedNodeModules, rel);
    if (!existsDir(full)) {
      errors.push(`Missing required runtime package in app bundle: ${full}`);
    }
  }

  const arm64SharpDir = path.join(unpackedNodeModules, "@img", "sharp-darwin-arm64");
  const x64SharpDir = path.join(unpackedNodeModules, "@img", "sharp-darwin-x64");

  const arm64NodeBins = findFilesRecursively(arm64SharpDir, (p) => p.toLowerCase().endsWith(".node"));
  const x64NodeBins = findFilesRecursively(x64SharpDir, (p) => p.toLowerCase().endsWith(".node"));

  if (!arm64NodeBins.length) {
    errors.push(`No native .node binary found under: ${arm64SharpDir}`);
  }
  if (!x64NodeBins.length) {
    errors.push(`No native .node binary found under: ${x64SharpDir}`);
  }

  if (errors.length) {
    fail(errors);
  }

  console.log("\n[verify:mac:universal] OK");
  console.log(`- App bundle: ${appPath}`);
  console.log(`- Binary architectures: ${archs.join(", ")}`);
  console.log(`- sharp arm64 .node count: ${arm64NodeBins.length}`);
  console.log(`- sharp x64 .node count: ${x64NodeBins.length}`);
})();
