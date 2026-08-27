"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, MagnifyingGlass } from "@/lib/ui/icons";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";

interface Provider {
  id: string;
  name: string;
  specialties: string[];
  active: boolean;
}

export function SchedulingListClient() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchProviders = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.set("specialty", search);

      const res = await fetch(`/api/v1/scheduling/providers?${params}`);
      if (!res.ok) throw new Error("Erro ao carregar profissionais");

      const data = await res.json();
      setProviders(data.data?.providers ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Agenda</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie profissionais, disponibilidade e consultas.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild>
            <Link href="/app/scheduling/new">
              <Plus size={16} weight="bold" aria-hidden />
              <span>Novo profissional</span>
            </Link>
          </Button>
        </div>
      </header>

      <div className="relative max-w-sm">
        <MagnifyingGlass
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          placeholder="Filtrar por especialidade..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-5 w-32 mb-2" />
              <Skeleton className="h-4 w-48 mb-3" />
              <Skeleton className="h-8 w-24" />
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card className="p-6 text-center text-destructive">{error}</Card>
      ) : providers.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground mb-4">
            {search
              ? "Nenhum profissional encontrado para esta especialidade."
              : "Nenhum profissional cadastrado ainda."}
          </p>
          {!search && (
            <Button asChild>
              <Link href="/app/scheduling/new">
                <Plus size={16} weight="bold" aria-hidden />
                <span>Cadastrar primeiro profissional</span>
              </Link>
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((provider) => (
            <Link key={provider.id} href={`/app/scheduling/${provider.id}`}>
              <Card className="p-4 transition-colors hover:bg-accent/50 cursor-pointer">
                <h3 className="font-medium">{provider.name}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {provider.specialties.length > 0
                    ? provider.specialties.join(", ")
                    : "Sem especialidade definida"}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Ver agenda</span>
                  <span className="text-xs">→</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
