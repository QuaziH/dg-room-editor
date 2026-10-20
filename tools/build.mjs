// Bundles src/ into docs/index.html (React from cdnjs) and copies the room data.
// docs/ is what GitHub Pages serves.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";

const result = await build({
  entryPoints: ["src/main.jsx"],
  bundle: true,
  minify: true,
  write: false,
  format: "iife",
  target: "es2020",
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
  loader: { ".jsx": "jsx" },
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const style = readFileSync("src/style.css", "utf8");

const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DG Room Markers</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Figtree:wght@400;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>${style}</style>
<div id="root"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script>${js}</script>
`;

mkdirSync("docs", { recursive: true });
writeFileSync("docs/index.html", html);
for (const f of readdirSync("public")) copyFileSync(`public/${f}`, `docs/${f}`);
console.log(`docs/index.html ${(html.length / 1024).toFixed(1)} KB`);
