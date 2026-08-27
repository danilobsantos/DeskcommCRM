import { ProviderScheduleClient } from "./_client";

export const dynamic = "force-dynamic";

export default function ProviderSchedulePage({
  params,
}: {
  params: { providerId: string };
}) {
  return <ProviderScheduleClient providerId={params.providerId} />;
}
