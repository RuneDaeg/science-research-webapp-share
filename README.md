# 과학과제연구 탐구 도우미

2022 개정 교육과정 **과학과제연구** 수업용 웹앱. 학생이 연구 계획서·연구 일지·중간/최종 보고서를
올리면 **AI 탐구 조력자**가 정답 대신 넛지(Nudge) 피드백을 주고, 담당 선생님이 학생 산출물과 AI
피드백을 함께 보며 지도 피드백을 남긴다.

Next.js 16(App Router) + Supabase(Postgres/Auth/Storage) + 생성형 AI(Gemini / OpenAI / Claude 중 택 1).

---

## 핵심 개념

```
클래스 (선생님이 개설, 참여 코드로 학생 참여)
 └─ 연구 과제 research_projects  (개인 또는 팀)
      ├─ 팀원 project_members
      └─ 산출물 research_documents  (계획서 / 연구 일지 n회차 / 중간·최종 보고서)
            ├─ AI 넛지 피드백 ai_feedbacks     (업로드 직후 자동 생성)
            └─ 선생님 피드백 teacher_feedbacks (공개/비공개 토글)
```

- **AI 피드백은 넛지 전략**을 따른다. 정답을 알려주지 않고 반성적 질문을 던지며, 단계별로 다른
  기준(계획서=현실성·변인통제·과잉확신 / 결과·결론=데이터 해석·오차 분석 / 일지=기록 구체성·계획
  대비 변화·다음 행동)을 적용한다. 프롬프트 전문은 `lib/ai/nudge.ts`.
- **AI 자기평가 별점(`[Rating: ★★★★★]`)은 선생님에게만 보인다.** 학생은 별점이 제거된
  `student_ai_feedbacks` 뷰로 피드백을 읽는다.
- 별점이 낮으면 선생님이 **2단계 검증(팩트체크 재작성)** 을 다시 돌릴 수 있다.

## 시작하기

### 1. 의존성 설치

```bash
npm install
```

### 2. Supabase 프로젝트 준비

1. https://supabase.com/dashboard 에서 프로젝트를 만든다.
2. Project Settings → API 에서 URL / anon key / service_role key를 복사한다.
3. `.env.local.example`을 `.env.local`로 복사해 값을 채운다.

```bash
cp .env.local.example .env.local
```

### 3. 스키마 적용

Supabase CLI로 적용하거나(권장), 대시보드 SQL Editor에 `supabase/migrations/0001_init.sql`을
그대로 붙여넣어 실행한다.

```bash
npx supabase link --project-ref <프로젝트 ref>
npx supabase db push
```

`.env.local`에 `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`가 있어야 CLI가 동작한다.
마이그레이션 파일은 새 번호로 계속 추가만 하고(`0002_...`), 이미 적용된 파일은 수정하지 않는다.

### 4. 생성형 AI 키 설정

`.env.local`에서 제공사와 키를 지정한다. **서버 공용 키 1개**를 전교가 함께 쓰는 구조다.

```bash
AI_PROVIDER=gemini        # gemini | openai | anthropic
AI_API_KEY=...            # NEXT_PUBLIC_ 접두어를 절대 붙이지 말 것
AI_MODEL=                 # 비우면 제공사 기본 모델
AI_FALLBACK_MODEL=        # 기본 모델이 한도 초과·과부하일 때 쓸 모델 (비우면 제공사 기본값)
AI_DAILY_LIMIT_PER_STUDENT=15   # 학생 1인당 하루 피드백 생성 횟수 (미설정 시 15)
AI_CHAT_DAILY_LIMIT=30          # 1인당 하루 사용법 도우미 질문 횟수 (미설정 시 30)
```

제공사별 기본 모델: `gemini-3.8-flash` / `gpt-4o` / `claude-opus-5`.
Gemini는 한도 초과·과부하일 때 `gemini-2.5-flash`로 폴백한다(다른 제공사는 기본 폴백 없음).

### 5. 첫 관리자 만들기

관리자가 없으면 교사 계정을 발급할 수 없으므로 최초 1회 부트스트랩이 필요하다.

