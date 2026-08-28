/**
 * Rasterize docs/diagrams/*.svg to PNG (requires: npm install sharp --save-dev).
 * Flattens alpha onto white so PNGs are opaque (e.g. for Word on dark layouts).
 */
const fs = require("fs");
const path = require("path");

async function main() {
  let sharp;
  try {
    sharp = require("sharp");
  } catch {
    console.error("Install sharp: npm install sharp --save-dev");
    process.exit(1);
  }

  const root = path.join(__dirname, "..", "docs", "diagrams");
  const outDir = path.join(root, "png");
  await fs.promises.mkdir(outDir, { recursive: true });

  const files = (await fs.promises.readdir(root)).filter((f) => f.endsWith(".svg"));
  for (const f of files) {
    const svgPath = path.join(root, f);
    const base = path.basename(f, ".svg");
    const pngPath = path.join(outDir, `${base}.png`);
    const buf = await fs.promises.readFile(svgPath);
    await sharp(buf, { density: 150 })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .png()
      .toFile(pngPath);
    console.log("Wrote", pngPath);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
