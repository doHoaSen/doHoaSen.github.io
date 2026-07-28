# doHoaSen.github.io

강수연(doHoaSen)의 개인 개발자 포트폴리오. [dohoasen.github.io](https://dohoasen.github.io)

신문/영수증 모티프의 흑백(achromatic) 디자인으로, 실제 GitHub 활동·Velog 글·프로젝트 데이터를 자동으로 동기화해서 보여주는 정적 사이트입니다.

## Stack

- [Astro](https://astro.build) (정적 사이트 빌드)
- Pretendard(한글) + Parisienne(포인트 스크립트체)
- GitHub Actions (데이터 동기화·배포 자동화)
- GitHub GraphQL API, Velog RSS

## 실데이터 원칙

이 사이트에 나오는 프로젝트 목록, GitHub 활동 통계, Velog 글, 방문자 수는 전부 실제 데이터입니다. 더미/가짜 값은 쓰지 않는다는 원칙으로 만들었습니다.

- `scripts/sync-velog.mjs` — Velog RSS + 글 페이지 HTML에서 실제 글/태그를 가져와 `src/data/velog-posts.json` 갱신
- `scripts/sync-github-stats.mjs` — GitHub GraphQL로 실제 기여 통계를 가져와 `src/data/github-stats.json` 갱신
- `.github/workflows/sync-velog.yml` — 위 두 스크립트를 3시간마다 자동 실행, 변경 있을 때만 커밋
- `.github/workflows/deploy.yml` — 커밋(수동 push 또는 동기화 완료)이 생기면 자동 빌드·배포

## 이 프로젝트는 어떻게 만들어졌나

기획·디자인 결정, 데이터 검증, 버그 진단은 제가 직접 했고, 실제 구현은 Claude Code(AI 코딩 에이전트)와 함께 작업했습니다. AI가 짠 코드를 그대로 받아쓴 게 아니라, 매 단계마다 실제로 눈으로 확인하고 검증하는 과정에서 아래와 같은 문제들을 직접 잡아냈습니다.

- Velog 동기화 스크립트가 사람이 손으로 채워둔 시리즈 정보를 매번 초기화하던 버그 → 병합 키를 `id`에서 안정적인 `url`로 바꿔서 해결
- 최신 `@astrojs/sitemap` 버전이 이 Astro 버전과 호환되지 않아 빌드가 깨지던 문제 → 실제로 빌드해보고 이전 버전으로 다운그레이드
- "새로고침하면 GitHub 활동이 바로 반영되는 구조 아니냐"는 질문에서 출발해, 데이터 동기화는 성공해도 `GITHUB_TOKEN`으로 만든 커밋은 배포 워크플로우를 트리거하지 않아 실제로는 사이트에 절대 반영되지 않던 구조적 버그를 진단하고 수정

과정을 만들면서 겪은 문제와 해결 과정은 `docs/`(개인 기록용, 저장소엔 비공개)에 상세히 남겨두고 있고, 일부는 Velog에도 정리해서 올릴 예정입니다.
