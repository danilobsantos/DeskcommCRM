"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowBendUpLeft } from "@/lib/ui/icons";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

export function NewProviderClient() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [specialtiesInput, setSpecialtiesInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Informe o nome do profissional.");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const specialties = specialtiesInput
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      const res = await fetch("/api/v1/scheduling/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          specialties,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Erro ao cadastrar profissional");
      }

      const created = data?.data;
      if (created?.id) {
        router.push(`/app/scheduling/${created.id}`);
      } else {
        router.push("/app/scheduling");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 p-6 max-w-2xl mx-auto">
      <header className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/app/scheduling" aria-label="Voltar para a lista">
            <ArrowBendUpLeft size={20} aria-hidden />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Novo profissional</h1>
          <p className="text-sm text-muted-foreground">
            Cadastre um profissional para configurar disponibilidade e receber agendamentos.
          </p>
        </div>
      </header>

      <Card className="p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="provider-name">Nome do profissional *</Label>
            <Input
              id="provider-name"
              placeholder="Ex: Dra. Juliana Silva"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="provider-specialties">
              Especialidades (separadas por vírgula)
            </Label>
            <Input
              id="provider-specialties"
              placeholder="Ex: Ortodontia, Clínico Geral, Implantodontia"
              value={specialtiesInput}
              onChange={(e) => setSpecialtiesInput(e.target.value)}
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">
              O agente de IA utilizará estas especialidades para sugerir o profissional correto aos contatos.
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t">
            <Button variant="outline" asChild disabled={loading}>
              <Link href="/app/scheduling">Cancelar</Link>
            </Button>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading ? "Salvando..." : "Salvar profissional"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
