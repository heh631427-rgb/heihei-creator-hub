# heihei creator workbench — Vercel edition

Deployable Next.js 16 / React 19 application, adapted from Site version 22 on 2026-10-31. Node.js 24 and a remote libSQL/Turso database are required. Original business calculation modules are unchanged.

Read `docs/DEPLOYMENT_ZH.md` before deployment. Initialize a new database with `npm run migrate -- PATH_TO_PRIVATE_DATA`. Provide TURSO_DATABASE_URL, TURSO_AUTH_TOKEN and WORKBENCH_SESSION_SECRET as server-only environment variables.

Commands: `npm ci`, `npm run build`, `npm run typecheck`, `npm run test:migration`, `npm run dev`.

Only commit this app directory to your private source repository. Never include the outer private-data folder, runtime environment files, password hashes or real business data in public assets or code. Migration backup files are intentionally outside this source tree.

`npm test` includes one reproduced pre-existing historical-views assertion mismatch. See docs/VALIDATION_ZH.md; migration-specific tests pass. The original source README is preserved in docs/ORIGINAL_FUNCTIONS_AND_RULES.md as provenance and may describe former hosting and metric behavior; use the running source and current UI as authoritative.
