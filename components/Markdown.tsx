"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders Claude's markdown output (headings, lists, code, tables, etc.) with
 * styling that fits the dashboard. Safe by default — react-markdown does not use
 * dangerouslySetInnerHTML and we don't enable raw HTML.
 */
const components: Components = {
  p: ({ children }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mb-2 mt-3 text-base font-bold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-3 text-sm font-bold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h3>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-700">
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  hr: () => <hr className="my-3 border-ink/10" />,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-indigo-300 pl-3 text-ink-soft">{children}</blockquote>
  ),
  // Inline code. Code inside a <pre> is neutralized by the [&_code] overrides below.
  code: ({ children }) => (
    <code className="rounded bg-ink/10 px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-auto rounded-lg bg-[#1e1e2e] p-3 font-mono text-xs leading-relaxed text-[#e6e6f0] [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-ink/15 bg-ink/5 px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-ink/15 px-2 py-1">{children}</td>,
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm text-ink">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
