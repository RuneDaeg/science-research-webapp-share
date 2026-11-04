import Link from "next/link";

export const metadata = { title: "개인정보처리방침 — 과학과제연구 탐구 도우미" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
      <h1 className="text-2xl font-bold text-gray-900">개인정보처리방침</h1>
      <p className="mt-2 text-sm text-gray-500">
        이 서비스는 학교 수업(과학과제연구) 운영을 위한 내부용 도구입니다.
      </p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-gray-700">
        <section className="space-y-2">
          <h2 className="text-base font-semibold text-gray-900">1. 수집하는 항목</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>계정 정보: 이메일, 이름(표시 이름), 비밀번호(암호화 저장)</li>
            <li>학습 정보: 소속 클래스, 연구 과제 정보, 업로드한 산출물 파일과 그 텍스트</li>
            <li>피드백 기록: AI가 생성한 피드백, 선생님이 작성한 피드백</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-gray-900">2. 이용 목적</h2>
          <p>
            제출한 산출물에 대한 탐구 피드백 제공, 담당 선생님의 지도와 확인, 서비스 운영 및 남용
            방지에만 이용합니다.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-gray-900">3. 생성형 AI 처리</h2>
          <p>
            피드백 생성을 위해 업로드한 산출물의 내용이 학교가 지정한 생성형 AI 제공사(Google
            Gemini / OpenAI / Anthropic 중 설정된 1곳)로 전송됩니다. 프롬프트에는 학생의 이름·학교
            등 개인정보를 포함하지 않으며, AI에게도 개인정보를 언급하거나 학습에 활용하지 않도록
            지시합니다. 다만 산출물 본문에 이름을 직접 적으면 그 내용은 함께 전송되므로, 산출물에
            불필요한 개인정보를 적지 않는 것을 권장합니다.
          </p>
          <p>
            선생님이 과제 · 평가의 AI 채점을 실행하면 그 과제의 채점기준 파일과 학생 제출 파일도 같은
            방식으로 전송됩니다. AI가 만든 점수는 선생님만 볼 수 있는 참고용이며, 최종 점수는 선생님이
            정합니다.
          </p>
          <p>
            화면 오른쪽 아래 &lsquo;사용법 도우미&rsquo;에 입력한 질문도 같은 제공사로 전송됩니다.
            대화 내용은 저장하지 않으며 화면을 새로 고치면 사라집니다. 이 도우미는 앱 사용
            방법만 안내하므로 질문에 개인정보를 적지 마세요.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-gray-900">4. 열람 범위</h2>
          <p>
            업로드한 산출물과 피드백은 같은 팀의 팀원과 담당 선생님만 볼 수 있습니다. 다른 반이나
            다른 팀 학생은 접근할 수 없습니다. AI 피드백의 자기평가 별점은 선생님에게만 표시됩니다.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-gray-900">5. 보관 및 파기</h2>
          <p>
            수업 운영 기간 동안 보관하며, 학교의 요청이나 수업 종료 시 관리자가 삭제합니다. 학생은
            본인이 올린 산출물을 직접 삭제할 수 있습니다.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-gray-900">6. 문의</h2>
          <p>담당 선생님 또는 학교 관리자에게 문의해주세요.</p>
        </section>
      </div>

      <Link href="/" className="mt-10 inline-block text-sm font-medium text-gray-900 underline">
        돌아가기
      </Link>
    </div>
  );
}
