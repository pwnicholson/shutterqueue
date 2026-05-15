const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

function runNpmInstall(args, label) {
  console.log(`\n[stage:sharp:mac:universal] ${label}`);
  execFileSync(npmCmd, ["install", "--no-save", ...args], {
    cwd: ROOT_DIR,
    stdio: "inherit",
  });
}

function requireDir(relPath) {
  const full = path.join(ROOT_DIR, relPath);
  try {
    if (!fs.statSync(full).isDirectory()) {
      throw new Error("Path is not a directory");
    }
  } catch {
    throw new Error(`Missing required staged package directory: ${full}`);
  }
}

function main() {
  // Host-arch package (arm64 on Apple Silicon) installs normally.
  runNpmInstall(
    [
      "--os=darwin",
      "--cpu=arm64",
      "@img/sharp-darwin-arm64",
      "@img/sharp-libvips-darwin-arm64",
    ],
    "Installing arm64 sharp runtime packages"
  );

  // Cross-arch package install is intentionally forced because npm validates CPU
  // against the host process even with --cpu overrides on newer npm versions.
  runNpmInstall(
    [
      "--force",
      "--os=darwin",
      "--cpu=x64",
      "@img/sharp-darwin-x64",
      "@img/sharp-libvips-darwin-x64",
    ],
    "Installing x64 sharp runtime packages (forced cross-arch staging)"
  );

  const required = [
    "node_modules/@img/sharp-darwin-arm64",
    "node_modules/@img/sharp-libvips-darwin-arm64",
    "node_modules/@img/sharp-darwin-x64",
    "node_modules/@img/sharp-libvips-darwin-x64",
  ];

  for (const relPath of required) {
    requireDir(relPath);
  }

  console.log("\n[stage:sharp:mac:universal] OK");
}

try {
  main();
} catch (error) {
  console.error("\n[stage:sharp:mac:universal] FAILED");
  console.error(`- ${error && error.message ? error.message : String(error)}`);
  process.exit(1);
}
