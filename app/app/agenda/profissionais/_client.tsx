"use client";

import { useState, useTransition } from "react";
import { Plus } from "@/lib/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useT } from "@/hooks/i18n/useT";
import {
  alternarProfissionalAtivo,
  criarProfissional,
} from "@/app/actions/agenda/providers";

interface ProfissionalInicial {
  id: string;
  nome: string;
  especialidades: string[];
  ativo: boolean;
  proximas: number;
}

interface ProfissionaisClientProps {
  canWrite: boolean;
  iniciais: ProfissionalInicial[];
}

export function ProfissionaisClient({ canWrite, iniciais }: ProfissionaisClientProps) {
  const t = useT();
  const [profissionais, setProfissionais] = useState(iniciais);
  const [nome, setNome] = useState("");
  const [especialidades, setEspecialidades] = useState("");
  const [isPending, startTransition] = useTransition();

  const criar = () => {
    if (!nome.trim()) return;
    const specs = especialidades
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    startTransition(async () => {
      const r = await criarProfissional({ name: nome.trim(), specialties: specs });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(t("Profissional cadastrado"));
      setNome("");
      setEspecialidades("");
      window.location.reload();
    });
  };

  const alternar = (id: string, ativo: boolean) => {
    startTransition(async () => {
      const r = await alternarProfissionalAtivo(id, ativo);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setProfissionais((lista) =>
        lista.map((p) => (p.id === id ? { ...p, ativo } : p)),
      );
    });
  };

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Profissionais externos")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("Dentistas, corretores e consultores que têm agenda própria mas não têm conta no sistema. Quem gerencia as agendas deles é a secretária.")}
        </p>
      </header>

      {canWrite && (
        <Card className="flex flex-col gap-3 p-4 sm:flex-row">
          <Input
            placeholder={t("Nome (ex.: Dra. Ana)")}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="sm:max-w-xs"
          />
          <Input
            placeholder={t("Especialidades, separadas por vírgula")}
            value={especialidades}
            onChange={(e) => setEspecialidades(e.target.value)}
            className="flex-1"
          />
          <Button onClick={criar} disabled={isPending || !nome.trim()}>
            <Plus size={16} aria-hidden />
            <span>{t("Cadastrar")}</span>
          </Button>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {profissionais.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground col-span-full">
            {t("Nenhum profissional cadastrado ainda.")}
          </Card>
        )}
        {profissionais.map((p) => (
          <Card key={p.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-medium truncate">{p.nome}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {p.especialidades.length > 0
                    ? p.especialidades.join(", ")
                    : t("Sem especialidade")}
                </p>
              </div>
              {canWrite && (
                <Switch
                  checked={p.ativo}
                  onCheckedChange={(v) => alternar(p.id, v)}
                  disabled={isPending}
                />
              )}
            </div>
            <div className="mt-3 flex items-center gap-2">
              {p.ativo ? (
                <Badge variant="success">{t("Ativo")}</Badge>
              ) : (
                <Badge variant="secondary">{t("Inativo")}</Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {p.proximas} {t(p.proximas === 1 ? "consulta futura" : "consultas futuras")}
              </span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}