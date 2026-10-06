from pathlib import Path
from urllib.parse import urlsplit


def allowed_image(image):
    if not isinstance(image, str) or len(image) > 2048:
        return False
    root = Path(__file__).resolve().parents[2] / 'public'
    if image.startswith('/test-store/crownley/products/'):
        return '..' not in image and '?' not in image and '#' not in image and (root / image.lstrip('/')).is_file()
    try:
        url = urlsplit(image)
        # Referenced by the browser, never fetched by the backend. No redirects/proxy downloads.
        return (url.scheme == 'https' and url.hostname in {'oss-cf.cjdropshipping.com', 'cf.cjdropshipping.com'}
                and not url.username and not url.password and url.port in (None, 443) and not url.fragment)
    except ValueError:
        return False
