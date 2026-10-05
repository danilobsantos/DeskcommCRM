"use client";

import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { useT } from "@/hooks/i18n/useT";
import { updateProvidersFeature, updateProvidersGoogleFeature } from "@/app/actions/settings/updateProvidersFeature";

interface FuncionalidadesClientProps {
  organizationId: string;
  providersEnabled: boolean;
  providersGoogleEnabled?: boolean;
}

export function FuncionalidadesClient({
  organizationId,
  providersEnabled,
  providersGoogleEnabled = false,
}: FuncionalidadesClientProps) {
  const t = useT();
  const [enabled, setEnabled] = useState(providersEnabled);
  const [googleEnabled, setGoogleEnabled] = useState(providersGoogleEnabled);
  const [isPending, startTransition] = useTransition();

  const toggle = (checked: boolean) => {
    startTransition(async () => {
      const r = await updateProvidersFeature(organizationId, checked);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setEnabled(r.providers_enabled);
      toast.success(
        r.providers_enabled
          ? t("Agenda de profissionais ligada")
          : t("Agenda de profissionais desligada"),
      );
    });
  };

  const toggleGoogle = (checked: boolean) => {
    startTransition(async () => {
      const r = await updateProvidersGoogleFeature(organizationId, checked);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setGoogleEnabled(r.providers_google_enabled);
      toast.success(
        r.providers_google_enabled
          ? t("Google por profissional ligado")
          : t("Google por profissional desligado"),
      );
    });
  };

  return (
    <div className="space-y-4">
      <Card className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">
            {t("Profissionais externos (dentistas sem login)")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Liga ou desliga a agenda de profissionais externos deste tenant — dentistas, corretores e consultores que têm agenda própria mas não têm conta de usuário no sistema. Desligado, a agenda do base funciona normalmente.")}
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={toggle} disabled={isPending} />
      </Card>
      <Card className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">
            {t("Google por profissional (conta central)")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Liga ou desliga o vínculo de cada profissional com uma agenda do Google da conta central da clínica. Só vale com Profissionais externos ligado. Desligado, a agenda volta a jornada + exceções e os vínculos ficam guardados para a reativação.")}
          </p>
        </div>
        <Switch
          checked={googleEnabled}
          onCheckedChange={toggleGoogle}
          disabled={isPending || !enabled}
        />
      </Card>
    </div>
  );
}