import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadModule(filename, dependencies) {
  const source = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const cjsModule = { exports: {} };
  const execute = vm.runInThisContext(
    '(function(require, module, exports) {\n' + outputText + '\n})',
    { filename }
  );
  execute((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error('Unexpected dependency: ' + name);
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

const validators = loadModule('src/lib/validators.ts', { zod: { z } });

function fixture(route, options = {}) {
  const state = { inserted: null, insertSelection: null };
  const database = {
    from(table) {
      assert.equal(table, 'users');
      let inserting = false;
      const query = {
        select(fields) {
          if (inserting) state.insertSelection = fields;
          return query;
        },
        eq() { return query; },
        maybeSingle: async () => ({
          data: options.user ?? null,
          error: options.lookupError ?? null,
        }),
        insert(values) {
          inserting = true;
          state.inserted = values;
          return query;
        },
        single: async () => ({
          data: options.missingInsert ? null : { master_token: 'new-token' },
          error: options.insertError ?? null,
        }),
      };
      return query;
    },
  };
  const { POST } = loadModule(route, {
    'next/server': { NextRequest, NextResponse },
    bcryptjs: bcrypt,
    '@/lib/supabase': { supabase: database },
    '@/lib/tokens': { generateToken: () => 'new-token' },
    '@/lib/validators': validators,
  });
  return {
    state,
    request: (body) => POST(new NextRequest('http://localhost/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })),
  };
}

const signup = 'src/app/api/users/route.ts';
const signin = 'src/app/api/users/signin/route.ts';
const credentials = { email: 'person@example.com', password: 'correct-password' };

test('registration hashes passwords and exposes only the management token', async () => {
  const app = fixture(signup);
  const response = await app.request(credentials);
  assert.equal(response.status, 201);
  assert.equal(app.state.inserted.email, credentials.email);
  assert.notEqual(app.state.inserted.password_hash, credentials.password);
  assert.equal(await bcrypt.compare(credentials.password, app.state.inserted.password_hash), true);
  assert.equal(app.state.insertSelection, 'master_token');
  const body = await response.json();
  assert.equal(body.master_token, 'new-token');
  assert.equal(Object.hasOwn(body, 'password_hash'), false);
});

test('existing accounts, including legacy empty-hash accounts, cannot be claimed', async () => {
  for (const password_hash of ['', 'existing-hash']) {
    const app = fixture(signup, { user: { id: 'existing-user', password_hash } });
    const response = await app.request(credentials);
    assert.equal(response.status, 409);
    assert.equal(app.state.inserted, null);
    assert.equal(Object.hasOwn(await response.json(), 'master_token'), false);
  }
});

test('registration rejects invalid input before accessing the database', async () => {
  for (const body of [
    { email: 'invalid', password: credentials.password },
    { email: credentials.email, password: 'short' },
    { email: credentials.email },
    '{broken-json',
  ]) {
    const app = fixture(signup);
    assert.equal((await app.request(body)).status, 400);
    assert.equal(app.state.inserted, null);
  }
});

test('database lookup failures cannot fall through to registration', async () => {
  const app = fixture(signup, { lookupError: { code: '08006' } });
  const response = await app.request(credentials);
  assert.equal(response.status, 500);
  assert.equal(app.state.inserted, null);
});

test('simultaneous duplicate signup returns a conflict without granting access', async () => {
  const app = fixture(signup, { insertError: { code: '23505' } });
  const response = await app.request(credentials);
  assert.equal(response.status, 409);
  assert.equal(Object.hasOwn(await response.json(), 'master_token'), false);
});

test('registration rejects missing insert results and database write failures', async () => {
  for (const options of [{ missingInsert: true }, { insertError: { code: '08006' } }]) {
    const app = fixture(signup, options);
    const response = await app.request(credentials);
    assert.equal(response.status, 500);
    assert.equal(Object.hasOwn(await response.json(), 'master_token'), false);
  }
});

test('sign-in accepts a correct password and rejects a wrong password', async () => {
  const password_hash = await bcrypt.hash(credentials.password, 10);
  const app = fixture(signin, { user: { password_hash, master_token: 'private-token' } });
  const good = await app.request(credentials);
  assert.equal(good.status, 200);
  assert.equal((await good.json()).master_token, 'private-token');

  const bad = await app.request({ ...credentials, password: 'wrong-password' });
  assert.equal(bad.status, 401);
  assert.deepEqual(await bad.json(), { error: 'Invalid email or password' });
});

test('unknown users and legacy users get the same sign-in error without tokens', async () => {
  for (const user of [null, { password_hash: '', master_token: 'private-token' }]) {
    const response = await fixture(signin, { user }).request(credentials);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Invalid email or password' });
  }
});

test('sign-in handles malformed input and database failures', async () => {
  assert.equal((await fixture(signin).request('{broken-json')).status, 400);
  const response = await fixture(signin, { lookupError: { code: '08006' } }).request(credentials);
  assert.equal(response.status, 500);
  assert.equal(Object.hasOwn(await response.json(), 'master_token'), false);
});
