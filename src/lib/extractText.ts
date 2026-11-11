/**
 * Turn a dropped or picked file into plain text for an agent's knowledge.
 * PDFs are read locally with pdf.js — nothing is uploaded anywhere.
 */

/** File types the knowledge picker accepts. */
export const KNOWLEDGE_ACCEPT = ".pdf,.txt,.md,.markdown,.csv,.json,.html,.xml,.yaml,.yml,.log";

/**
 * Knowledge is stored in the browser's local storage, which holds a few MB in
 * total; a single huge document would silently fail to save. Past this the
 * user gets a clear error instead.
 */
export const MAX_DOC_CHARS = 1_000_000;

export class ExtractError extends Error {}

const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

async function pdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages: string[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      // hasEOL marks a line break inside the page; without it lines run together.
      const text = content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join("");
      if (text.trim()) pages.push(`[Page ${i}]\n${text.trim()}`);
    }
  } finally {
    void task.destroy();
  }
  if (pages.length === 0) {
    throw new ExtractError(`"${file.name}" has no selectable text — it looks like a scan. Run it through OCR first.`);
  }
  return pages.join("\n\n");
}

/** Plain text of a file, or a readable ExtractError. */
export async function extractText(file: File): Promise<string> {
  let text: string;
  try {
    text = isPdf(file) ? await pdfText(file) : await file.text();
  } catch (e) {
    if (e instanceof ExtractError) throw e;
    throw new ExtractError(`Couldn't read "${file.name}": ${(e as Error)?.message ?? e}`);
  }
  text = text.trim();
  if (!text) throw new ExtractError(`"${file.name}" is empty.`);
  if (text.length > MAX_DOC_CHARS) {
    throw new ExtractError(
      `"${file.name}" is too large (${Math.round(text.length / 1000)}k characters; the limit is ${MAX_DOC_CHARS / 1000}k). Split it into smaller files.`,
    );
  }
  return text;
}
