// Boots user-space PostgreSQL (no root) for local/sandbox development.
// Lives at .pgtool/start-pg.js — the path .zscripts/dev.sh expects — so
// require('embedded-postgres') resolves through the repo's node_modules and
// honours the exports map (absolute-path require of the package dir fails:
// no "main", only "exports"). Credentials match dev.sh defaults.
const path = require('path');
const EmbeddedPostgres = require('embedded-postgres').default;
const pg = new EmbeddedPostgres({
  databaseDir: path.join(__dirname, 'data'),
  user: 'postgres', password: 'postgres', port: 5432, persistent: true,
});
(async () => {
  try { await pg.initialise(); console.log('[pg] initialised fresh data dir'); }
  catch (e) { console.log('[pg] data dir already initialised, reusing'); }
  await pg.start();
  try { await pg.createDatabase('mudaala'); console.log('[pg] created database mudaala'); }
  catch (e) { console.log('[pg] database mudaala already exists'); }
  console.log('[pg] ready on 127.0.0.1:5432');
  setInterval(() => {}, 1 << 30);
})().catch((e) => { console.error('[pg] FAILED:', e && e.message ? e.message : e); process.exit(1); });
