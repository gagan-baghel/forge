/** `http` and `code` skills: plain HTTP requests and sandboxed JavaScript. */
import { httpFetch } from "../http";
import { RESPONSE_LIMIT } from "./shared";
import type { ClientTool } from "./types";

export const httpTool: ClientTool = {
  def: {
    name: "http_request",
    description:
      "Make an HTTP request to a URL and return the response body. Use for calling public APIs or fetching web pages.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute URL" },
        method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"], default: "GET" },
        headers: { type: "object", description: "Optional request headers" },
        body: { type: "string", description: "Optional request body" },
      },
      required: ["url"],
    },
  },
  run: async (input) => {
    const r = await httpFetch({
      method: input.method as string | undefined,
      url: String(input.url),
      headers: input.headers as Record<string, string> | undefined,
      body: input.body as string | undefined,
    });
    return `HTTP ${r.status}\n${r.body.slice(0, RESPONSE_LIMIT)}`;
  },
};

export const jsTool: ClientTool = {
  def: {
    name: "run_javascript",
    description:
      "Execute JavaScript in a sandbox and return the value of the last expression (or anything logged). Use for calculations and data manipulation. No network or DOM access.",
    input_schema: {
      type: "object",
      properties: { code: { type: "string", description: "JavaScript source to run" } },
      required: ["code"],
    },
  },
  run: async (input) => runInWorker(String(input.code ?? "")),
};

const JS_TIMEOUT_MS = 4000;

/** Run code in a throwaway Web Worker so it never blocks the UI thread. */
function runInWorker(code: string, timeoutMs = JS_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve) => {
    const src = `self.onmessage=async(e)=>{const logs=[];const console={log:(...a)=>logs.push(a.map(String).join(' '))};try{const fn=new Function('console','return (async()=>{'+e.data+'\\n})()');const r=await fn(console);self.postMessage({ok:true,result:(r===undefined?'':String(r)),logs})}catch(err){self.postMessage({ok:false,result:String(err),logs})}}`;
    const blob = new Blob([src], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    const done = (out: string) => {
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(out);
    };
    const timer = setTimeout(() => done("Error: execution timed out."), timeoutMs);
    worker.onmessage = (e: MessageEvent<{ ok: boolean; result: string; logs?: string[] }>) => {
      clearTimeout(timer);
      const { ok, result, logs } = e.data;
      const out = [logs?.length ? logs.join("\n") : "", result ? `=> ${result}` : ""].filter(Boolean).join("\n");
      done(ok ? out || "(no output)" : `Error: ${result}`);
    };
    worker.postMessage(code);
  });
}
