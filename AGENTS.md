<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 프로젝트: 과학과제연구 탐구 도우미

2022 개정 교육과정 과학과제연구 수업용 앱. 학생이 연구 산출물을 올리면 AI가 **넛지 피드백**을 주고
교사가 이어서 지도한다. Next.js(App Router) + Supabase + 생성형 AI(제공사 교체 가능).
설정/실행 방법은 [README.md](README.md) 참고.

## 주요 기능

- **산출물 업로드 → AI 넛지 피드백 자동 생성**: 학생이 계획서/연구 일지/중간·최종 보고서를 올리면
  업로드 직후 자동으로 피드백이 생성된다. 정답을 주지 않고 반성적 질문을 던지는 것이 핵심.
- **단계별 피드백 기준**: 계획서(현실성·변인통제·과잉확신 편향) / 결과·결론(데이터 해석·오차 분석)
  / 연구 일지(기록 구체성·계획 대비 변화·다음 행동).
- **교사 지도**: 산출물 + AI 피드백을 나란히 보고 교사 피드백 작성, 학생 공개 토글.
- **클래스·팀**: 참여 코드로 클래스 참여, 연구 과제는 개인/팀 모두 지원(팀장이 팀원 추가).
- **관리자**: 교사 계정 발급(임시 비밀번호 1회 표시), AI 설정·호출량 모니터.

## 설계상 반드시 지켜야 할 것

- **AI 프롬프트는 `lib/ai/nudge.ts` 한 곳에만 있다.** 사용자가 승인한 문안이므로 임의로 문장을
  바꾸지 말 것. 수정이 필요하면 `PROMPT_VERSION`을 올린다 — signature에 포함돼 있어 기존 피드백이
  자동으로 재생성된다.
- **별점(`rating`)은 교사 전용이다.** 학생 화면은 반드시 `student_ai_feedbacks` 뷰를 쓴다.
  `ai_feedbacks` 테이블을 학생 화면에서 직접 조회하면 RLS에 막혀 아무 것도 안 나온다.
- **AI 키는 서버 환경변수(`AI_API_KEY`)에만 둔다.** `NEXT_PUBLIC_` 접두어를 붙이면 브라우저 번들에
  키가 그대로 박힌다. 읽는 지점은 `lib/ai/serverCredential.ts` 한 곳뿐이니 우회하지 말 것.
- **공용 키라 비용이 한 곳에 몰린다.** 학생 1인당 일일 상한(`AI_DAILY_LIMIT_PER_STUDENT`)과
  signature 캐시가 방어선이다. 둘 다 제거하지 말 것.

## 아키텍처 함정 (my-webapp22에서 디버깅으로 찾아낸 것들 + 이 앱 고유)

- **Storage 키는 ASCII만 허용.** 한글 파일명을 그대로 경로에 쓰면 `StorageApiError: Invalid key`로
  실패한다. `lib/validation/fileValidation.ts`의 `sanitizeFilename()`이 처리하고, 원본 한글
  파일명은 DB `original_filename`에 따로 저장해 화면에 표시한다.
- **`insert(...).select()`는 INSERT 정책뿐 아니라 SELECT 정책도 통과해야 한다.** RETURNING이
  SELECT 정책의 적용을 받기 때문. 연구 과제 생성이 42501로 실패했던 원인이 이것이었다 —
  과제를 만든 직후에는 팀원(project_members) 행이 아직 없어서 만든 본인조차 SELECT가 막혔다.
  `0002_project_owner_access.sql`에서 소유자 조건(`owner_id = auth.uid()`)을 추가해 해결.
  "부모 행을 만들고 곧바로 자식 행으로 권한을 부여하는" 패턴을 새로 만들 때마다 이 함정을 확인할 것.
- **`language sql` 함수는 생성 시점에 본문이 검증된다.** 참조하는 테이블보다 먼저 정의하면
  `relation ... does not exist`로 마이그레이션 전체가 롤백된다. 마이그레이션 초판이 이것 때문에
  실패했었다 — 문서 관련 헬퍼(`is_teacher_of_document` 등)는 반드시 `research_documents` 생성
  이후에 둔다.
