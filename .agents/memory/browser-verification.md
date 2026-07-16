---
name: In-browser verification with Puppeteer
description: How to do real click-through UI verification in this workspace, and a mobile-layout gotcha
---
- Puppeteer + system Chromium (`which chromium`) work in the dev workspace: launch with `executablePath: CHROME_BIN`, `args: ['--no-sandbox','--disable-dev-shm-usage']`. Run scripts from the workspace root so `node_modules` resolves.
- Student portal login works headlessly against `http://localhost:5000` using the seeded demo student account (see `server/seed-demo-accounts.ts` for the seeded credentials).
- Mobile-emulation gotcha: if `window.innerWidth` reports far more than the viewport you set, the page content is overflowing horizontally and Chrome expanded the layout viewport — that is a real mobile bug (taps fail with "Node is either not clickable"), not a Puppeteer quirk. Root cause pattern: a `flex-1` layout child missing `min-w-0`.
**How to apply:** when verifying UI flows, prefer real `page.tap`/`page.click` over `$eval(el=>el.click())`; a native click failure usually signals a genuine tap-target/layout problem worth fixing.
