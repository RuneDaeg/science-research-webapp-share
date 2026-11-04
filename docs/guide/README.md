# 사용 설명서 만들기

`guides/guide-student.pdf`(학생용)와 `guides/guide-teacher.pdf`(선생님용)를 다시 만드는 방법.
화면이 바뀌었을 때만 돌리면 된다.

두 벌 모두 `guide.html` **한 벌**에서 나온다. `render.mjs`가 역할 배지(`.role`)를 보고 장을
골라 인쇄한다 — 배지가 없는 장(시작하기 · 자주 묻는 것)은 양쪽 모두에 들어간다.

출력이 `docs/`가 아니라 저장소 루트의 `guides/`인 것은 `.vercelignore`가 `docs`를 통째로
빼기 때문이다. 앱이 `/api/guide/{audience}`로 내려주므로 배포본에 들어가야 한다.
**PDF는 생성물이지만 커밋한다** — 빌드 서버에는 Chrome이 없어 다시 만들 수 없다.

```
guide.html         설명서 본문 (내용을 고칠 곳)
capture.mjs        실제 사이트에 로그인해 스크린샷을 찍는다 → shots/01~10
capture-badge.mjs  AI 응답 상태 배지 3종을 찍는다 → shots/11~13 (아래 주의사항 참고)
capture-delete.mjs 연구 과제 삭제 화면 2종을 찍는다 → shots/14~15 (아래 주의사항 참고)
capture-assignment.mjs 과제/평가 화면 5종을 찍는다 → shots/16~20 (아래 주의사항 참고)
capture-grading.mjs 과제 AI 채점 화면 4종을 찍는다 → shots/21~24 (아래 주의사항 참고)
render.mjs         guide.html을 대상별 A4 PDF 두 벌로 인쇄한다 → guides/
shots/             캡처된 화면 (커밋되어 있으므로 캡처 없이 PDF만 다시 만들 수 있다)
```

## 준비

Chrome이 설치되어 있어야 한다. 번들 브라우저를 내려받지 않는 `puppeteer-core`를 쓴다.
앱 자체와는 무관한 문서용 도구라 `package.json`에는 넣지 않았다.

```bash
npm install --no-save puppeteer-core
```

Chrome이 기본 경로에 없으면 `CHROME_PATH`로 지정한다.

## 내용만 고칠 때

`guide.html`을 수정하고 인쇄만 다시 하면 된다. 스크린샷은 `shots/`에 있는 것을 그대로 쓴다.

```bash
node docs/guide/render.mjs
```

## 화면이 바뀌어 스크린샷도 다시 찍을 때

`capture.mjs`는 배포된 사이트에 실제로 로그인한다. 계정 정보는 환경변수로 넘긴다 —
테스트 계정이라도 비밀번호를 저장소에 두지 않기 위해서다.

```bash
GUIDE_TEACHER_EMAIL=... GUIDE_TEACHER_PASSWORD=... \
GUIDE_STUDENT_EMAIL=... GUIDE_STUDENT_PASSWORD=... \
GUIDE_PROJECT_ID=<연구 과제 id> \
node docs/guide/capture.mjs && node docs/guide/render.mjs
```

PowerShell에서는 `$env:GUIDE_TEACHER_EMAIL = "..."` 형태로 먼저 설정한 뒤 실행한다.

`GUIDE_PROJECT_ID`는 **산출물이 올라와 있고 AI 피드백이 붙은** 연구 과제여야 한다.
비어 있는 과제를 쓰면 피드백 스크린샷이 빈 화면으로 찍힌다.

## AI 응답 상태 배지 (shots/11~13)

이 배지는 최근 30분의 실제 호출 기록이 있어야 화면에 뜨므로 평상시에는 세 등급을 찍을 수 없다.
`capture-badge.mjs`가 `ai_usage_log`에 임시 행을 넣어 상태를 만든 뒤 찍고 지운다.
**운영 DB에 쓰기가 발생하므로** 배지 디자인이 바뀌었을 때만 돌린다.

```bash
GUIDE_STUDENT_EMAIL=... GUIDE_STUDENT_PASSWORD=... node docs/guide/capture-badge.mjs
```

중간에 강제 종료되면 임시 행이 남는다. 그럴 때는 `ai_usage_log`에서
`model = 'guide-badge-temp'`인 행을 지우면 된다. 서비스 키는 `.env.local`에서 읽는다.

## 연구 과제 삭제 화면 (shots/14~15)

삭제 확인 상자와 '선생님 피드백이 있어 삭제 불가' 안내는 각각 특정한 데이터가 있어야 나타난다.
`capture-delete.mjs`가 임시 과제를 만들어 앞을 찍고, 선생님 피드백을 붙여 뒤를 찍은 뒤 지운다.
**운영 DB에 쓰기가 발생하므로** 해당 화면이 바뀌었을 때만 돌린다.

```bash
GUIDE_STUDENT_EMAIL=... GUIDE_STUDENT_PASSWORD=... GUIDE_TEACHER_EMAIL=... node docs/guide/capture-delete.mjs
```

중간에 강제 종료되면 제목이 `[캡처용]`으로 시작하는 과제와 그 파일이 남는다.

## 과제 · 평가 화면 (shots/16~20)

교사 목록·제출 현황·학생 목록·제출 화면·파일 목록 다섯 가지다. 모두 실제 과제와 제출물이 있어야
나타나므로 `capture-assignment.mjs`가 임시 과제와 제출물을 만들었다 지운다.
**운영 DB에 쓰기가 발생하므로** 해당 화면이 바뀌었을 때만 돌린다.

```bash
GUIDE_STUDENT_EMAIL=... GUIDE_STUDENT_PASSWORD=... \
GUIDE_TEACHER_EMAIL=... GUIDE_TEACHER_PASSWORD=... \
node docs/guide/capture-assignment.mjs
```

중간에 강제 종료되면 제목이 `[캡처용]`으로 시작하는 과제와 그 제출 파일이 남는다.

## 과제 AI 채점 화면 (shots/21~24)

채점기준 칸·채점 결과·학생별 모아 보기·학생에게 공개된 피드백 네 가지다. 채점기준 파일과
채점 결과가 있어야 나타나므로 `capture-grading.mjs`가 임시 과제·채점기준·제출물을 만들고,
교사 화면에서 'AI 채점하기'를 실제로 눌러 찍은 뒤 지운다. **운영 DB에 쓰기가 발생하고 공용 키로
AI 채점을 한 번 돌리므로** 해당 화면이 바뀌었을 때만 돌린다. 채점기준은 스크립트 안의 예시를
쓴다 — 실제 학교 평가 계획서를 저장소에 넣지 않기 위해서다.

```bash
GUIDE_STUDENT_EMAIL=... GUIDE_STUDENT_PASSWORD=... \
GUIDE_TEACHER_EMAIL=... GUIDE_TEACHER_PASSWORD=... \
node docs/guide/capture-grading.mjs
```

중간에 강제 종료되면 제목이 `[캡처용]`으로 시작하는 과제와 그 파일이 남는다.

## 주의 — 스크린샷에 실제 학생 정보가 들어가지 않게

`capture.mjs`는 화면을 그대로 찍기 때문에 **파일명·이름이 그대로 노출된다.**
실제 학생이 올린 산출물이 있는 과제를 쓰면 그 학생의 이름이 배포용 문서에 박힌다.
반드시 테스트 계정이 올린 산출물만 있는 과제를 지정할 것.