- **`supabase/config.toml`에 auth 설정을 적지 말 것.** CLI 버전마다 허용 키가 달라
  `failed to parse config: 'auth' has invalid keys`로 `db push`가 통째로 막힌다. 이메일 확인
  여부 등은 Supabase 대시보드에서 설정한다.
- **서로 참조하는 테이블의 RLS 정책은 `security definer` 함수로 감싸야 한다.** 안 그러면
  `infinite recursion detected in policy` (42P17). 이 앱에서는 `is_teacher_of_class`,
  `is_enrolled_in_class`, `is_project_member`, `is_project_owner`, `is_teacher_of_project`,
  `can_read_document` 등이 그 역할을 한다.
- **다른 역할에게 제한된 데이터를 보여주는 뷰는 `security_invoker`를 켜면 안 된다.** 켜면 학생이
  조회할 때 기저 테이블 RLS(교사만 허용)가 그대로 적용돼 아무 것도 안 보인다. 예:
  `student_ai_feedbacks`.
- **`getSession()`은 `React.cache()`로 감싸져 있다** — 레이아웃과 페이지가 각각 호출해도 요청당
  Supabase 호출은 한 번만 나간다. 이 패턴을 깨지 않도록 주의.
- **날짜/시간은 항상 `lib/datetime.ts`의 `formatKstDate/formatKstDateTime`로 표시한다.** 서버
  컴포넌트는 Vercel(UTC)에서 렌더링되므로 `timeZone: "Asia/Seoul"`을 명시하지 않으면 9시간
  어긋난다. `new Date(...).toLocaleString("ko-KR")`을 직접 쓰지 말 것.
- **서버 컴포넌트 본문에서 `Date.now()`를 직접 부르면 lint(`react-hooks/purity`)가 막는다.**
  `lib/datetime.ts`의 `daysAgoIso()`처럼 헬퍼로 분리해서 쓴다.
- **Claude Opus 5는 확장 사고가 기본으로 켜져 있고 `max_tokens`가 사고+응답을 합쳐 제한한다.**
  `lib/ai/index.ts`에서 16000으로 잡아둔 이유. 줄이면 피드백이 중간에 잘린다. 또 안전 분류기가
  거절하면 HTTP 200 + `stop_reason: "refusal"`로 오므로 `content[0]`을 그냥 읽으면 빈 피드백이
  저장된다 — `AiRefusalError`로 먼저 걸러낸다.
- **Gemini는 기본 thinking 모드가 호출당 수십 초~수 분 걸린다.** 사고량을 반드시 묶어야
  서버리스 함수 제한(504)을 넘기지 않는다. **조절 방식이 세대마다 다르다** — 2.5는
  `thinkingBudget`, 3.x부터는 `thinkingLevel`. 호출부는 `thinking: "fast" | "bounded"`로 의도만
  밝히고 변환은 `lib/ai/index.ts`의 `geminiThinkingConfig` 한 곳이 한다. 3.x에 `thinkingBudget`을
  보내면 모델마다 결과가 갈린다(3.5 Flash-Lite는 `thinkingBudget: 0`을 400으로 거절해 챗봇이
  통째로 멈췄다).
- **기본 모델은 `gemini-3.8-flash`, 한도 초과·과부하 때만 `gemini-2.5-flash`로 폴백한다**
  (`runTextWithFallback`). 무료 한도는 모델마다 따로 세서 마감 직전 몰려도 피드백이 끊기지 않는다.
  - **폴백은 용량 오류(429·503·RESOURCE_EXHAUSTED 등)에만 한다**(`isCapacityError`). 400이나
    안전 거절까지 넘기면 진짜 버그가 폴백 뒤에 숨는다. 타임아웃도 넘기지 않는다 — 기본 모델이
    오래 붙잡은 뒤라 폴백까지 기다리면 함수 제한을 넘긴다.
  - `ai_usage_log.model`과 `ai_feedbacks.model`에는 **실제로 답한 모델**을 남긴다. 폴백이 얼마나
    일어나는지는 여기서 본다. signature는 기본 모델 기준 그대로다 — 폴백본도 정상 피드백이라
    다시 만들 이유가 없다.
  - 2.5 계열은 예전에 써 본 Google 프로젝트만 쓸 수 있다. 키를 새 프로젝트로 옮기면 폴백이
    실패하므로 `AI_FALLBACK_MODEL`을 3.x 모델로 바꿀 것.
  - 유료 등급이면 3.8 Flash 가격이 2027-01-01부터 두 배가 된다.
