# F3K DLG Dashboard

Static GitHub Pages / PWA dashboard for SRKLOG CSV files.

## Upload to GitHub Pages

1. Create a new public repository, for example `f3k-dashboard`.
2. Upload all files from this folder to the repository root:
   - `index.html`
   - `style.css`
   - `app.js`
   - `manifest.json`
   - `service-worker.js`
   - `icon.svg`
3. Go to repository **Settings → Pages**.
4. Under **Build and deployment**, choose:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/root`
5. Wait until GitHub gives you the Pages URL.
6. Open the URL on iPhone in Safari and use **Share → Add to Home Screen**.

## Import logs

Use the **Import logs** button and select `index.csv` plus all flight `f*.csv` files from your SRK_LOGS folder. The data is stored locally in the browser.
