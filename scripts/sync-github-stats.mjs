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
  const last14 = days.slice(-14);
  const max = Math.max(1, ...last14.map((d) => d.contributionCount));
  const today = days[days.length - 1];

  const stats = {
    updatedAt: new Date().toISOString(),
    contributionsPastYear: cc.contributionCalendar.totalContributions,
    commits: cc.totalCommitContributions,
    pullRequests: cc.totalPullRequestContributions,
    longestStreak: longest,
    currentStreak: current,
    today: today?.contributionCount ?? 0,
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
