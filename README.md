# TaskMarket Pulse

Live, read-only public market visualizer for TaskMarket (Tempo & Base).

- **Live URL:** https://7777add7777-ai.github.io/taskmarket-pulse/
- **Refresh:** Automated hourly via GitHub Actions (.github/workflows/deploy.yml) running `node scripts/refresh.mjs` and deploying static assets to GitHub Pages.
- **License:** MIT

## One-Command Deploy (local refresh + preview)

    node scripts/refresh.mjs && npx --yes serve site

To host on your own GitHub Pages fork, enable **Settings -> Pages -> Source: GitHub Actions** and run:

    gh workflow run deploy.yml
