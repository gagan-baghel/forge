import { Link } from "react-router-dom";
import { Card, CardHeader, Toggle } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useSettings } from "@/stores/settings";
import { syncKeepAwake } from "@/lib/channelRuntime";

export function RemoteSection() {
  const s = useSettings();
  return (
    <Card>
      <CardHeader
        title="Remote control"
        hint="Reach your agents from your phone over Telegram or Discord."
        action={
          <Link to="/remote" className="btn-outline">
            <Icon name="phone" size={14} /> Open Remote
          </Link>
        }
      />
      <Toggle
        checked={s.keepAwake}
        onChange={(on) => {
          s.setKeepAwake(on);
          setTimeout(syncKeepAwake);
        }}
        label="Keep this Mac awake while remote control is live"
        description="A sleeping Mac can't answer your phone. Closing the window keeps Forge running; ⌘Q quits."
      />
    </Card>
  );
}
