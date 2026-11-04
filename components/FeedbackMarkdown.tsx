import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

// AI 피드백 본문 렌더러.
//
// 저장된 피드백은 마크다운(**굵게**, ###, 목록, 표)과 LaTeX 수식이 섞인 원문 텍스트다.
// 예전에는 <p className="whitespace-pre-wrap">로 그대로 뿌려서 별표와 샵이 화면에 그대로
// 보였다. 여기서 마크다운 → HTML로 변환하고 수식은 KaTeX로 그린다.
//
// 원시 HTML은 허용하지 않는다(rehype-raw를 넣지 않음). AI 출력이 곧 다른 사용자에게
// 보이는 화면이므로 스크립트 주입 경로를 열지 않기 위함.

// AI가 수식 구분자를 어떻게 뱉을지는 제공사·모델마다 다르다. 프롬프트로 $ 형식을 지시하고
// 있지만 모델이 어기는 경우가 흔해 렌더 단에서도 방어한다.
export function normalizeMath(raw: string): string {
  return (
    raw
      // LaTeX 표준 구분자 → 달러 구분자. remark-math는 \( \) \[ \]를 인식하지 못한다.
      .replace(/\\\[([\s\S]*?)\\\]/g, (_, body: string) => `\n\n$$\n${body.trim()}\n$$\n\n`)
      .replace(/\\\(([\s\S]*?)\\\)/g, (_, body: string) => `$${body.trim()}$`)
      // remark-math에서 $$…$$가 블록(가운데 정렬된 큰 수식)이 되려면 여는 $$와 닫는 $$가
      // 각각 제 줄에 있어야 한다. 모델은 한 줄에 몰아 쓰는 경우가 훨씬 많고, 그러면 본문
      // 글자 크기의 인라인 수식으로 렌더링된다. 한 줄을 통째로 차지한 $$…$$만 골라 편다.
      .replace(
        /^[ \t]*\$\$[ \t]*([^\n]+?)[ \t]*\$\$[ \t]*$/gm,
        (_, body: string) => `\n$$\n${body}\n$$\n`,
      )
  );
}

// 색상은 지정하지 않는다 — 감싸는 카드(AI=indigo, 선생님=blue)의 text 색을 그대로 물려받아
// 어느 카드에 넣어도 톤이 맞도록 한다. 배경이 필요한 요소만 현재 색의 투명도로 처리한다.
const components: Components = {
  h1: ({ children }) => <h1 className="mt-4 mb-2 text-base font-bold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-4 mb-2 text-base font-bold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-3 mb-1.5 text-sm font-bold first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-bold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-current/30 pl-3 opacity-90">{children}</blockquote>
  ),
  code: ({ className, children }) => {
    // 블록 코드에는 language-* 클래스가 붙는다. 인라인 코드와 스타일을 나눈다.
    const isBlock = typeof className === "string" && className.includes("language-");
    return isBlock ? (
      <code className="block overflow-x-auto rounded-md bg-current/5 p-3 font-mono text-xs">
        {children}
      </code>
    ) : (
      <code className="rounded bg-current/10 px-1 py-0.5 font-mono text-[0.9em]">{children}</code>
    );
  },
  pre: ({ children }) => <pre className="my-2">{children}</pre>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-3 border-current/20" />,
  // 표는 좁은 화면에서 카드를 밀어내지 않도록 가로 스크롤 컨테이너로 감싼다.
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-current/20 px-2 py-1 font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-current/20 px-2 py-1">{children}</td>,
};

export default function FeedbackMarkdown({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={`text-sm leading-relaxed break-words ${className}`}>
      <ReactMarkdown
        // remarkCjkFriendly가 없으면 "**변동 폭(최소·최대 차이)**을" 처럼 닫는 **가
        // 구두점과 조사 사이에 낀 경우 CommonMark의 flanking 규칙 때문에 굵게 처리가 안 되고
        // 별표가 그대로 노출된다. 한국어 피드백에서 아주 흔한 형태라 반드시 필요하다.
        remarkPlugins={[remarkGfm, remarkCjkFriendly, remarkBreaks, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {normalizeMath(children)}
      </ReactMarkdown>
    </div>
  );
}