- **업로드 실패와 피드백 실패는 분리돼 있다.** 제출 확정(`/api/documents/confirm`)과 AI 피드백
  생성(`/api/feedback/{id}`)은 **별개 요청이다.** 한 요청에서 다 하던 때는 실측 28초가 걸렸는데,
  마감 직전에 몰리면 함수가 그만큼씩 붙잡히고 플랫폼 타임아웃 시 JSON이 아닌 오류 페이지가
  돌아온다 — 산출물은 저장됐는데 학생 화면엔 실패로 보여 다시 제출하게 되고, 중복 제출과 중복
  AI 호출로 악화된다. 분리한 뒤 제출 확정까지 6초, 그 시점에 이미 목록에 나타난다.
  편의를 이유로 다시 합치지 말 것. 피드백 실패는 '다시 받기' 버튼으로 복구한다.
  - 이 때문에 **방금 올린 산출물은 피드백이 없는 상태로 목록에 먼저 나타난다.** 학생 화면의
    빈 피드백 안내를 "실패했다"고 단정해 쓰지 말 것(생성 중일 수 있다).
  - 학생 레이아웃의 AI 응답 상태 배지(`components/AiHealthBadge.tsx`)가 이 분리를 보완한다.
    최근 30분의 **응답 시간 중앙값**과 **실패율** 중 나쁜 쪽으로 원활/주의/혼잡을 매긴다.
    평균이 아니라 중앙값인 것은 긴 보고서 한 건이 전체를 나쁘게 보이게 하는 것을 막기 위함이다.
    임계값은 `lib/ai/health.ts` 한 곳에 있고 **실측이 쌓이면 조정해야 하는 잠정치다.**
    표본이 3건 미만이면 배지를 아예 감춘다 — 근거 없는 상태를 띄우지 않기 위해서다.
- **사용법 안내 챗봇은 앱 사용법만 답한다(`lib/ai/helpBot.ts`).** 탐구 내용 질문에 답하기
  시작하면 이 앱의 교육적 설계가 무너진다 — AI 탐구 조력자는 정답 대신 반성적 질문을 던지도록
  만들어져 있는데, 챗봇이 옆에서 답을 알려주면 넛지 전략이 통째로 무력해진다. 프롬프트에서
  탐구 내용 질문은 산출물 제출과 교사 쪽으로 돌려보내게 해 두었으니 이 지침을 완화하지 말 것.
  - 지식은 `lib/ai/appGuide.ts` 문자열 하나뿐이다. 벡터 검색 없이 통째로 프롬프트에 넣는다 —
    분량이 작아 그 편이 단순하고 안정적이다. **사용 설명서 PDF와 내용이 겹치므로 화면이
    바뀌면 두 곳을 함께 고칠 것.**
  - **챗봇 호출은 응답 상태 배지 집계에서 반드시 제외한다**(`kind = 'chat'`, 0006).
    사용법 안내는 1초 남짓인데 피드백 생성은 수십 초라, 섞으면 중앙값이 끌려 내려가 실제보다
    원활해 보인다. `lib/ai/health.ts`가 `draft`/`verify`만 보도록 되어 있다.
  - 상한도 피드백과 따로 센다(`AI_CHAT_DAILY_LIMIT`). 같이 쓰면 사용법 몇 번 물어보다가
    정작 산출물 피드백을 못 받는 일이 생긴다.
