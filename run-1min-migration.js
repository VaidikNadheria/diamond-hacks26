import('./scripts/run-sql-migration.mjs')
  .then(({ runMigration }) => runMigration('add_1min_interval.sql'))
  .catch(() => {
    console.error('Migration failed. Check DATABASE_URL and the migration SQL, or use the Supabase SQL Editor.');
    process.exitCode = 1;
  });
