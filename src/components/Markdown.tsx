import { memo, type ComponentProps } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openExternal } from "@/lib/platform";

/**
 * Chat Markdown: CommonMark plus GitHub's extensions (tables, strikethrough,
 * task lists, autolinks). Raw HTML in a reply is shown as text, never run,
 * and links open in the user's browser instead of inside Forge's window.
 */

const components: Components = {
  p: (props) => <p className="my-1.5 leading-relaxed" {...props} />,
  h1: (props) => <h3 className="mb-1 mt-4 text-[15px] font-semibold text-ink" {...props} />,
  h2: (props) => <h3 className="mb-1 mt-4 text-[14px] font-semibold text-ink" {...props} />,
  h3: (props) => <h4 className="mb-1 mt-3 text-[13px] font-semibold text-ink" {...props} />,
  h4: (props) => <h5 className="mb-1 mt-3 text-[13px] font-semibold text-ink-2" {...props} />,
  h5: (props) => <h6 className="mb-1 mt-3 text-[13px] font-semibold text-ink-2" {...props} />,
  h6: (props) => <h6 className="mb-1 mt-3 text-[13px] font-semibold text-ink-3" {...props} />,
  ul: (props) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-ink-3" {...props} />,
  ol: (props) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-ink-3" {...props} />,
  li: (props) => <li className="pl-0.5 [&>ol]:my-1 [&>p]:my-0 [&>ul]:my-1" {...props} />,
  hr: () => <hr className="my-4 border-0 border-t border-border" />,
  blockquote: (props) => <blockquote className="my-2 border-l-2 border-border-strong pl-3 text-ink-2" {...props} />,
  strong: (props) => <strong className="font-semibold text-ink" {...props} />,
  del: (props) => <del className="text-ink-3" {...props} />,
  a: ({ href = "", children }) => (
    <a
      href={href}
      title={href}
      className="text-brand-2 underline decoration-brand-2/40 underline-offset-2 hover:decoration-brand-2"
      onClick={(e) => {
        e.preventDefault();
        void openExternal(href);
      }}
    >
      {children}
    </a>
  ),
  // Wide tables scroll sideways inside the message instead of stretching it.
  table: (props) => (
    <div className="my-3 overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-left text-[12.5px]" {...props} />
    </div>
  ),
  thead: (props) => <thead className="bg-surface-2" {...props} />,
  th: ({ style, ...props }) => (
    <th className="whitespace-nowrap border-b border-border px-3 py-2 font-medium text-ink" style={style} {...props} />
  ),
  td: ({ style, ...props }) => (
    <td className="border-b border-border px-3 py-2 align-top text-ink-2 [tr:last-child>&]:border-b-0" style={style} {...props} />
  ),
  pre: (props) => (
    <pre className="my-2 overflow-x-auto rounded-md border border-border bg-bg p-3 font-mono text-xs leading-relaxed" {...props} />
  ),
  code: ({ className, children, ...props }: ComponentProps<"code">) => {
    // Fenced blocks carry a language-* class (or sit in <pre>); inline code is bare.
    const block = /language-/.test(className ?? "") || String(children).includes("\n");
    return block ? (
      <code className={className} {...props}>
        {children}
      </code>
    ) : (
      <code className="rounded border border-border bg-surface-2 px-1 py-px font-mono text-[0.85em]" {...props}>
        {children}
      </code>
    );
  },
};

export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="text-[13px] leading-relaxed [&>*:first-child]:mt-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
