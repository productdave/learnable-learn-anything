import assert from 'node:assert/strict';
import { localDockerArgs } from './local-docker/docker';
assert.deepEqual(localDockerArgs(['create', '--name', 'supabase_db_learnable-setup-local', '-p', '54322:5432']), ['create', '--name', 'supabase_db_learnable-setup-local', '-p', '127.0.0.1:54322:5432']);
assert.deepEqual(localDockerArgs(['run', '--name', 'supabase_kong_learnable-setup-local', '--publish', '54321:8000/tcp']), ['run', '--name', 'supabase_kong_learnable-setup-local', '--publish', '127.0.0.1:54321:8000/tcp']);
assert.deepEqual(localDockerArgs(['inspect', 'existing']), ['inspect', 'existing']);
assert.throws(() => localDockerArgs(['create', '--name', 'unrelated', '-p', '80:80']));
assert.throws(() => localDockerArgs(['create', '--name', 'supabase_db_learnable-setup-local', '-p', '0.0.0.0:54322:5432']));
assert.throws(() => localDockerArgs(['create', '-p', '54322:5432']));
console.log('6 local Docker binding checks passed.');
