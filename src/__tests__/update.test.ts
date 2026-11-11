import { describe, it, expect, beforeEach, vi } from "vitest";

const check = vi.hoisted(() => vi.fn());
const relaunch = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch }));

import { useUpdate } from "@/stores/update";

beforeEach(() => {
  (window as any).__TAURI_INTERNALS__ = {};
  check.mockReset();
  relaunch.mockClear();
  useUpdate.setState({ status: "idle", version: undefined, error: undefined, progress: undefined });
});

describe("self-update", () => {
  it("offers a newer release, then installs it and restarts", async () => {
    const downloadAndInstall = vi.fn(async (cb: (e: any) => void) => {
      cb({ event: "Started", data: { contentLength: 200 } });
      cb({ event: "Progress", data: { chunkLength: 100 } });
    });
    check.mockResolvedValue({ version: "1.0.1", body: "Fixes", downloadAndInstall });

    await useUpdate.getState().check();
    expect(useUpdate.getState()).toMatchObject({ status: "available", version: "1.0.1" });

    await useUpdate.getState().install();
    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("says so when already on the latest version", async () => {
    check.mockResolvedValue(null);
    await useUpdate.getState().check();
    expect(useUpdate.getState().status).toBe("current");
  });

  it("stays silent when a background check fails, but reports one you asked for", async () => {
    check.mockRejectedValue(new Error("offline"));
    await useUpdate.getState().check({ quiet: true });
    expect(useUpdate.getState().status).toBe("idle");

    await useUpdate.getState().check();
    expect(useUpdate.getState()).toMatchObject({ status: "error", error: "offline" });
  });

  it("keeps the offer and explains when installing fails", async () => {
    check.mockResolvedValue({ version: "1.0.1", downloadAndInstall: vi.fn(async () => Promise.reject(new Error("bad signature"))) });
    await useUpdate.getState().check();
    await useUpdate.getState().install();
    expect(useUpdate.getState()).toMatchObject({ status: "available", error: "Update failed: bad signature" });
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("does nothing in the web build", async () => {
    delete (window as any).__TAURI_INTERNALS__;
    await useUpdate.getState().check();
    expect(check).not.toHaveBeenCalled();
  });
});
