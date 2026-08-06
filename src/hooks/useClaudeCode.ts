import { useCallback, useEffect, useRef, useState } from "react";
import { detectClaudeCode, installClaudeCode, type ClaudeCodeInfo } from "@/lib/claudeCode";
import { isDesktop } from "@/lib/platform";
import { useSettings } from "@/stores/settings";

/**
 * Claude Code connection state. Detection runs on mount and flips the runtime
 * to Claude Code automatically when the CLI is present. `install()` covers the
 * case where it is missing: it installs the CLI from inside the app, then
 * connects, so a fresh machine is never a dead end.
 */
export function useClaudeCode() {
  const runtime = useSettings((s) => s.runtime);
  const setRuntime = useSettings((s) => s.setRuntime);
  const [info, setInfo] = useState<ClaudeCodeInfo | null>(null);
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
    const i = await detectClaudeCode();
    if (mounted.current) setInfo(i);
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

  const available = info?.available ?? false;
  const connected = runtime === "claude-code" && available;

  return {
    info,
    available,
    connected,
    desktop,
    install,
    installing,
    installLog,
    installError,
  };
}
