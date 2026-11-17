import { Button } from "@/components/ui";
import { useUpdate } from "@/stores/update";

/** Manual "is there a newer Forge?" — the same check the app runs on its own. */
export function UpdateCheck() {
  const { status, version, error, check, install } = useUpdate();
  if (status === "available" || status === "downloading")
    return (
      <Button variant="primary" icon="download" disabled={status === "downloading"} onClick={() => void install()}>
        {status === "downloading" ? "Updating…" : `Update to v${version}`}
      </Button>
    );
  return (
    <div className="flex items-center gap-3">
      {status === "current" && <span className="text-xs text-ink-3">You're on the latest version</span>}
      {status === "error" && (
        <span className="max-w-[260px] truncate text-xs text-danger" title={error}>
          Couldn't check: {error}
        </span>
      )}
      <Button icon="download" disabled={status === "checking"} onClick={() => void check()}>
        {status === "checking" ? "Checking…" : "Check for updates"}
      </Button>
    </div>
  );
}
