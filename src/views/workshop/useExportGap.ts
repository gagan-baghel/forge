import { useDialog } from "@/components/Confirm";
import { downloadGap } from "@/lib/gapfile";
import { errorMessage } from "@/lib/runError";
import type { Gap } from "@/types/domain";

/** Export a pack as a .gap file, telling the user when it fails. */
export function useExportGap() {
  const { notify } = useDialog();
  return async (gap: Gap) => {
    try {
      await downloadGap(gap);
    } catch (e) {
      notify("Export failed", errorMessage(e));
    }
  };
}
