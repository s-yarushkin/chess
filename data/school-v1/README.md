# School v1 — Lichess CC0

Three machine-screened files: mate1.jsonl (900), mate2.jsonl (1100), mate3.jsonl (1000). Source: https://database.lichess.org/#puzzles ; derived topic CSV mirror: https://github.com/alchle/lichesspuzzles .

Run `npm run catalog:check` to validate every row and source move; then `npm run catalog:import` to add 3,000 records idempotently to the local database. Full description and limitations: `docs/CURRICULUM.md`.
