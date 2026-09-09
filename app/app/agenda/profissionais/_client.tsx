"use client";

import { useState, useTransition } from "react";
import { Clock, Plus, Trash } from "@/lib/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useT } from "@/hooks/i18n/useT";
import { FUSOS_OFERECIDOS } from "@/lib/tempo/fusos";
import type { ScheduleWindow } from "@/lib/schemas/routing";
import {
  alternarProfissionalAtivo,
  criarProfissional,
  salvarJornadaProfissional,
} from "@/app/actions/agenda/providers";

const DOW_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

interface ProfissionalInicial {
  id: string;
  nome: string;
  especialidades: string[];
  ativo: boolean;
  proximas: number;
  schedule: { timezone: string; windows: ScheduleWindow[] };
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
  const [editandoJornada, setEditandoJornada] = useState<ProfissionalInicial | null>(null);
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

  const salvarJornada = (schedule: { timezone: string; windows: ScheduleWindow[] }) => {
    if (!editandoJornada) return;
    startTransition(async () => {
      const r = await salvarJornadaProfissional(editandoJornada.id, schedule);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(t("Horário salvo"));
      setEditandoJornada(null);
      window.location.reload();
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
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {p.ativo ? (
                <Badge variant="success">{t("Ativo")}</Badge>
              ) : (
                <Badge variant="secondary">{t("Inativo")}</Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {p.proximas} {t(p.proximas === 1 ? "consulta futura" : "consultas futuras")}
              </span>
              {canWrite && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={() => setEditandoJornada(p)}
                >
                  <Clock size={14} className="mr-1" aria-hidden />
                  {t("Horário")}
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>

      {editandoJornada && (
        <EditorDeJornada
          nome={editandoJornada.nome}
          initial={editandoJornada.schedule}
          isPending={isPending}
          onCancel={() => setEditandoJornada(null)}
          onSave={salvarJornada}
        />
      )}
    </div>
  );
}

function EditorDeJornada({
  nome,
  initial,
  isPending,
  onCancel,
  onSave,
}: {
  nome: string;
  initial: { timezone: string; windows: ScheduleWindow[] };
  isPending: boolean;
  onCancel: () => void;
  onSave: (schedule: { timezone: string; windows: ScheduleWindow[] }) => void;
}) {
  const t = useT();
  const [timezone, setTimezone] = useState(initial.timezone || "America/Sao_Paulo");
  const [windows, setWindows] = useState<ScheduleWindow[]>(initial.windows ?? []);

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Horário de")} {nome}</DialogTitle>
          <DialogDescription>
            {t("Defina as janelas de atendimento deste profissional. Sem janelas, ninguém consegue marcar com ele.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tz">{t("Fuso horário")}</Label>
            <select
              id="tz"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {FUSOS_OFERECIDOS.map((f) => (
                <option key={f.codigo} value={f.codigo}>
                  {f.rotulo} — {f.codigo}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            {windows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("Nenhuma janela publicada — ninguém consegue marcar com esta pessoa.")}
              </p>
            ) : null}
            {windows.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select
                  value={String(w.dow)}
                  onValueChange={(v) =>
                    setWindows((ws) =>
                      ws.map((x, j) => (j === i ? { ...x, dow: Number(v) } : x)),
                    )
                  }
                >
                  <SelectTrigger className="w-[90px]" aria-label={t("Dia da semana")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOW_LABELS.map((d, idx) => (
                      <SelectItem key={idx} value={String(idx)}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="time"
                  value={w.start}
                  aria-label={t("Início")}
                  onChange={(e) =>
                    setWindows((ws) =>
                      ws.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)),
                    )
                  }
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  type="time"
                  value={w.end}
                  aria-label={t("Fim")}
                  onChange={(e) =>
                    setWindows((ws) =>
                      ws.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("Remover janela")}
                  onClick={() => setWindows((ws) => ws.filter((_, j) => j !== i))}
                >
                  <Trash size={18} aria-hidden />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setWindows((ws) => [...ws, { dow: 1, start: "08:00", end: "18:00" }])
              }
            >
              <Plus size={16} className="mr-1" aria-hidden /> {t("Adicionar janela")}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {t("Cancelar")}
          </Button>
          <Button disabled={isPending} onClick={() => onSave({ timezone, windows })}>
            {t("Salvar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}