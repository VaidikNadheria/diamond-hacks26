# Database setup and migrations

For a **new database**, run `supabase/schema.sql` in the Supabase SQL Editor. It already includes password hashes and the one-minute demo interval.

For a database created with an earlier version of this project, run the relevant SQL files in the SQL Editor:

- `add_password_hash.sql`: adds the password hash column without deleting users. Existing accounts receive an empty hash and cannot sign in or set a password through public registration. Recover those accounts only after verifying ownership through an administrator or a future verified recovery flow.
- `add_1min_interval.sql`: adds the one-minute demo interval to the alert constraint.

The password reset columns in the fresh schema are placeholders; no password reset flow is implemented.

## Optional command-line migration

Use Node.js 22 or later, run `npm ci`, and put `DATABASE_URL` in `.env.local`. Obtain the PostgreSQL connection string from your Supabase project and use the **database password**, not the service-role API key. Preserve the connection's required TLS settings.

Run from the repository root:

```bash
node run-migration.js
node run-1min-migration.js
```

These scripts execute the checked-in SQL inside a transaction and return a failing exit code on error. They require a database role allowed to alter the tables; the application itself uses the Supabase API.
