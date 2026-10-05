# JINGI — website

The public page of JINGI, served by GitHub Pages from `main` at
https://pavelkonrad.cz/jingi/. No build step.

- `index.html` — the whole page.
- `css/site.css` — tokens, type scale and layout.
- `js/arena.js` — the throw: the game's speaker and die rendered with
  three.js and thrown with cannon-es (both loaded from jsDelivr through the
  import map in `index.html`). `?throw` plays one throw out at once, for
  screenshots.
- `models/` — `speaker.glb` and `die.glb`, exported from the Unity project.
- `video/` — the hero film, recorded in the arena (`arena.webm`, `arena.mp4`).
- `img/` — screenshots, the film's poster, the wordmark and the share card
  (`share.jpg`, 1200×630).

The wordmark and the MOVE word are images on purpose: the title face
(Sofachrome) is not licensed as a web font. All text is Kode Mono (OFL).

Serve it locally with `python3 -m http.server`; the page loads modules, so
opening the file directly does not start the 3D scene.
