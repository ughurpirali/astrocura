// Builds dist/index.html (single self-contained file) and pre-computes validation results.
const fs = require('fs');
const path = require('path');
const E = require('./src/engine.js');
const src = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');

let validation = 'window.VALIDATION_PRECOMPUTED=null;';
const cache = path.join(__dirname, 'dist', 'validation.json');
if (!process.argv.includes('--skip-validation')) {
  const trials = 400;
  const t0 = Date.now();
  const results = [0, 0.25, 0.4].map((ar) => E.validate({ trials, ar, seed: 7 }));
  const payload = { node: process.version, trials, seconds: (Date.now() - t0) / 1000, results };
  fs.writeFileSync(cache, JSON.stringify(payload));
  console.log('validation computed in', payload.seconds, 's');
}
if (fs.existsSync(cache)) validation = 'window.VALIDATION_PRECOMPUTED=' + fs.readFileSync(cache, 'utf8') + ';';

const MIN = !process.argv.includes('--no-min');
const esbuild = MIN ? require('esbuild') : null;
const minJs = (code) => (MIN ? esbuild.transformSync(code, { minify: true, loader: 'js', target: 'es2019', legalComments: 'none' }).code : code);
const minCss = (code) => (MIN ? esbuild.transformSync(code, { minify: true, loader: 'css', legalComments: 'none' }).code : code);
const safe = (s) => s.replace(/<\/script>/gi, '<\\/script>');
const b64 = (f) => fs.readFileSync(path.join(__dirname, 'assets', f)).toString('base64');
const css = minCss(src('style.css').replace('/*FONT_LATIN*/', () => b64('inter-latin.woff2')).replace('/*FONT_GREEK*/', () => b64('inter-greek.woff2')).replace('/*FONT_WORDMARK*/', () => b64('wordmark.woff2')));
let html = src('index.template.html')
  .replace('/*CSS*/', () => css)
  .replace('/*ENGINE*/', () => safe(minJs(src('engine.js'))))
  .replace('/*OSDR*/', () => safe(minJs(src('data_osdr.js'))))
  .replace('/*VALIDATION*/', () => safe(validation))
  .replace('/*APP*/', () => safe(minJs(src('app.js'))));
fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'), html);
console.log('dist/index.html', (html.length / 1024).toFixed(0) + ' KB');
