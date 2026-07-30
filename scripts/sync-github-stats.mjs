#!/usr/bin/env node
// GitHub GraphQL로 실제 활동 통계를 가져와 src/data/github-stats.json을 갱신한다.
// GitHub Actions에서는 자동 제공되는 GITHUB_TOKEN을, 로컬에서는 `gh auth token`을 사용한다.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import path from 'node:path';

const GITHUB_USERNAME = 'doHoaSen';
const DATA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/data/github-stats.json'
);

function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    return execSync('gh auth token', { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('GitHub 토큰을 찾을 수 없습니다 (GITHUB_TOKEN 환경변수 또는 gh auth login 필요).');
  }
}

const QUERY = `
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

// GitHub의 contributionCalendar는 UTC 날짜 단위로만 집계되어(GraphQL from/to를 줘도
// 서브데이 필터링이 되지 않음) KST 자정 기준 "오늘"을 정확히 구할 수 없다.
// 대신 실제 타임스탬프가 있는 이벤트(Events API, 인증 토큰으로 private 포함)를 KST 자정 이후로 걸러서 센다.
function kstMidnightUTC() {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const kstNow = new Date(Date.now() + KST_OFFSET_MS);
  const y = kstNow.getUTCFullYear();
  const m = kstNow.getUTCMonth();
  const d = kstNow.getUTCDate();
  return new Date(Date.UTC(y, m, d, 0, 0, 0) - KST_OFFSET_MS);
}

async function countPushCommits(token, event) {
  const { before, head } = event.payload;
  if (!before || !head || /^0+$/.test(before)) return 1;
  const res = await fetch(
    `https://api.github.com/repos/${event.repo.name}/compare/${before}...${head}`,
    { headers: { Authorization: `bearer ${token}`, Accept: 'application/vnd.github+json' } }
  );
  if (!res.ok) return 1;
  const data = await res.json();
  return typeof data.ahead_by === 'number' ? data.ahead_by : 1;
}

async function fetchTodayCount(token, since) {
  const headers = { Authorization: `bearer ${token}`, Accept: 'application/vnd.github+json' };
  const events = [];
  for (let page = 1; page <= 3; page++) {
    const res = await fetch(
      `https://api.github.com/users/${GITHUB_USERNAME}/events?per_page=100&page=${page}`,
      { headers }
    );
    if (!res.ok) throw new Error(`이벤트 조회 실패: ${res.status} ${await res.text()}`);
    const batch = await res.json();
    events.push(...batch);
    const oldest = batch[batch.length - 1];
    if (batch.length < 100 || !oldest || new Date(oldest.created_at) < since) break;
  }

  const todays = events.filter((e) => new Date(e.created_at) >= since);

  let count = 0;
  for (const e of todays) {
    if (e.type === 'PushEvent') {
      count += await countPushCommits(token, e);
    } else if (e.type === 'PullRequestEvent' && e.payload.action === 'opened') {
      count += 1;
    } else if (e.type === 'IssuesEvent' && e.payload.action === 'opened') {
      count += 1;
    } else if (e.type === 'PullRequestReviewEvent' && e.payload.action === 'created') {
      count += 1;
    } else if (e.type === 'CreateEvent' && e.payload.ref_type === 'branch') {
      // 빈 리포에 첫 push로 브랜치가 생길 때는 PushEvent 없이 CreateEvent만 발생한다.
      count += 1;
    }
  }
  return count;
}

function computeStreaks(days) {
  let longest = 0;
  let run = 0;
  days.forEach((d) => {
    if (d.contributionCount > 0) {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  });
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount > 0) current++;
    else break;
  }
  return { current, longest };
}

async function main() {
  const token = getToken();
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: QUERY, variables: { login: GITHUB_USERNAME } }),
  });
  if (!res.ok) {
    throw new Error(`GitHub GraphQL 요청 실패: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GitHub GraphQL 에러: ${JSON.stringify(json.errors)}`);
  }

  const cc = json.data.user.contributionsCollection;
  const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
  const { current, longest } = computeStreaks(days);
  const today = await fetchTodayCount(token, kstMidnightUTC());
  const last14 = days.slice(-14);
  if (last14.length > 0) {
    last14[last14.length - 1] = { ...last14[last14.length - 1], contributionCount: today };
  }
  const max = Math.max(1, ...last14.map((d) => d.contributionCount));

  const stats = {
    updatedAt: new Date().toISOString(),
    contributionsPastYear: cc.contributionCalendar.totalContributions,
    commits: cc.totalCommitContributions,
    pullRequests: cc.totalPullRequestContributions,
    longestStreak: longest,
    currentStreak: current,
    today,
    sparkline: last14.map((d) => ({
      count: d.contributionCount,
      heightPercent: Math.round((d.contributionCount / max) * 100),
    })),
  };

  await writeFile(DATA_PATH, JSON.stringify(stats, null, 2) + '\n', 'utf8');
  console.log('github-stats.json 갱신 완료', stats);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
