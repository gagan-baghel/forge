import { PageBody, PageHeader } from "@/components/Shell";
import { isDesktop } from "@/lib/platform";
import { ApiSection } from "./settings/ApiSection";
import { RuntimeSection } from "./settings/RuntimeSection";
import { RemoteSection } from "./settings/RemoteSection";
import { AppearanceSection } from "./settings/AppearanceSection";
import { PricingSection } from "./settings/PricingSection";
import { DataSection } from "./settings/DataSection";
import { UpdateCheck } from "./settings/UpdateCheck";

const APP_VERSION = __APP_VERSION__;

/** Settings, one card per concern. Adding a card is one file in ./settings and one line here. */
const SECTIONS = [ApiSection, RuntimeSection, RemoteSection, AppearanceSection, PricingSection, DataSection];

export function SettingsView() {
  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle={`Forge ${APP_VERSION} — local-first, everything here lives on this device`}
        actions={isDesktop() ? <UpdateCheck /> : undefined}
      />
      <PageBody className="max-w-3xl space-y-6">
        {SECTIONS.map((Section, i) => (
          <Section key={i} />
        ))}
      </PageBody>
    </div>
  );
}
