import { ProviderScheduleClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function ProviderSchedulePage({
  params,
}: {
  params: Promise<{ providerId: string }>;
}) {
  const { providerId } = await params;
  return <ProviderScheduleClient providerId={providerId} />;
}
