// Canonical source: knightseye-net/tools/release-tooling/templates/check-review-marker.mjs.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const shaPattern = /^[a-f0-9]{40}$/;
export async function requireReview({ repository, sha, branch, reviewer, token, checkoutSha,
  fetchImpl = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !shaPattern.test(sha || '') ||
      checkoutSha !== sha || !['dev', 'production'].includes(branch) || reviewer !== 'Shedal' || !token) {
    throw Error('Review gate requires repository, exact checkout SHA, release branch, Shedal and GitHub token');
  }
  const prefix = `/repos/${repository}`;
  async function get(route) {
    let response;
    try {
      response = await fetchImpl(`https://api.github.com${prefix}${route}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(30000), redirect: 'error',
      });
    } catch { throw Error('Review evidence API unavailable'); }
    if (!response.ok) throw Error(`Review evidence API failed: HTTP ${response.status}`);
    try { return await response.json(); } catch { throw Error('Invalid review evidence JSON'); }
  }
  async function list(route) {
    const all = [];
    for (let page = 1; page <= 100; page++) {
      const items = await get(`${route}?per_page=100&page=${page}`);
      if (!Array.isArray(items)) throw Error('Invalid review evidence list');
      all.push(...items);
      if (items.length < 100) return all;
    }
    throw Error('Review evidence pagination limit reached');
  }
  const associated = await list(`/commits/${sha}/pulls`);
  const matches = [];
  const seen = new Set();
  for (const candidate of associated) {
    if (!Number.isSafeInteger(candidate.number) || candidate.number <= 0) throw Error('Invalid associated PR');
    if (seen.has(candidate.number)) continue;
    seen.add(candidate.number);
    // Resolve current PR metadata, not the commit-association response's snapshot.
    const pr = await get(`/pulls/${candidate.number}`);
    if (pr.number === candidate.number && pr.merged === true && pr.merged_at &&
        pr.merge_commit_sha === sha && pr.base?.ref === branch &&
        pr.base?.repo?.full_name === repository) matches.push(pr);
  }
  if (matches.length !== 1) throw Error('Expected one merged release PR for the exact checkout SHA');
  const pr = matches[0];
  const comments = await list(`/issues/${pr.number}/comments`);
  const decisions = [];
  for (const comment of comments) {
    if (comment.user?.login !== reviewer || typeof comment.body !== 'string') continue;
    // Standalone line permits Claude's normal generated footer after the decision.
    const markers = comment.body.split(/\r?\n/).filter(line =>
      new RegExp(`^claude-review: (approved|rejected) ${sha}$`).test(line));
    if (!markers.length) continue;
    const created = Date.parse(comment.created_at), updated = Date.parse(comment.updated_at);
    if (!Number.isSafeInteger(comment.id) || !Number.isFinite(created) || !Number.isFinite(updated) || updated < created) {
      throw Error('Invalid review decision metadata');
    }
    const edited = updated !== created;
    decisions.push({ id: comment.id, time: updated, approved: !edited && markers.length === 1 &&
      markers[0] === `claude-review: approved ${sha}` });
  }
  decisions.sort((a, b) => a.time - b.time || a.id - b.id);
  const latest = decisions.at(-1);
  if (!latest?.approved) throw Error('Exact commit has no current unedited approval; post a fresh review decision');
  return { repository, sha, reviewer, pullRequest: pr.number,
    reviewUrl: `https://github.com/${repository}/pull/${pr.number}#issuecomment-${latest.id}` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checkoutSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const receipt = await requireReview({ repository: process.env.GITHUB_REPOSITORY,
    sha: process.env.GITHUB_SHA, branch: process.env.REVIEW_RELEASE_BRANCH,
    reviewer: process.env.REVIEWER_LOGIN, token: process.env.GH_TOKEN, checkoutSha });
  console.log(JSON.stringify(receipt));
}
