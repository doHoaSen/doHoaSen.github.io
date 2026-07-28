#!/usr/bin/env node
// Velog RSS를 읽어 src/data/velog-posts.json을 갱신한다.
// GitHub Actions에서 주기적으로(또는 수동으로) 실행된다.

import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const VELOG_USERNAME = 'tnfdus';
const RSS_URL = `https://v2.velog.io/rss/@${VELOG_USERNAME}`;
const DATA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/data/velog-posts.json'
);
const KEEP_COUNT = 7;

function stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugFromUrl(url) {
  const last = decodeURIComponent(url.split('/').pop() ?? '');
  return (
    last
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'post'
  );
}

function estimateReadStats(rawDescription) {
  const plain = stripHtml(rawDescription);
  const characters = plain.length;
  const codeBlocks = (rawDescription.match(/<pre/g) ?? []).length;
  const minRead = Math.max(1, Math.round(characters / 550));
  return {
    minRead,
    characters: characters >= 1000 ? `${Math.round(characters / 1000)}K` : String(characters),
    codeBlocks,
  };
}

function parseRssItems(xml) {
  return xml
    .split('<item>')
    .slice(1)
    .map((chunk) => chunk.split('</item>')[0]);
}

function extract(pattern, text) {
  return (text.match(pattern) ?? [])[1] ?? '';
}

const MAX_TAGS = 3;

// Velog 글 페이지는 서버사이드 렌더링되기 때문에, 브라우저 없이 fetch()만으로도
// 실제 태그(<a href="https://velog.io/tags/...">)를 그대로 읽어올 수 있다.
async function fetchTags(postUrl) {
  try {
    const res = await fetch(postUrl);
    if (!res.ok) return [];
    const html = await res.text();
    const matches = [...html.matchAll(/href="https:\/\/velog\.io\/tags\/([^"]+)"/g)];
    const tags = [...new Set(matches.map((m) => decodeURIComponent(m[1])))];
    return tags.slice(0, MAX_TAGS);
  } catch {
    return [];
  }
}

async function main() {
  const res = await fetch(RSS_URL);
  if (!res.ok) {
    throw new Error(`Velog RSS 요청 실패: ${res.status}`);
  }
  const xml = await res.text();
  const items = parseRssItems(xml).slice(0, KEEP_COUNT);

  let previous = [];
  try {
    previous = JSON.parse(await readFile(DATA_PATH, 'utf8'));
  } catch {
    // 첫 실행이면 기존 파일이 없을 수 있음 - 무시
  }
  // URL은 Velog가 부여하는 안정적인 고유값이라 병합 키로 사용한다.
  // (id는 사람이 손으로 짧게 바꿔둘 수 있어 매번 슬러그가 달라질 수 있음)
  const previousByUrl = new Map(previous.map((p) => [p.url, p]));

  const posts = await Promise.all(
    items.map(async (item, index) => {
      const rawTitle = extract(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/, item);
      const url = extract(/<link>([\s\S]*?)<\/link>/, item);
      const pubDate = extract(/<pubDate>([\s\S]*?)<\/pubDate>/, item);
      const descRaw = extract(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/, item);
      const plain = stripHtml(descRaw);
      const publishedAt = new Date(pubDate).toISOString().slice(0, 10);

      const prev = previousByUrl.get(url);
      // RSS의 title에는 "[말머리]"가 그대로 남아있는데, 실제 사이트에서는 떼고 보여준다.
      const title = rawTitle.replace(/^\[([^\]]+)\]\s*/, '');
      const tags = await fetchTags(url);

      const base = {
        id: prev?.id ?? slugFromUrl(url),
        title,
        url,
        publishedAt,
        tags,
        description: plain.slice(0, 120),
        isLead: index === 0,
      };

      // series/relatedProjectId는 Velog 페이지에서 자동으로 안정적으로 추출하기 어려운 정보라
      // (클라이언트 사이드에서만 렌더링됨) 이전에 사람이 채워둔 값을 그대로 유지한다.
      const enriched = {
        ...base,
        series: prev?.series ?? '',
        ...(prev?.relatedProjectId ? { relatedProjectId: prev.relatedProjectId } : {}),
      };

      if (index === 0) {
        enriched.stats = estimateReadStats(descRaw);
      }

      return enriched;
    })
  );

  await writeFile(DATA_PATH, JSON.stringify(posts, null, 2) + '\n', 'utf8');
  console.log(`velog-posts.json 갱신 완료 (${posts.length}개 글)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
