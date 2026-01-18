/**
 * Simple build script to bundle everything into a single index.html
 */
const fs = require('fs');
const path = require('path');

console.log('Building static monitor...');

// Read the source HTML
const html = fs.readFileSync(path.join(__dirname, 'src', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, 'src', 'monitor.js'), 'utf8');

// Inline the JavaScript
const bundled = html.replace('<!-- SCRIPT_PLACEHOLDER -->', `<script>\n${js}\n</script>`);

// Write to docs folder (for GitHub Pages)
const docsDir = path.join(__dirname, 'docs');
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}
fs.writeFileSync(path.join(docsDir, 'index.html'), bundled);

console.log('✓ Built docs/index.html successfully!');