- **`logAiUsage`는 실패도 기록한다(0005). 성공만 남기면 지표가 거꾸로 간다** — 느려지다
  타임아웃으로 끊기는 상황에서 느린 호출이 통째로 로그에서 빠지고 빠른 성공 건만 남아 오히려
  '원활'로 보인다. 그래서 판정에 실패율을 함께 쓴다.
  - **실패 원인을 반드시 구분할 것.** `timeout`/`ai_error`만 몰림의 신호다. `refusal`은 그
    문서의 문제, `rate_limit`은 정상 동작이라 혼잡 판정의 분모에서도 뺀다 — 안 빼면 실패율이
    부풀려져 멀쩡한 상황이 '혼잡'이 된다.
  - **일일 상한은 성공한 호출만 센다**(`ok = true`). 안 그러면 제공사 장애로 실패한 날에 학생이
    자기 몫을 다 태우고 정작 피드백은 한 번도 못 받는다.
  - `config`(키 미설정)는 예약값이고 기록되지 않는다. `MissingCredentialError`는
    `getServerCredential()`에서 던져지는데 그 시점엔 provider/model을 몰라 NOT NULL 컬럼을
    채울 수 없다.
- **PowerShell로 `vercel env add`에 값을 파이프하면 BOM(U+FEFF)이 앞에 붙는다.** PS 5.1의
  `$OutputEncoding`이 BOM 포함 UTF-8이면 모든 환경변수 값이 `"﻿" + 실제값`으로 저장된다.
  증상이 고약하다 — 빌드는 성공하고 화면도 뜨지만, 로그인 시
  `Failed to read the 'headers' property from 'RequestInit': String contains non ISO-8859-1 code point`
  로 실패한다(BOM이 apikey 헤더에 들어가 fetch가 거부). 번들을 `indexOf('﻿')`로 찾아도
  안 나오는데, 미니파이된 JS에는 실제 문자가 아니라 `﻿` **이스케이프 문자열**로 들어 있기
  때문이다. 환경변수는 Vercel REST API(`POST /v10/projects/{id}/env?upsert=true`)에 UTF-8
  no-BOM 바이트로 직접 넣는 것이 안전하다.
- **로그인 실패 메시지를 뭉뚱그리지 말 것.** 위 BOM 버그를 찾는 데 오래 걸린 이유가 모든 오류를
  "이메일 또는 비밀번호가 올바르지 않습니다"로 표시했기 때문이다. 자격 증명 오류(400)만 그 문구를
  쓰고 나머지는 `error.message`를 노출한다(`app/(auth)/login/page.tsx`).
- **업로드는 브라우저 → Storage 직접 전송이다. 파일을 서버 함수로 보내지 말 것.** Vercel Node
  서버리스 함수의 요청 본문 제한이 4.5MB라 `fileValidation`의 20MB 한도보다 낮았고, 사진이 들어간
  보고서가 플랫폼 단에서 막혔다. 그래서 업로드를 3단계로 나눴다:
  `POST /api/documents/upload-url`(권한 검증 후 일회용 티켓 발급) → 브라우저가 Storage에 직접 전송
  → `POST /api/documents/confirm`(DB 등록 + AI 피드백). 편의를 이유로 다시 합치지 말 것.
  - `confirm`은 클라이언트가 보낸 경로를 믿으면 안 된다. `{uid}/{projectId}/` 접두사를 직접
    대조한다 — 안 하면 남의 파일 경로를 적어 보내 자기 산출물로 등록할 수 있다.
  - 크기는 업로드 후 Storage가 알려주는 실제 값으로 다시 검사한다. 티켓 발급 때 쓴 값은
    클라이언트가 신고한 값이라 실제와 다를 수 있다.
  - **PDF는 `confirm`에서 텍스트를 추출하지 않는다**(`extracted_text`가 null로 남는다). AI가
    원본을 통째로 보므로 쓰이지 않는데, 추출하려면 방금 올린 파일을 도로 내려받아야 해서
    4.5MB 회피의 이득을 그대로 까먹는다. docx/hwpx/txt만 내려받아 추출한다.
  - **고아 파일이 생길 수 있다.** Storage 업로드는 성공했는데 `confirm` 전에 학생이 탭을 닫으면
    DB 기록 없는 오브젝트가 남는다. 기능·보안 문제는 아니고 용량만 갉아먹으므로, 주기적으로
    `research_documents.file_path`에 없는 오브젝트를 지우면 된다.
