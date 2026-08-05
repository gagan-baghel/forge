import { Fragment, type ReactNode } from "react";

/**
 * Tiny Markdown renderer — enough for chat: fenced code blocks, inline code,
 * bold, italics, headings, bullet/numbered lists and paragraphs. No external
 * dependency, no dangerouslySetInnerHTML.
 */

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Split on `code`, **bold**, *italic*.
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<Fragment key={`${keyBase}-t${i}`}>{text.slice(last, m.index)}</Fragment>);
    const tok = m[0];
    if (tok.startsWith("`")) {
      out.push(
        <code key={`${keyBase}-c${i}`} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em]">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      out.push(<strong key={`${keyBase}-b${i}`}>{tok.slice(2, -2)}</strong>);
    } else {
      out.push(<em key={`${keyBase}-i${i}`}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) out.push(<Fragment key={`${keyBase}-end`}>{text.slice(last)}</Fragment>);
  return out;
}

export function Markdown({ content }: { content: string }) {
  const blocks: ReactNode[] = [];
  const lines = content.split("\n");
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3);
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push(
        <pre
          key={key++}
          className="my-2 overflow-x-auto rounded-lg border border-border bg-bg p-3 font-mono text-[0.82em] leading-relaxed"
        >
          {lang && <div className="mb-1 text-[0.7em] uppercase tracking-wide text-ink-3">{lang}</div>}
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Headings
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const cls = level === 1 ? "text-lg font-semibold" : level === 2 ? "text-base font-semibold" : "text-sm font-semibold";
      blocks.push(
        <p key={key++} className={`${cls} mt-3 mb-1`}>
          {renderInline(h[2], `h${key}`)}
        </p>,
      );
      i++;
      continue;
    }

    // Lists
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d+\.\s+/.test(line);
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""));
        i++;
      }
      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag key={key++} className={`my-2 ${ordered ? "list-decimal" : "list-disc"} space-y-1 pl-5`}>
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `li${key}-${idx}`)}</li>
          ))}
        </ListTag>,
      );
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph (consume consecutive non-blank, non-special lines)
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trim().startsWith("```") &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="my-1.5 leading-relaxed">
        {renderInline(para.join(" "), `p${key}`)}
      </p>,
    );
  }

  return <div className="text-sm">{blocks}</div>;
}
