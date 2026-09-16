"""One-time deterministic resizing of the existing approved bear artwork."""
from pathlib import Path
from PIL import Image, ImageOps
import hashlib
import sys
source=Path(sys.argv[1]);raw=source.read_bytes()
if hashlib.sha256(raw).hexdigest() != 'ff49ec60a5bbc22795a25270efba320834d84d75c06665841ebcd55ca7d4fccf':
    raise ValueError('The source is not the approved existing bear artwork')
img=Image.open(source).convert('RGBA');dest=Path('assets');dest.mkdir(exist_ok=True)
for size,name in [(192,'mayer-bear.webp'),(32,'mayer-favicon.png'),(180,'mayer-apple.png'),(512,'mayer-app-512.png')]:
    canvas=Image.new('RGBA',(size,size),(255,255,255,0))
    fit=ImageOps.contain(img,(size,size),Image.Resampling.LANCZOS)
    canvas.alpha_composite(fit,((size-fit.width)//2,(size-fit.height)//2))
    if name.endswith('webp'):canvas.save(dest/name,quality=80,method=6)
    else:canvas.save(dest/name,optimize=True)
