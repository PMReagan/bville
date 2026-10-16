# bVille Expedition

A game of Birmingham, Michigan's historic sites. Live at https://bville-expedition.netlify.app

- `public/` is the site (game page, Identity client, data adapter, archive images)
- `netlify/functions/api.mjs` is the server: scores, saved progress, Syndicate actions, photos and field reports (Netlify Blobs), sign-in via Netlify Identity
- `src/` holds the pieces `src/build.py` assembles into `public/index.html`

Admins (who can remove any post) are listed in the `BVILLE_ADMINS` environment variable on Netlify.
