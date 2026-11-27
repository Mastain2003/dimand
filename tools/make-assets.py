"""Makes the Android launcher icon and splash images from brand/logo-512.png (run by the build-apk workflow).
Needs Pillow:  pip install pillow"""
import os
from PIL import Image
src = Image.open('brand/logo-512.png').convert('RGBA')
os.makedirs('assets', exist_ok=True)
def canvas(size, color):
    return Image.new('RGBA', (size, size), color)
def place(base, img, w):
    img = img.resize((w, w), Image.LANCZOS); base.paste(img, ((base.width - w) // 2, (base.height - w) // 2), img); return base
src.resize((1024, 1024), Image.LANCZOS).save('assets/icon-only.png')
place(canvas(1024, (0, 0, 0, 0)), src, 680).save('assets/icon-foreground.png')   # logo inside the adaptive-icon safe zone
canvas(1024, (255, 255, 255, 255)).save('assets/icon-background.png')
sp = place(canvas(2732, (255, 255, 255, 255)), src, 640); sp.save('assets/splash.png'); sp.save('assets/splash-dark.png')
print('assets ready:', sorted(os.listdir('assets')))
