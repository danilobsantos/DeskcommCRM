"use client";

import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { useT } from "@/hooks/i18n/useT";
import { updateProvidersFeature } from "@/app/actions/settings/updateProvidersFeature";

interface FuncionalidadesClientProps {
  organizationId: string;
  providersEnabled: boolean;
}

export function FuncionalidadesClient({
  organizationId,
  providersEnabled,
}: FuncionalidadesClientProps) {
  const t = useT();
  const [enabled, setEnabled] = useState(providersEnabled);
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
    </div>
  );
}