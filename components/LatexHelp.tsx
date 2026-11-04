import FeedbackMarkdown from "./FeedbackMarkdown";

// 선생님 피드백 입력칸 아래에 붙는 작성 도움말.
//
// 선생님이 쓴 피드백은 학생 화면에서 마크다운·LaTeX로 렌더링되는데, 입력칸은 평범한
// textarea라 결과를 미리 볼 수 없다. 그래서 예시의 '결과' 열을 설명 문구가 아니라 실제
// 렌더링 결과로 보여준다 — 학생 화면에 나올 모습 그대로다.
//
// 서버 컴포넌트로 두는 것이 중요하다. 클라이언트 컴포넌트에서 import하면 react-markdown과
// KaTeX가 통째로 클라이언트 번들에 실려버린다.

interface Example {
  source: string;
  note?: string;
}

interface Section {
  title: string;
  examples: Example[];
}

// 고등학교 과학 피드백에서 실제로 손이 가는 것만 모았다. 항목을 늘릴 때도 '이걸 모르면
// 결과가 깨지는가'를 기준으로 고른다 — 목록이 길어지면 아무도 안 읽는다.
const SECTIONS: Section[] = [
  {
    title: "기본",
    examples: [
      { source: "속도는 $v = \\dfrac{s}{t}$ 입니다.", note: "문장 안에 넣기" },
      { source: "$$E_k = \\tfrac{1}{2}mv^2$$", note: "줄을 바꿔 크게 보여주기" },
    ],
  },
  {
    title: "첨자 · 분수 · 근호",
    examples: [
      { source: "$v_0$, $x^2$, $\\mathrm{H_2O_2}$" },
      { source: "$v_{max}$, $10^{-3}$", note: "두 글자 이상이면 중괄호로 묶기" },
      { source: "$\\dfrac{a}{b}$, $\\sqrt{2}$, $\\sqrt[3]{8}$" },
      { source: "$\\bar{x}$, $\\vec{v}$", note: "평균값, 벡터" },
    ],
  },
  {
    title: "띄어쓰기와 글자",
    examples: [
      {
        source: "$25\\,^\\circ\\mathrm{C}$",
        note: "\\, 는 좁은 공백. 숫자와 단위 사이에 쓴다",
      },
      { source: "$a \\quad b$, $a \\qquad b$", note: "더 넓은 공백" },
      {
        source: "$v = 3\\ \\mathrm{m/s}$",
        note: "역슬래시+스페이스는 보통 공백. 수식 안에서 그냥 띄어쓰기는 무시된다",
      },
      {
        source: "$E_k = \\text{운동 에너지}$",
        note: "수식 안에 한글이나 단어를 넣을 때. 안 감싸면 글자가 다 벌어진다",
      },
      {
        source: "$\\mathrm{kg}$ vs $kg$",
        note: "단위는 \\mathrm 으로 세워 쓴다. 그냥 쓰면 기울어져 변수처럼 보인다",
      },
    ],
  },
  {
    title: "기호",
    examples: [
      { source: "$\\Delta T$, $\\alpha$, $\\beta$, $\\lambda$, $\\pi$, $\\theta$" },
      { source: "$\\le$, $\\ge$, $\\ne$, $\\approx$, $\\propto$" },
      { source: "$\\pm 0.5$, $\\times 10^{3}$, $\\div$, $\\cdot$" },
      { source: "$\\rightarrow$, $\\rightleftharpoons$", note: "반응식 화살표, 가역 반응" },
      { source: "$\\sum$, $\\infty$, $\\therefore$" },
    ],
  },
  {
    title: "마크다운 서식",
    examples: [
      // 소제목과 목록은 줄 맨 앞에 와야 서식이 적용된다. 한 줄에 몰아 쓰면 기호가 그대로
      // 보이므로, 예시도 실제로 쓸 형태 그대로 여러 줄로 둔다.
      {
        source: "### 소제목\n\n**굵게** 쓰기\n\n- 목록 항목\n- 목록 항목",
        note: "소제목과 목록은 줄 맨 앞에서 시작",
      },
    ],
  },
];

function ExampleTable({ examples }: { examples: Example[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <tbody>
          {examples.map((ex) => (
            <tr key={ex.source} className="align-top">
              <td className="w-1/2 border-b border-blue-100 py-1.5 pr-3">
                <code className="font-mono break-all whitespace-pre-wrap">{ex.source}</code>
                {ex.note && <p className="mt-0.5 text-blue-600">{ex.note}</p>}
              </td>
              <td className="border-b border-blue-100 py-1.5">
                <FeedbackMarkdown className="text-blue-950">{ex.source}</FeedbackMarkdown>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LatexHelp() {
  return (
    <details className="rounded-md border border-blue-200 bg-white/60 px-3 py-2 text-blue-900">
      <summary className="cursor-pointer text-xs font-medium select-none">
        수식·서식 쓰는 법 (LaTeX / 마크다운)
      </summary>

      <div className="mt-2 space-y-4 text-xs">
        <p className="leading-relaxed">
          여기에 적은 내용은 학생 화면에서 서식이 적용되어 보입니다. 수식은 문장 안에 넣을 때{" "}
          <code className="rounded bg-blue-100 px-1 py-0.5 font-mono">$수식$</code>, 줄을 바꿔 크게
          보여줄 때{" "}
          <code className="rounded bg-blue-100 px-1 py-0.5 font-mono">$$수식$$</code> 로 감쌉니다.
          왼쪽처럼 쓰면 오른쪽처럼 보입니다.
        </p>

        {SECTIONS.map((section) => (
          <div key={section.title} className="space-y-1">
            <p className="font-medium text-blue-700">{section.title}</p>
            <ExampleTable examples={section.examples} />
          </div>
        ))}

        <p className="leading-relaxed text-blue-700">
          달러 기호를 수식이 아닌 뜻으로 쓸 일이 있으면{" "}
          <code className="rounded bg-blue-100 px-1 py-0.5 font-mono">\$</code> 처럼 앞에 역슬래시를
          붙이세요. 잘 되는지 모르겠으면 위의 <span className="font-medium">미리보기</span> 를 켜고
          확인하시면 됩니다.
        </p>
      </div>
    </details>
  );
}
