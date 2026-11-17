/** Messages API shapes: requests, content blocks, tools, results. */
import type { ChatMessage, ModelId } from "@/types/domain";

export interface StreamCallbacks {
  onText: (delta: string) => void;
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
  signal?: AbortSignal;
}

export interface ChatRequest {
  apiKey: string;
  model: ModelId;
  system: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  /** Response-shape constraint (structured outputs), merged into output_config. */
  outputConfig?: Record<string, unknown>;
}

/** A client-executed tool definition (JSON-schema input). */
export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
/** A server-executed tool (e.g. Anthropic web search). */
export type ServerTool = { type: string; name: string } & Record<string, unknown>;
export type AnyTool = ToolDef | ServerTool;

export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ApiContent =
  | { type: "text"; text: string; citations?: unknown[] }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string | ToolResultBlock[]; is_error?: boolean }
  | PassthroughBlock;

/**
 * Blocks the app never reads but must send back byte-for-byte: thinking (its
 * signature binds it to this exact conversation), and server-tool calls and
 * results (web search, web fetch, code execution). Dropping or rewriting them
 * loses the model's reasoning mid-loop and can 400 on newer accounts.
 */
export type PassthroughBlock = {
  type:
    | "thinking"
    | "redacted_thinking"
    | "server_tool_use"
    | "web_search_tool_result"
    | "web_fetch_tool_result"
    | "code_execution_tool_result"
    | "bash_code_execution_tool_result"
    | "text_editor_code_execution_tool_result";
  [key: string]: unknown;
};

/** Rich tool-result content: text plus images (a screenshot, say). */
export type ToolResultBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export interface ApiMessage {
  role: "user" | "assistant";
  content: string | ApiContent[];
}

export interface MessageRequest {
  apiKey: string;
  model: ModelId;
  system: string;
  messages: ApiMessage[];
  temperature: number;
  maxTokens: number;
  tools?: AnyTool[];
  /** Code-execution container to reuse, so files and state survive between steps. */
  container?: string;
}

export interface MessageResult {
  text: string;
  content: ApiContent[];
  toolUses: ToolUse[];
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
  /** Code-execution container this turn ran in, if any. */
  container?: string;
}

/** One decoded server-sent event. Only the fields Forge reads are named. */
export interface SseEvent {
  type: string;
  index?: number;
  message?: { usage?: { input_tokens?: number }; container?: { id?: string } };
  content_block?: { type?: string } & Record<string, unknown>;
  delta?: {
    type?: string;
    text?: string;
    citation?: unknown;
    thinking?: string;
    signature?: string;
    partial_json?: string;
    stop_reason?: string;
    container?: { id?: string };
  };
  usage?: { output_tokens?: number };
}
