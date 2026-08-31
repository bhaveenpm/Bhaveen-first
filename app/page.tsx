/**
 * Server component: resolves provider health on the server so the §8 degradation
 * banner is correct on first paint, and so no key material can reach the bundle.
 */
import { AutoWrite } from "@/components/AutoWrite";
import { providerStatus } from "@/lib/anthropic";

export const dynamic = "force-dynamic";

export default function Page() {
  return <AutoWrite provider={providerStatus()} />;
}
