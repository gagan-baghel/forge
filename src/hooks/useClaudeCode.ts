import { useCallback, useEffect, useRef, useState } from "react";
import { detectClaudeCode, installClaudeCode, type ClaudeCodeInfo } from "@/lib/claudeCode";
import { isDesktop } from "@/lib/platform";
import { useSettings } from "@/stores/settings";

/**
 * One place for the Claude Code connection state + the single-tap actions.
 * `connect()` detects the local CLI and, if present, flips the global runtime
 * to Claude Code. `install()` goes one step further: when the CLI is missing
 * it installs it from inside the app (the bridge is in-built — nothing to
 * download by hand), then connects.
 */
export function useClaudeCode() {
  const runtime = useSettings((s) => s.runtime);
  const setRuntime = useSettings((s) => s.setRuntime);
  const [info, setInfo] = useState<ClaudeCodeInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [installError, setInstallError] = useState("");
  const mounted = useRef(true);
  const desktop = isDesktop();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const recheck = useCallback(async () => {
    if (!desktop) {
      setInfo({ available: false, version: "", path: "" });
      return null;
    }
    setChecking(true);
    const i = await detectClaudeCode();
    if (mounted.current) {
      setInfo(i);
      setChecking(false);
    }
    return i;
  }, [desktop]);

  useEffect(() => {
    void recheck();
  }, [recheck]);

  // Auto-use the local daemon: as soon as the CLI is detected, run on it — no
  // connect click. We only defer to the API runtime when the user has actually
  // set an API key (an explicit BYOK choice); otherwise Claude Code wins.
  const apiKey = useSettings((s) => s.apiKey);
  useEffect(() => {
    if (desktop && info?.available && runtime !== "claude-code" && !apiKey) {
      setRuntime("claude-code");
    }
  }, [desktop, info?.available, runtime, apiKey, setRuntime]);

  /** One-tap: detect, then switch the workspace to the Claude Code runtime. */
  const connect = useCallback(async (): Promise<boolean> => {
    const i = info?.available ? info : await recheck();
    if (i?.available) {
      setRuntime("claude-code");
      return true;
    }
    return false;
  }, [info, recheck, setRuntime]);

  /** One-tap when the CLI is missing: install it in-app, then connect. */
  const install = useCallback(async (): Promise<boolean> => {
    if (installing) return false;
    setInstalling(true);
    setInstallError("");
    setInstallLog([]);
    try {
      const i = await installClaudeCode((line) => {
        if (mounted.current) setInstallLog((log) => [...log.slice(-40), line]);
      });
      if (mounted.current) setInfo(i);
      if (i.available) {
        setRuntime("claude-code");
        return true;
      }
      return false;
    } catch (err: any) {
      if (mounted.current) setInstallError(String(err?.message ?? err));
      return false;
    } finally {
      if (mounted.current) setInstalling(false);
    }
  }, [installing, setRuntime]);

  const disconnect = useCallback(() => setRuntime("api"), [setRuntime]);

  const available = info?.available ?? false;
  const connected = runtime === "claude-code" && available;

  return {
    info,
    checking,
    available,
    connected,
    desktop,
    recheck,
    connect,
    disconnect,
    install,
    installing,
    installLog,
    installError,
  };
}
