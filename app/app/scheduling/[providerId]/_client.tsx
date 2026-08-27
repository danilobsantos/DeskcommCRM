"use client";
import { useCallback, useEffect, useState } from "react";
import { Clock, ArrowBendUpLeft } from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";

interface Provider {
  id: string;
  name: string;
  specialties: string[];
}

interface Appointment {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  reason: string | null;
  contacts: { name: string | null } | null;
}

interface ScheduleWindow {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  active: boolean;
}

type ViewMode = "month" | "week" | "day";

const DOW_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTH_LABELS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  scheduled: { label: "Agendada", color: "bg-blue-100 text-blue-800" },
  confirmed: { label: "Confirmada", color: "bg-green-100 text-green-800" },
  completed: { label: "Realizada", color: "bg-gray-100 text-gray-800" },
  cancelled: { label: "Cancelada", color: "bg-red-100 text-red-800" },
  no_show: { label: "Não compareceu", color: "bg-orange-100 text-orange-800" },
};

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

export function ProviderScheduleClient({ providerId }: { providerId: string }) {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [schedules, setSchedules] = useState<ScheduleWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      const [providerRes, appointmentsRes, schedulesRes] = await Promise.all([
        fetch(`/api/v1/scheduling/providers/${providerId}`),
        fetch(`/api/v1/scheduling/appointments?provider_id=${providerId}`),
        fetch(`/api/v1/scheduling/schedules?provider_id=${providerId}`),
      ]);

      if (providerRes.ok) {
        const data = await providerRes.json();
        setProvider(data.data?.provider ?? null);
      }

      if (appointmentsRes.ok) {
        const data = await appointmentsRes.json();
        setAppointments(data.data?.appointments ?? []);
      }

      if (schedulesRes.ok) {
        const data = await schedulesRes.json();
        setSchedules(data.data?.schedules ?? []);
      }
    } catch {
      // Errors handled silently — UI degrades gracefully
    } finally {
      setLoading(false);
    }
  }, [providerId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const navigatePrev = () => {
    const d = new Date(currentDate);
    if (viewMode === "month") d.setMonth(d.getMonth() - 1);
    else if (viewMode === "week") d.setDate(d.getDate() - 7);
    else d.setDate(d.getDate() - 1);
    setCurrentDate(d);
  };

  const navigateNext = () => {
    const d = new Date(currentDate);
    if (viewMode === "month") d.setMonth(d.getMonth() + 1);
    else if (viewMode === "week") d.setDate(d.getDate() + 7);
    else d.setDate(d.getDate() + 1);
    setCurrentDate(d);
  };

  const navigateToday = () => setCurrentDate(new Date());

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="p-6">
        <Card className="p-6 text-center">Profissional não encontrado.</Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/app/scheduling">
              <ArrowBendUpLeft size={16} aria-hidden />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{provider.name}</h1>
            <p className="text-sm text-muted-foreground">
              {provider.specialties.length > 0
                ? provider.specialties.join(", ")
                : "Sem especialidade definida"}
            </p>
          </div>
        </div>
      </header>

      {/* View mode toggle + navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {(["month", "week", "day"] as ViewMode[]).map((mode) => (
            <Button
              key={mode}
              variant={viewMode === mode ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode(mode)}
            >
              {mode === "month" ? "Mês" : mode === "week" ? "Semana" : "Dia"}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={navigatePrev}>
            ←
          </Button>
          <Button variant="outline" size="sm" onClick={navigateToday}>
            Hoje
          </Button>
          <Button variant="outline" size="sm" onClick={navigateNext}>
            →
          </Button>
          <span className="text-sm font-medium ml-2">
            {MONTH_LABELS[currentDate.getMonth()]} {currentDate.getFullYear()}
          </span>
        </div>
      </div>

      {/* Calendar grid */}
      {viewMode === "month" && (
        <MonthView
          currentDate={currentDate}
          appointments={appointments}
          schedules={schedules}
        />
      )}

      {viewMode === "week" && (
        <WeekView
          currentDate={currentDate}
          appointments={appointments}
          schedules={schedules}
        />
      )}

      {viewMode === "day" && (
        <DayView
          currentDate={currentDate}
          appointments={appointments}
          schedules={schedules}
        />
      )}

      {/* Upcoming appointments */}
      <div className="mt-6">
        <h2 className="text-lg font-medium mb-3">Próximas consultas</h2>
        <div className="space-y-2">
          {appointments
            .filter((a) => new Date(a.start_time) >= new Date() && a.status !== "cancelled")
            .slice(0, 10)
            .map((appt) => {
              const status = STATUS_LABELS[appt.status] ?? STATUS_LABELS.scheduled;
              const start = new Date(appt.start_time);
              const contactName =
                (appt.contacts as unknown as { name: string | null })?.name ?? "Paciente";
              return (
                <Card key={appt.id} className="p-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{contactName}</p>
                    <p className="text-sm text-muted-foreground">
                      {start.toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {appt.reason ? ` — ${appt.reason}` : ""}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${status?.color ?? "bg-gray-100"}`}>
                    {status?.label ?? appt.status}
                  </span>
                </Card>
              );
            })}
          {appointments.filter(
            (a) => new Date(a.start_time) >= new Date() && a.status !== "cancelled",
          ).length === 0 && (
            <Card className="p-6 text-center text-muted-foreground">
              Nenhuma consulta futura.
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month View
// ---------------------------------------------------------------------------

function MonthView({
  currentDate,
  appointments,
  schedules,
}: {
  currentDate: Date;
  appointments: Appointment[];
  schedules: ScheduleWindow[];
}) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const today = new Date();
  const isToday = (day: number) =>
    day === today.getDate() &&
    month === today.getMonth() &&
    year === today.getFullYear();

  return (
    <Card className="p-4">
      <div className="grid grid-cols-7 gap-px bg-border">
        {DOW_LABELS.map((label) => (
          <div key={label} className="bg-background p-2 text-center text-xs font-medium text-muted-foreground">
            {label}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`empty-${i}`} className="bg-background p-2 min-h-[80px]" />;
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayAppts = appointments.filter((a) => a.start_time.startsWith(dateStr));
          const dow = new Date(year, month, day).getDay();
          const hasSchedule = schedules.some((s) => s.day_of_week === dow && s.active);
          return (
            <div
              key={day}
              className={`bg-background p-2 min-h-[80px] ${isToday(day) ? "ring-2 ring-primary" : ""}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">{day}</span>
                {hasSchedule && (
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" title="Agenda configurada" />
                )}
              </div>
              <div className="space-y-1">
                {dayAppts.slice(0, 3).map((a) => (
                  <div
                    key={a.id}
                    className="text-xs bg-primary/10 text-primary rounded px-1 py-0.5 truncate"
                  >
                    {new Date(a.start_time).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                ))}
                {dayAppts.length > 3 && (
                  <span className="text-xs text-muted-foreground">+{dayAppts.length - 3}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Week View
// ---------------------------------------------------------------------------

function WeekView({
  currentDate,
  appointments,
  schedules,
}: {
  currentDate: Date;
  appointments: Appointment[];
  schedules: ScheduleWindow[];
}) {
  const startOfWeek = new Date(currentDate);
  startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    return d;
  });

  const hours = Array.from({ length: 14 }, (_, i) => i + 7); // 7h-20h

  return (
    <Card className="p-4 overflow-x-auto">
      <div className="min-w-[700px]">
        <div className="grid grid-cols-[60px_repeat(7,1fr)] gap-px bg-border">
          <div className="bg-background" />
          {days.map((d) => {
            const today = new Date();
            const isToday =
              d.getDate() === today.getDate() &&
              d.getMonth() === today.getMonth() &&
              d.getFullYear() === today.getFullYear();
            return (
              <div
                key={d.toISOString()}
                className={`bg-background p-2 text-center text-xs font-medium ${isToday ? "text-primary" : "text-muted-foreground"}`}
              >
                {DOW_LABELS[d.getDay()]} {d.getDate()}
              </div>
            );
          })}
          {hours.map((hour) => (
            <>
              <div key={`h-${hour}`} className="bg-background p-2 text-xs text-muted-foreground text-right">
                {String(hour).padStart(2, "0")}:00
              </div>
              {days.map((d) => {
                const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                const hourAppts = appointments.filter((a) => {
                  if (!a.start_time.startsWith(dateStr)) return false;
                  const h = new Date(a.start_time).getHours();
                  return h === hour;
                });
                return (
                  <div key={`${d.toISOString()}-${hour}`} className="bg-background p-1 min-h-[40px]">
                    {hourAppts.map((a) => (
                      <div
                        key={a.id}
                        className="text-xs bg-primary/10 text-primary rounded px-1 py-0.5 mb-0.5 truncate"
                      >
                        {(a.contacts as unknown as { name: string | null })?.name ?? "Paciente"}
                      </div>
                    ))}
                  </div>
                );
              })}
            </>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Day View
// ---------------------------------------------------------------------------

function DayView({
  currentDate,
  appointments,
  schedules,
}: {
  currentDate: Date;
  appointments: Appointment[];
  schedules: ScheduleWindow[];
}) {
  const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}`;
  const dayAppts = appointments.filter((a) => a.start_time.startsWith(dateStr));
  const dow = currentDate.getDay();
  const daySchedule = schedules.find((s) => s.day_of_week === dow && s.active);

  const hours = Array.from({ length: 14 }, (_, i) => i + 7);

  return (
    <Card className="p-4">
      {daySchedule && (
        <div className="mb-4 text-sm text-muted-foreground">
          <Clock size={14} className="inline mr-1" />
          Disponível das {daySchedule.start_time.slice(0, 5)} às {daySchedule.end_time.slice(0, 5)}
          (slots de {daySchedule.slot_duration_minutes}min)
        </div>
      )}
      <div className="space-y-1">
        {hours.map((hour) => {
          const hourAppts = dayAppts.filter((a) => new Date(a.start_time).getHours() === hour);
          return (
            <div key={hour} className="flex items-start gap-3 min-h-[48px]">
              <span className="text-xs text-muted-foreground w-12 shrink-0 pt-1">
                {String(hour).padStart(2, "0")}:00
              </span>
              <div className="flex-1 border-l pl-3">
                {hourAppts.map((a) => {
                  const status = STATUS_LABELS[a.status] ?? STATUS_LABELS.scheduled;
                  const contactName =
                    (a.contacts as unknown as { name: string | null })?.name ?? "Paciente";
                  return (
                    <div key={a.id} className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${status?.color ?? "bg-gray-100"}`}>
                        {new Date(a.start_time).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="text-sm font-medium">{contactName}</span>
                      {a.reason && (
                        <span className="text-xs text-muted-foreground">— {a.reason}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
