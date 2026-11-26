# Evan White Web Design

Single-page portfolio site. Plain HTML, CSS and JavaScript with a WebGPU scene (WebGL2 fallback) that draws the work.

## Run locally

Any static server works, for example:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000. ES modules need a server; opening the file directly will not load the scripts.

## How it fits together

- `index.html`: all content and markup. Complete and readable without JavaScript.
- `css/main.css`: mobile-first styles, tokens at the top (color, type scale, spacing, easing).
- `js/main.js`: load sequence, scroll reveals, the hero scroll scene, quote light-up, mobile menu, contact form.
- `js/gpu/`: the GPU stage. `stage.js` tracks every `[data-plate]` element and redraws its image on one fixed canvas behind the page, adding the reveal wipe, scroll bend, parallax drift and pointer loupe. It tries WebGPU first, then WebGL2. If neither is available, or the visitor prefers reduced motion or has data saver on, the plain `<img>` elements stay visible.

The GPU module is imported only after the page has loaded and the browser is idle, so it never delays first paint.

## Before launch

- **Contact form:** set the form's `action` to your endpoint (Formspree, Netlify Forms, your own API). Without one, submitting opens a pre-filled email to hello@evanwhite.design.
- **Work images:** the four project images in `images/` are designed stand-ins. Replace them with real screenshots at the same aspect ratios (16:10, 4:3, 4:5, 2:1) and update the `alt` text.
- **Facts and quotes:** client names, results, stats, testimonials, pricing and availability are placeholder copy written in the right voice. Swap in real, verified figures and quotes before publishing.
- **Social image:** `images/og-image.jpg` (1200 x 630).
