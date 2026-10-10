// TooWholesome DPS: prepare a GitHub release after `npm run tauri build`.
//
//   node scripts/release-manifest.mjs
//
// Copies the built MSI to release/ under a name without spaces and writes
// release/latest.json, the update manifest the meter reads
// (public/src/js/checkRelease.js). Attach both files to the GitHub release:
//
//   gh release create vX.Y.Z release/TooWholesome-DPS-Meter_X.Y.Z_x64_en-US.msi release/latest.json
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = "AIZay-lmtd/toowholesome-dps-meter";
const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const version = conf.version;
const built = join("src-tauri/target/release/bundle/msi", `${conf.productName}_${version}_x64_en-US.msi`);
const assetName = `TooWholesome-DPS-Meter_${version}_x64_en-US.msi`;

mkdirSync("release", { recursive: true });
copyFileSync(built, join("release", assetName));
const sha256 = createHash("sha256").update(readFileSync(built)).digest("hex");
const manifest = {
  version,
  msiUrl: `https://github.com/${REPO}/releases/download/v${version}/${assetName}`,
  msiSha256: sha256,
};
writeFileSync(join("release", "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest, null, 2));
console.log(`\nNext: gh release create v${version} "release/${assetName}" release/latest.json`);
