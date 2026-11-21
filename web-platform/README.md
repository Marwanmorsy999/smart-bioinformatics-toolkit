# Web platform

The static website is in `public/`. It uses plain HTML, CSS and vanilla JavaScript ES modules. No frontend framework and no npm runtime dependencies are required.

## Local development

From this directory:

```bash
python -m http.server 8000 --directory public
```

Open <http://localhost:8000>.

## Tests

```bash
npm test
```

## Cloudflare Pages deployment

Connect the GitHub repository to Cloudflare Pages with:

- Project root directory: `web-platform`
- Framework preset: None
- Build command: empty
- Build output directory: `public`
- Production branch: your main branch

The free `*.pages.dev` address is sufficient for the MVP. Do not add R2 or a paid hosting service. Pages Functions can be added under `web-platform/functions/` in a later milestone when the API is implemented.
