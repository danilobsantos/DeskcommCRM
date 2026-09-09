import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { providersHabilitados } from "@/lib/agenda/providers";
import { FuncionalidadesClient } from "./_client";

interface FuncionalidadesPageProps {
  params: Promise<{ id: string }>;
}

export default async function FuncionalidadesPage({ params }: FuncionalidadesPageProps) {
  const { id } = await params;
  await requirePlatformAdmin();

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", id)
    .maybeSingle();

  const providersEnabled = providersHabilitados(org?.settings ?? null);

  return <FuncionalidadesClient organizationId={id} providersEnabled={providersEnabled} />;
}