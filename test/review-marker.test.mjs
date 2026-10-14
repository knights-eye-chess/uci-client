import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requireReview } from '../scripts/check-review-marker.mjs';

const repository = 'knights-eye-chess/uci-client';
const sha = 'a'.repeat(40);
const other = 'b'.repeat(40);
const createdAt = '2026-10-14T01:00:00Z';
const approved = {
  id: 10, user: { login: 'Shedal' }, body: `claude-review: approved ${sha}`,
  created_at: createdAt, updated_at: createdAt,
};
const merged = {
  number: 1, merged: true, merged_at: createdAt, merge_commit_sha: sha,
  base: { ref: 'dev', repo: { full_name: repository } },
};

function fixture({ comments = [approved], pullRequest = merged, checkoutSha = sha } = {}) {
  const routes = [];
  const fetchImpl = async url => {
    const route = new URL(url).pathname + new URL(url).search;
    routes.push(route);
    const prefix = `/repos/${repository}`;
    const body = route === `${prefix}/commits/${sha}/pulls?per_page=100&page=1`
      ? [{ number: 1 }]
      : route === `${prefix}/pulls/1` ? pullRequest
        : route === `${prefix}/issues/1/comments?per_page=100&page=1` ? comments : null;
    if (body === null) throw Error(`Unexpected review route: ${route}`);
    return { ok: true, json: async () => body };
  };
  return { routes, run: () => requireReview({ repository, sha, checkoutSha, branch: 'dev',
    reviewer: 'Shedal', token: 'opaque-test', fetchImpl }) };
}

test('exact merged dev commit with a current reviewer marker passes', async () => {
  const { run, routes } = fixture();
  assert.deepEqual(await run(), { repository, sha, reviewer: 'Shedal', pullRequest: 1,
    reviewUrl: `https://github.com/${repository}/pull/1#issuecomment-10` });
  assert(routes.some(route => route.endsWith('/pulls/1')));
});

test('wrong checkout, missing or rejected marker, and wrong merge SHA fail closed', async () => {
  await assert.rejects(fixture({ checkoutSha: other }).run, /exact checkout SHA/);
  await assert.rejects(fixture({ comments: [] }).run, /no current unedited approval/);
  await assert.rejects(fixture({ comments: [{ ...approved, body: `claude-review: rejected ${sha}` }] }).run,
    /no current unedited approval/);
  await assert.rejects(fixture({ pullRequest: { ...merged, merge_commit_sha: other } }).run,
    /one merged release PR/);
});

test('npm workflow checks review before preparation and again before publication', () => {
  const workflow = readFileSync(new URL('../.github/workflows/npm-publish.yml', import.meta.url), 'utf8');
  const gate = 'node scripts/check-review-marker.mjs';
  assert.equal(workflow.split(gate).length - 1, 2);
  assert(workflow.indexOf(gate) < workflow.indexOf('npm ci'));
  assert(workflow.lastIndexOf(gate) > workflow.indexOf('npm run publish:prepare'));
  assert(workflow.lastIndexOf(gate) < workflow.indexOf('node scripts/publish-reviewed.mjs'));
  assert.match(workflow, /pull-requests: read/);
  assert.match(workflow, /issues: read/);
  assert.match(readFileSync(new URL('../scripts/publish-reviewed.mjs', import.meta.url), 'utf8'),
    /await requireReview\(/);
});
