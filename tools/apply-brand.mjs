// Rebrand in one step: edit brand.config.json (and replace the logo files in brand/), then run:  node tools/apply-brand.mjs
// It rewrites the PWA manifest, copies the icons into app/icons and updates the page title.
import fs from 'node:fs';
const cfg = JSON.parse(fs.readFileSync('brand.config.json', 'utf8'));
fs.mkdirSync('app/icons', { recursive: true });
fs.copyFileSync(cfg.logo, 'app/icons/icon-512.png');
fs.copyFileSync(cfg.icon192, 'app/icons/icon-192.png');
fs.writeFileSync('app/manifest.webmanifest', JSON.stringify({
  name: cfg.name, short_name: cfg.shortName, start_url: './', scope: './', display: 'standalone',
  background_color: '#ffffff', theme_color: cfg.color,
  icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }],
}, null, 2));
let html = fs.readFileSync('app/index.html', 'utf8');
html = html.replace(/<title>.*<\/title>/, `<title>${cfg.name}</title>`).replace(/(name="theme-color" content=")[^"]*/, `$1${cfg.color}`);
fs.writeFileSync('app/index.html', html);
console.log('Branding applied:', cfg.name);
