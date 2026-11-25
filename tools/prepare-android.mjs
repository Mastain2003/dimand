// Writes capacitor.config.json from brand.config.json (app name, id) so rebranding the APK is one edit.
import fs from 'node:fs';
const cfg = JSON.parse(fs.readFileSync('brand.config.json', 'utf8'));
fs.writeFileSync('capacitor.config.json', JSON.stringify({ appId: cfg.appId || 'com.example.app', appName: cfg.name, webDir: 'app', server: { androidScheme: 'https' } }, null, 2));
console.log('capacitor.config.json written for', cfg.name, cfg.appId);
