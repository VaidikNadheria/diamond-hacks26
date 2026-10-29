-- For databases created before password authentication was introduced.
-- Empty hashes keep legacy accounts locked until ownership is verified.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '';
