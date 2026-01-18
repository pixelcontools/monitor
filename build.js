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

// Write to root
fs.writeFileSync(path.join(__dirname, 'index.html'), bundled);

console.log('✓ Built index.html successfully!');