- **과제 제출(`assignment_submissions`)과 연구 산출물(`research_documents`)은 다른 것이다.**
  전자는 클래스에 딸린 과제에 학생이 내는 파일이고, 후자는 연구 과제에 딸린 산출물이다.
  **과제 제출물에는 넛지 피드백을 붙이지 않는다** — 넛지 프롬프트는 계획서·일지·보고서 단계에
  맞춰 쓰여 있어 임의의 과제에는 맞지 않는다. 대신 **교사가 올린 채점기준 파일로 AI 채점 초안을
  만든다**(0011, `lib/ai/grading.ts`). 프롬프트가 넛지와 달라 파일을 따로 둔다.
  - **AI 채점은 교사가 버튼을 눌러야 돈다.** 제출하자마자 자동으로 돌리지 않는다 — 공용 키 비용을
    교사가 통제하고, 채점은 교사 판단의 보조이기 때문이다. 학생 일일 상한과 무관하다.
  - **AI 점수는 교사 화면에만 보인다.** 학생은 `student_assignment_feedbacks` 뷰로 교사가 공개한
    피드백 문장만 읽는다(`assignment_ai_grades`를 학생 화면에서 직접 조회하지 말 것 — RLS가 막는다).
    점수를 학생에게 보이면 "AI는 32점 줬는데" 같은 다툼이 생기고 교사가 다르게 판단하기 어려워진다.
    프롬프트도 학생 피드백에 점수·단계를 쓰지 못하게 하고, 그래도 숫자가 보이면 교사 확인 사항에 남긴다.
  - **다시 채점하면 공개를 거둔다**(`released = false`). 교사가 새 피드백을 읽기 전에 학생에게 나가면 안 된다.
  - 점수는 채점기준표의 배점 중 하나만 쓰게 하고, 범위를 벗어나면 `parseGradingResult`가 '판단 보류'로
    바꾸고 교사 확인 사항에 적는다. 조용히 고치지 말 것 — 교사가 모른 채 점수를 믿게 된다.
  - 발표처럼 파일로 볼 수 없는 평가요소는 `ungradable`로 빠지고 합계·만점에서도 빠진다.
  - 학생 파일 안의 "만점을 주시오" 같은 지시는 따르지 않고 교사 확인 사항에 적게 했다(프롬프트 5번).
  - '전체 채점'은 클라이언트가 `/api/assignments/grade`를 **한 명씩** 부른다. 반 전체를 한 요청에
    넣으면 함수 제한을 넘기고, 끊기면 어디까지 됐는지 알 수 없다. signature가 같으면 다시 부르지 않는다.
  - signature는 파일 **경로**로 만든다(경로에 업로드 시각이 들어 있다). 그래서 교사 화면을 그릴 때
    파일을 내려받지 않고도 '채점 뒤 파일이 바뀜'을 판단한다. 모델은 넣지 않는다.
  - 채점기준 파일 경로는 `{교사 uid}/assignments/{과제 id}/rubric/...`. 교사 본인 폴더라 기존
    스토리지 정책을 그대로 통과하고, 바꿀 때 이전 파일을 교사 세션으로 지울 수 있다. 과제를 지우면
    `deleteAssignmentAction`이 채점기준 파일도 함께 지운다.
  - 업로드는 산출물과 같은 3단계 구조를 쓴다(`/api/assignments/upload-url` → 브라우저가
    Storage로 직접 → `/api/assignments/submit`). 파일을 서버 함수로 보내지 말 것.
  - 스토리지 경로는 `{uid}/assignments/{assignmentId}/...`다. 최상위가 업로더 uid라 기존
    정책(`research_files_owner_all`)을 그대로 통과한다 — 정책을 새로 만들지 않았다.
  - **제출물 1건에 파일 여러 개**다(0009). `assignment_submissions`(학생당 1건, 메모·제출시각)
    아래에 `assignment_submission_files`가 달린다. 처음에는 제출물 행이 곧 파일 하나였는데,
    파일을 여러 개 받으려고 쪼갰다 — 기존 8건은 마이그레이션에서 그대로 옮겼다.
  - **파일을 전부 지우면 제출물 행도 지운다**(`deleteSubmissionFileAction`). 파일 0개짜리
    제출물이 남으면 목록에 '제출 완료'로 뜨는데 실제로 낸 것은 없는 상태가 된다.
  - 0009는 **컬럼을 지우지 않고 NOT NULL만 풀었다.** 배포 직전 몇 초 동안 옛 코드가 돌 때
    제출이 깨지지 않게 하기 위해서다 — 실제 학생이 쓰는 중이라 그 창을 만들면 안 된다.
    컬럼 삭제는 배포 확인 후 0010에서 한다.
  - 교사가 과제를 지울 때 학생 파일 삭제에는 service-role이 필요하다. 스토리지 정책이
    업로더 본인 폴더만 허용해서 교사 세션으로는 지울 수 없다.
  - 마감(`due_at`)은 제출을 막지 않는다. 화면에 '마감 지남'·'지각 제출'로만 표시한다 —
    사정이 있는 학생을 코드로 잘라내는 것보다 교사가 보고 판단하는 편이 낫다.
  - `datetime-local` 입력은 타임존이 없다. `+09:00`을 붙여 KST로 해석해 저장한다.
    그냥 `new Date()`에 넣으면 서버(UTC) 기준으로 읽혀 9시간 어긋난다.