1. `/signup`에서 관리자로 쓸 계정을 학생으로 가입한다.
2. Supabase 대시보드 SQL Editor에서 그 계정을 admin으로 승격한다.

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = '관리자이메일@example.com');
```

> `profiles.role` 변경은 service_role만 허용된다(트리거 `prevent_role_change`). 대시보드 SQL
> Editor는 service_role 권한으로 실행되므로 위 쿼리가 통과한다.

이후 관리자는 `/admin`에서 교사 계정을 발급한다(임시 비밀번호 1회 표시).

### 6. 실행

```bash
npm run dev
```

## 사용 흐름

| 역할 | 흐름 |
|---|---|
| 관리자 | `/admin` → 교사 계정 발급, AI 설정·호출량 확인 |
| 선생님 | 클래스 만들기 → 참여 코드 배포 → 공지 → 학생 산출물과 AI 피드백 확인 → 지도 피드백 작성 |
| 학생 | 참여 코드로 클래스 참여 → 연구 등록(팀원 추가) → 산출물 업로드 → AI 피드백 즉시 확인 → 선생님 피드백 확인 |

## 지원 파일 형식

`pdf`, `docx`, `hwpx`, `txt` (최대 20MB).

- **PDF는 텍스트 추출이 아니라 원본을 통째로 AI에 보낸다** — 표·그래프·사진까지 피드백에
  반영하기 위함.
- docx/hwpx/txt는 `lib/extraction/`의 텍스트 추출을 사용한다(AI가 이 포맷들의 네이티브 비전
  인식을 지원하지 않음).
- `.hwp`는 지원하지 않는다. 한글에서 `.hwpx`로 저장해 올려야 한다.

## 보안 설계

- 신규 가입은 트리거가 **항상 `student`로 강제**한다. 교사·관리자는 service_role로만 승격된다.
- 모든 테이블에 RLS가 걸려 있고, 상호 참조하는 정책은 `security definer` 함수로 감싸 무한 재귀
  (42P17)를 피한다.
- 산출물 파일은 비공개 버킷에 저장되고, 열람은 서버가 DB로 권한을 검증한 뒤 발급하는 signed URL
  (120초)로만 가능하다.
- AI 키는 서버 환경변수에만 있고 DB·브라우저로 내려가지 않는다.

## 다른 컴퓨터에서 이어서 작업하기

`.env.local`은 키가 들어 있어 저장소에 올리지 않는다(`.gitignore`). 새 컴퓨터에서는 아래 순서를
따른다.

```bash
git clone https://github.com/RuneDaeg/science-research-webapp.git
cd science-research-webapp
npm install
```

그다음 환경변수를 채운다. Vercel에 이미 등록해 두었으므로 CLI로 내려받는 것이 가장 빠르다.

```bash
npx vercel link
npx vercel env pull .env.local
```

`vercel env pull`은 Vercel에 등록된 값만 가져오므로, 로컬에서 마이그레이션까지 돌리려면
`SUPABASE_ACCESS_TOKEN`과 `SUPABASE_DB_PASSWORD` 두 줄은 직접 추가해야 한다(이 둘은 로컬 CLI
전용이라 Vercel에는 올리지 않았다). 값은 Supabase 대시보드에서 다시 발급할 수 있다.

> ⚠️ **Windows PowerShell에서 환경변수를 파이프로 등록하지 말 것.** `"값" | vercel env add ...`
> 형태로 넣으면 PS 5.1이 값 앞에 BOM(U+FEFF)을 붙여, 빌드는 성공하지만 로그인이
> `String contains non ISO-8859-1 code point`로 실패한다. 자세한 내용은 AGENTS.md 참고.

마이그레이션은 이미 원격 DB에 적용돼 있으므로 새로 받은 컴퓨터에서 다시 push할 필요는 없다.
새 마이그레이션을 추가했을 때만 `npx supabase link` → `npx supabase db push`를 실행한다.

## 배포

```bash
npx vercel --prod
```

GitHub 연동이 걸려 있지 않으므로 `git push`만으로는 배포되지 않는다. 위 명령을 직접 실행해야 한다.

서버리스 함수 리전은 `vercel.json`에서 `icn1`(서울)로 고정돼 있다 — 사용자가 한국에 있으므로
사용자와 함수 사이의 왕복이 가장 짧아진다. Supabase 운영 프로젝트는 `ap-southeast-2`(시드니)라
함수와 DB 사이에는 여전히 거리가 있는데, Supabase 리전은 프로젝트를 새로 만들어 데이터를
옮기지 않는 한 바꿀 수 없어 그대로 두었다.

환경변수는 Vercel 프로젝트 설정에 동일하게 등록해야 한다. 현재는 Production 스코프에만 있으므로
`vercel env pull`로 받을 때 `--environment=production`을 붙여야 값이 채워진다.

## 라이선스

[MIT](LICENSE). 다른 학교에서도 자유롭게 고쳐 쓸 수 있다. 다만 운영하려면 Supabase 프로젝트와
생성형 AI 키를 각자 마련해야 한다(위 설정 순서 참고). 학생 데이터는 이 저장소에 들어 있지 않다.