- **사용 설명서 PDF를 `public/`에 두지 말 것.** public은 로그인 없이 열리므로 '선생님용은
  선생님만'이라는 조건을 지킬 수 없다. 실물은 `guides/`에 있고 `/api/guide/{audience}`가
  역할을 확인하고 내려준다. 누가 무엇을 볼 수 있는지는 `lib/guides.ts` 한 곳에 있다.
  - **`next.config.ts`의 `outputFileTracingIncludes`에서 `guides/`를 빼지 말 것.** 코드가
    PDF를 import하지 않아 추적에 잡히지 않는다. 빠지면 로컬은 멀쩡하고 운영에서만 실패한다.
  - 출력이 `docs/`가 아니라 `guides/`인 이유는 `.vercelignore`가 `docs`를 통째로 빼기
    때문이다. 파일 이름을 ASCII로 둔 것도 의도된 것이고, 내려받을 때 보이는 한글 이름은
    라우트가 `Content-Disposition`으로 붙인다.
  - 설명서는 `docs/guide/guide.html` **한 벌**에서 장을 골라 두 벌(학생용·선생님용)로
    인쇄한다(`render.mjs`). HTML을 둘로 쪼개면 공통 장(시작하기·자주 묻는 것)이 양쪽에
    복사돼 한쪽만 고치는 일이 생긴다. `guides/*.pdf`는 생성물이지만 커밋한다 — 빌드 때
    다시 만들 수 없다(Chrome이 필요하다).
- **이름 표시는 빈 문자열도 처리한다.** `display_name`이 `""`인 계정이 있어 `?? "(이름 없음)"`은
  빈 줄로 렌더링된다. `?.trim() || "(이름 없음)"`로 걸러야 한다.

## my-webapp22에서 의도적으로 뺀 것

문제은행/적응형 문제풀이(CAT) 전체, quiz 기반 학습 분석, 문항 그림 크롭(pdf.js), 평가계획 PDF
가져오기 위저드, 세특 생성, 교사별 API 키 등록(공용 키로 대체). 점수는 2026-10에 '교사가 올린
채점기준으로 만드는 AI 채점 초안'으로 다시 들어왔다(위 과제 제출 항목 참고). 되살릴 일이 생기면
`C:\Users\rune_\my-webapp22`를 참고할 것.

## 민감한 실제 파일로 테스트할 때

사용자가 실제 학교 파일 경로를 공유하며 테스트를 요청하면 **`public/`에 절대 복사하지 않는다**
(배포되면 공개됨). 대신 `127.0.0.1`에 바인딩된 임시 Node http 서버로 그 파일 하나만 서빙하고,
브라우저에서 `fetch()`로 가져와 테스트한 뒤 서버를 종료하고 임시 스크립트를 삭제한다.
