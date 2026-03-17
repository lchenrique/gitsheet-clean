"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Copy, Download, Plus, RefreshCw, Table2 } from "lucide-react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MonthlySheetSummary, SheetEntryRecord, SyncStatusSummary } from "@/types/timesheet";

type FilterMode = "today" | "pending" | "all";
type ExportFormat = "xlsx" | "csv";
type ColumnKey = "project" | "date" | "description" | "startTime" | "endTime" | "duration" | "status";
const REMINDER_SETTINGS_KEY = "gitsheet-reminder-settings";
const LAST_DAY_ENTRY_NOTIFICATION_KEY = "gitsheet-last-day-entry-notification";

interface CellPoint {
  row: number;
  column: number;
}

const columns: Array<{ key: ColumnKey; label: string; editable: boolean; multiline?: boolean; className?: string }> = [
  { key: "project", label: "Projeto", editable: true, className: "w-[280px]" },
  { key: "date", label: "Data", editable: true, className: "w-[152px]" },
  { key: "description", label: "Descrição", editable: true, multiline: true, className: "w-[860px]" },
  { key: "startTime", label: "Início", editable: true, className: "w-[110px]" },
  { key: "endTime", label: "Fim", editable: true, className: "w-[110px]" },
  { key: "duration", label: "Duração", editable: false, className: "w-[120px]" },
  { key: "status", label: "Status", editable: false, className: "w-[120px]" },
];

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

function getCurrentMonth() {
  return getTodayDate().slice(0, 7);
}

function formatMonthLabel(month: string) {
  const [year, monthNumber] = month.split("-");
  return `${monthNumber}/${year}`;
}

function formatDateForSheet(date: string) {
  const [year, month, day] = date.split("-");
  return year && month && day ? `${day}/${month}/${year}` : date;
}

function formatDateTime(value?: string) {
  if (!value) {
    return "Nunca";
  }

  return new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function normalizeTime(value: string, fallback: string) {
  const normalized = value.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(normalized);
  if (!match) {
    return fallback;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || hours > 23 || minutes > 59) {
    return fallback;
  }

  return `${pad(hours)}:${pad(minutes)}`;
}

function normalizeDate(value: string, fallback: string) {
  const normalized = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : fallback;
}

function getDurationLabel(startTime: string, endTime: string) {
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  const totalMinutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);

  if (Number.isNaN(totalMinutes) || totalMinutes <= 0) {
    return "0h 0m";
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function createRange(start: CellPoint | null, end: CellPoint | null) {
  if (!start || !end) {
    return null;
  }

  return {
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
    startColumn: Math.min(start.column, end.column),
    endColumn: Math.max(start.column, end.column),
  };
}

function isInsideRange(point: CellPoint, range: ReturnType<typeof createRange>) {
  if (!range) {
    return false;
  }

  return (
    point.row >= range.startRow &&
    point.row <= range.endRow &&
    point.column >= range.startColumn &&
    point.column <= range.endColumn
  );
}

function getCellValue(row: SheetEntryRecord, column: ColumnKey) {
  switch (column) {
    case "date":
      return formatDateForSheet(row.date);
    case "duration":
      return getDurationLabel(row.startTime, row.endTime);
    case "status":
      return row.status;
    default:
      return row[column];
  }
}

function getRunStatusLabel(summary?: SyncStatusSummary | null) {
  const run = summary?.lastRun;
  if (!run) {
    return "Sem execuções";
  }

  if (run.status === "success") {
    return "Sucesso";
  }

  if (run.reason === "calendar-skip") {
    return "Ignorado";
  }

  if (run.reason === "no-commits") {
    return "Sem commits";
  }

  return "Erro";
}

function sortEntriesByOrder(list: SheetEntryRecord[]) {
  return [...list].sort((a, b) => {
    const orderA = a.sortOrder ?? 0;
    const orderB = b.sortOrder ?? 0;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    if (a.date !== b.date) {
      return a.date.localeCompare(b.date);
    }
    if (a.startTime !== b.startTime) {
      return a.startTime.localeCompare(b.startTime);
    }
    if (a.createdAt !== b.createdAt) {
      return a.createdAt.localeCompare(b.createdAt);
    }
    return a.id.localeCompare(b.id);
  });
}

export default function SheetPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [month, setMonth] = useState(getCurrentMonth());
  const [availableSheets, setAvailableSheets] = useState<MonthlySheetSummary[]>([]);
  const [entries, setEntries] = useState<SheetEntryRecord[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatusSummary | null>(null);
  const [filter, setFilter] = useState<FilterMode>("today");
  const [selectionStart, setSelectionStart] = useState<CellPoint | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<CellPoint | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("xlsx");

  const today = getTodayDate();

  const sortedEntries = useMemo(() => sortEntriesByOrder(entries), [entries]);

  const entryPositions = useMemo(() => {
    const map = new Map<string, number>();
    sortedEntries.forEach((entry, index) => map.set(entry.id, index));
    return map;
  }, [sortedEntries]);

  const filteredEntries = useMemo(() => {
    if (filter === "today") {
      return sortedEntries.filter((entry) => entry.date === today);
    }
    if (filter === "pending") {
      return sortedEntries.filter((entry) => entry.status === "draft");
    }
    return sortedEntries;
  }, [filter, sortedEntries, today]);

  const range = useMemo(() => createRange(selectionStart, selectionEnd), [selectionStart, selectionEnd]);

  useEffect(() => {
    const handleMouseUp = () => setIsSelecting(false);
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  useEffect(() => {
    const todayEntries = entries.filter((entry) => entry.date === today);
    if (!todayEntries.length || typeof window === "undefined" || typeof Notification === "undefined") {
      return;
    }

    try {
      const rawSettings = window.localStorage.getItem(REMINDER_SETTINGS_KEY);
      const reminderEnabled = rawSettings ? Boolean(JSON.parse(rawSettings).dayEntryReminderEnabled) : false;
      if (!reminderEnabled || Notification.permission !== "granted") {
        return;
      }

      const lastNotifiedDate = window.localStorage.getItem(LAST_DAY_ENTRY_NOTIFICATION_KEY);
      if (lastNotifiedDate === today) {
        return;
      }

      const notification = new Notification("GitSheet", {
        body: `${todayEntries.length} linha(s) de hoje entraram na sheet.`,
      });

      notification.onclick = () => {
        window.focus();
      };

      window.localStorage.setItem(LAST_DAY_ENTRY_NOTIFICATION_KEY, today);
    } catch {}
  }, [entries, today]);

  useEffect(() => {
    const handleCopyShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && range) {
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
          return;
        }

        event.preventDefault();
        void copySelectedCells();
      }
    };

    window.addEventListener("keydown", handleCopyShortcut);
    return () => window.removeEventListener("keydown", handleCopyShortcut);
  }, [range, filteredEntries]);

  const loadSheet = async (monthKey: string) => {
    const response = await fetch(`/api/sheets/${monthKey}`);
    if (!response.ok) {
      throw new Error("Não foi possível carregar a sheet.");
    }

    const payload = (await response.json()) as { entries: SheetEntryRecord[] };
    setEntries(payload.entries);
  };

  const loadSyncStatus = async () => {
    const response = await fetch("/api/config");
    if (!response.ok) {
      throw new Error("Não foi possível carregar o status do sync.");
    }

    const payload = (await response.json()) as { syncStatus?: SyncStatusSummary | null };
    setSyncStatus(payload.syncStatus ?? null);
  };

  const refreshSheetContext = async (preferredMonth?: string) => {
    const sheetsResponse = await fetch("/api/sheets");
    if (!sheetsResponse.ok) {
      throw new Error("Não foi possível carregar as sheets.");
    }

    const sheetsPayload = (await sheetsResponse.json()) as { sheets: MonthlySheetSummary[] };
    setAvailableSheets(sheetsPayload.sheets);

    const monthToOpen =
      preferredMonth ??
      (sheetsPayload.sheets.find((sheet) => sheet.month === getCurrentMonth())?.month ??
        sheetsPayload.sheets[0]?.month ??
        getCurrentMonth());

    setMonth(monthToOpen);
    if (sheetsPayload.sheets.length > 0) {
      await loadSheet(monthToOpen);
    } else {
      setEntries([]);
    }

    await loadSyncStatus();
  };

  useEffect(() => {
    let ignore = false;

    const bootstrap = async () => {
      try {
        setIsLoading(true);
        setIsSyncing(false);

        const configResponse = await fetch("/api/config");
        if (!configResponse.ok) {
          throw new Error("Não foi possível carregar a configuração salva.");
        }

        const configPayload = (await configResponse.json()) as { config?: unknown | null };
        if (!configPayload.config) {
          router.replace("/config");
          return;
        }

        if (!ignore) {
          await refreshSheetContext();
        }
      } catch {
        if (!ignore) {
          toast.error("Não foi possível preparar a sheet mensal.");
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
          setIsSyncing(false);
        }
      }
    };

    void bootstrap();

    return () => {
      ignore = true;
    };
  }, [router]);

  const handleMonthChange = async (value: string) => {
    setMonth(value);
    setSelectionStart(null);
    setSelectionEnd(null);
    try {
      await loadSheet(value);
      await loadSyncStatus();
    } catch {
      toast.error("Não foi possível abrir a sheet selecionada.");
    }
  };

  const updateEntryValue = async (
    entryId: string,
    field: "project" | "description" | "date" | "startTime" | "endTime",
    rawValue: string,
  ) => {
    const current = entries.find((entry) => entry.id === entryId);
    if (!current) {
      return;
    }

    const patch =
      field === "date"
        ? (() => {
            const nextDate = normalizeDate(rawValue, current.date);
            return nextDate.startsWith(`${month}-`) ? { date: nextDate, sheetMonth: month } : { date: current.date };
          })()
        : field === "project"
        ? { project: rawValue.trim() || current.project }
        : field === "description"
          ? { description: rawValue.trim() || current.description }
          : field === "startTime"
            ? { startTime: normalizeTime(rawValue, current.startTime) }
            : { endTime: normalizeTime(rawValue, current.endTime) };

    setEntries((currentEntries) =>
      currentEntries.map((entry) =>
        entry.id === entryId ? { ...entry, ...patch, source: "manual", updatedAt: new Date().toISOString() } : entry,
      ),
    );

    const response = await fetch(`/api/sheets/entries/${entryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });

    if (!response.ok) {
      toast.error("Não foi possível salvar a edição.");
      await loadSheet(month);
    }
  };

  const addManualEntry = async () => {
    const defaultDate = month === getCurrentMonth() ? today : `${month}-01`;

    const response = await fetch("/api/sheets/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, date: defaultDate }),
    });

    if (!response.ok) {
      toast.error("Não foi possível adicionar uma nova linha.");
      return;
    }

    const payload = (await response.json()) as { entry: SheetEntryRecord };
    setEntries((currentEntries) => [payload.entry, ...currentEntries]);
    if (filter === "today" && payload.entry.date !== today) {
      setFilter("all");
    }
    setSelectionStart(null);
    setSelectionEnd(null);
    toast.success("Linha manual adicionada.");
  };

  const getSelectedText = () => {
    if (!range) {
      return "";
    }

    const rows: string[] = [];
    for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex += 1) {
      const row = filteredEntries[rowIndex];
      if (!row) {
        continue;
      }

      const values: string[] = [];
      for (let columnIndex = range.startColumn; columnIndex <= range.endColumn; columnIndex += 1) {
        const column = columns[columnIndex];
        if (!column) {
          continue;
        }
        values.push(getCellValue(row, column.key));
      }

      rows.push(values.join("\t"));
    }

    return rows.join("\n");
  };

  const copySelectedCells = async () => {
    const text = getSelectedText();
    if (!text) {
      toast.error("Selecione células da planilha primeiro.");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      toast.success("Seleção copiada.");
    } catch {
      toast.error("Não foi possível copiar a seleção.");
    }
  };

  const approveSelected = async () => {
    if (!range) {
      toast.error("Selecione linhas/células para aprovar.");
      return;
    }

    const ids = new Set<string>();
    for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex += 1) {
      const row = filteredEntries[rowIndex];
      if (row) {
        ids.add(row.id);
      }
    }

    if (!ids.size) {
      return;
    }

    const response = await fetch("/api/sheets/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, entryIds: Array.from(ids) }),
    });

    if (!response.ok) {
      toast.error("Não foi possível aprovar as linhas selecionadas.");
      return;
    }

    setEntries((currentEntries) =>
      currentEntries.map((entry) => (ids.has(entry.id) ? { ...entry, status: "approved" } : entry)),
    );
    toast.success("Linhas selecionadas aprovadas.");
  };

  const deleteSelected = async () => {
    if (!range) {
      toast.error("Selecione linhas para excluir.");
      return;
    }

    const ids = new Set<string>();
    for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex += 1) {
      const row = filteredEntries[rowIndex];
      if (row) {
        ids.add(row.id);
      }
    }

    if (!ids.size) {
      return;
    }

    if (!window.confirm(`Excluir ${ids.size} linha(s)?`)) {
      return;
    }

    const results = await Promise.all(
      Array.from(ids).map((id) =>
        fetch(`/api/sheets/entries/${id}`, { method: "DELETE" }).then((res) => res.ok),
      ),
    );

    if (results.some((ok) => !ok)) {
      toast.error("Não foi possível excluir todas as linhas.");
      await loadSheet(month);
      return;
    }

    setEntries((currentEntries) => currentEntries.filter((entry) => !ids.has(entry.id)));
    setSelectionStart(null);
    setSelectionEnd(null);
    toast.success("Linhas excluídas.");
  };

  const moveEntry = async (entryId: string, direction: "up" | "down") => {
    const response = await fetch("/api/sheets/entries/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId, direction }),
    });

    if (!response.ok) {
      toast.error("Não foi possível mover a linha.");
      await loadSheet(month);
      return;
    }

    const payload = (await response.json()) as {
      currentId: string;
      neighborId: string;
      currentSortOrder: number;
      neighborSortOrder: number;
    };

    setEntries((currentEntries) =>
      currentEntries.map((entry) => {
        if (entry.id === payload.currentId) {
          return { ...entry, sortOrder: payload.neighborSortOrder };
        }
        if (entry.id === payload.neighborId) {
          return { ...entry, sortOrder: payload.currentSortOrder };
        }
        return entry;
      }),
    );
  };

  const approveAllPending = async () => {
    const response = await fetch("/api/sheets/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month }),
    });

    if (!response.ok) {
      toast.error("Não foi possível aprovar as pendências do mês.");
      return;
    }

    setEntries((currentEntries) => currentEntries.map((entry) => ({ ...entry, status: "approved" })));
    toast.success("Pendências aprovadas.");
  };

  const exportRows = filteredEntries.map((entry) => ({
    Projeto: entry.project,
    Data: formatDateForSheet(entry.date),
    Descrição: entry.description,
    Início: entry.startTime,
    Fim: entry.endTime,
    Duração: getDurationLabel(entry.startTime, entry.endTime),
    Status: entry.status,
  }));

  const handleExport = async () => {
    if (!exportRows.length) {
      toast.error("Não há linhas para exportar no filtro atual.");
      return;
    }

    if (exportFormat === "csv") {
      const csv = Papa.unparse(exportRows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `sheet-${month}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } else {
      const worksheet = XLSX.utils.json_to_sheet(exportRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, month);
      XLSX.writeFile(workbook, `sheet-${month}.xlsx`);
    }

    await fetch("/api/sheets/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month }),
    });

    setEntries((currentEntries) =>
      currentEntries.map((entry) =>
        entry.status === "approved" || entry.status === "draft" ? { ...entry, status: "exported" } : entry,
      ),
    );
    toast.success("Sheet exportada.");
    await loadSyncStatus();
  };

  const totalMinutes = filteredEntries.reduce((accumulator, entry) => {
    const [hours, minutes] = getDurationLabel(entry.startTime, entry.endTime)
      .replace("m", "")
      .split("h ")
      .map(Number);
    return accumulator + hours * 60 + minutes;
  }, 0);

  if (isLoading) {
    return (
      <AppShell step={3}>
        <div className="py-16 text-center text-sm text-muted-foreground">
          {isSyncing ? "Sincronizando o dia atual..." : "Carregando sheet mensal..."}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell step={3}>
      <div className="mx-auto max-w-[1850px] space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="mb-1 text-xl font-semibold">Sheet mensal viva</h2>
            <p className="text-sm text-muted-foreground">
              Trabalhe sempre na mesma planilha do mês. As linhas novas do dia entram aqui automaticamente.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="glass-card min-w-[120px] px-4 py-3 text-center">
              <div className="font-mono text-2xl font-bold">{filteredEntries.length}</div>
              <div className="text-xs text-muted-foreground">Linhas visíveis</div>
            </div>
            <div className="glass-card min-w-[120px] px-4 py-3 text-center">
              <div className="font-mono text-2xl font-bold text-primary">
                {Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m
              </div>
              <div className="text-xs text-muted-foreground">Total</div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="glass-card overflow-hidden">
            <div className="border-b border-border px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Table2 className="h-4 w-4 text-primary" />
                    Planilha mensal
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Selecione células para copiar, edite direto nas colunas e aprove em lote.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => void addManualEntry()}>
                    <Plus className="h-4 w-4" />
                    Adicionar linha
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => void copySelectedCells()}>
                    <Copy className="h-4 w-4" />
                    Copiar seleção
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => void approveSelected()}>
                    <Check className="h-4 w-4" />
                    Aprovar selecionadas
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => void deleteSelected()}>
                    Excluir selecionadas
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => void refreshSheetContext(month)}>
                    <RefreshCw className="h-4 w-4" />
                    Recarregar
                  </Button>
                </div>
              </div>
            </div>

            <div className="overflow-auto p-4 2xl:p-5">
              {filteredEntries.length ? (
                <table className="min-w-[1780px] border-separate border-spacing-0 overflow-hidden rounded-xl border border-border">
                  <thead>
                    <tr className="bg-secondary/60">
                      {columns.map((column) => (
                        <th
                          key={column.key}
                          className={`border-b border-r border-border px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground last:border-r-0 ${column.className ?? ""}`}
                        >
                          {column.label}
                        </th>
                      ))}
                      <th className="border-b border-border px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Mover
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntries.map((entry, rowIndex) => (
                      <tr key={entry.id} className={entry.isNewToday ? "bg-primary/5" : "bg-background/40"}>
                        {columns.map((column, columnIndex) => {
                          const point = { row: rowIndex, column: columnIndex };
                          const selected = isInsideRange(point, range);
                          const cellClass = `${selected ? "bg-primary/15" : ""} border-b border-r border-border align-top last:border-r-0`;

                          if (!column.editable) {
                            return (
                              <td
                                key={column.key}
                                className={cellClass}
                                onMouseDown={() => {
                                  setSelectionStart(point);
                                  setSelectionEnd(point);
                                  setIsSelecting(true);
                                }}
                                onMouseEnter={() => {
                                  if (isSelecting) {
                                    setSelectionEnd(point);
                                  }
                                }}
                              >
                                <div className="px-3 py-2 text-sm text-secondary-foreground">
                                  {getCellValue(entry, column.key)}
                                </div>
                              </td>
                            );
                          }

                          const value = column.key === "date" ? entry.date : getCellValue(entry, column.key);
                          if (column.multiline) {
                            return (
                              <td
                                key={column.key}
                                className={cellClass}
                                onMouseDown={() => {
                                  setSelectionStart(point);
                                  setSelectionEnd(point);
                                  setIsSelecting(true);
                                }}
                                onMouseEnter={() => {
                                  if (isSelecting) {
                                    setSelectionEnd(point);
                                  }
                                }}
                              >
                                <textarea
                                  value={value}
                                  onChange={(event) => void updateEntryValue(entry.id, column.key as "description", event.target.value)}
                                  className="min-h-[92px] w-full resize-none bg-transparent px-3 py-2 text-sm leading-6 outline-none"
                                />
                              </td>
                            );
                          }

                          return (
                            <td
                              key={column.key}
                              className={cellClass}
                              onMouseDown={() => {
                                setSelectionStart(point);
                                setSelectionEnd(point);
                                setIsSelecting(true);
                              }}
                              onMouseEnter={() => {
                                if (isSelecting) {
                                  setSelectionEnd(point);
                                }
                              }}
                            >
                              <input
                                type={column.key === "date" ? "date" : column.key === "startTime" || column.key === "endTime" ? "time" : "text"}
                                value={value}
                                onChange={(event) =>
                                  void updateEntryValue(
                                    entry.id,
                                    column.key as "date" | "project" | "startTime" | "endTime",
                                    event.target.value,
                                  )
                                }
                                className="w-full bg-transparent px-3 py-2 text-sm outline-none"
                              />
                            </td>
                          );
                        })}
                        <td className="border-b border-border px-2 py-2 text-center align-top">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              disabled={(entryPositions.get(entry.id) ?? 0) <= 0}
                              onClick={(event) => {
                                event.stopPropagation();
                                void moveEntry(entry.id, "up");
                              }}
                            >
                              <ArrowUp className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              disabled={(entryPositions.get(entry.id) ?? 0) >= sortedEntries.length - 1}
                              onClick={(event) => {
                                event.stopPropagation();
                                void moveEntry(entry.id, "down");
                              }}
                            >
                              <ArrowDown className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
                  Nenhuma linha encontrada para o filtro atual.
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-4">
            <div className="glass-card space-y-4 p-4">
              <div className="grid gap-3 rounded-xl border border-border/70 bg-background/40 p-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Último sync</div>
                  <div className="mt-1 text-sm font-medium">{formatDateTime(syncStatus?.lastRun?.createdAt)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {getRunStatusLabel(syncStatus)}
                    {syncStatus?.lastRun?.trigger ? ` via ${syncStatus.lastRun.trigger}` : ""}
                  </div>
                </div>

                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Último erro</div>
                  <div className="mt-1 text-sm font-medium">{formatDateTime(syncStatus?.lastError?.createdAt)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {syncStatus?.lastError?.message ?? "Nenhum erro registrado."}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Mês</Label>
                <Select value={month} onValueChange={(value) => void handleMonthChange(value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o mês" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSheets.map((sheet) => (
                      <SelectItem key={sheet.month} value={sheet.month}>
                        {formatMonthLabel(sheet.month)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Filtro</Label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: "today" as const, label: "Hoje" },
                    { key: "pending" as const, label: "Pendentes" },
                    { key: "all" as const, label: "Todos" },
                  ].map((option) => (
                    <Button
                      key={option.key}
                      type="button"
                      variant={filter === option.key ? "default" : "outline"}
                      size="sm"
                      onClick={() => setFilter(option.key)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <div className="glass-card space-y-3 p-4">
              <div className="space-y-2">
                <Label>Exportar</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={exportFormat === "xlsx" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setExportFormat("xlsx")}
                  >
                    XLSX
                  </Button>
                  <Button
                    type="button"
                    variant={exportFormat === "csv" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setExportFormat("csv")}
                  >
                    CSV
                  </Button>
                </div>
              </div>

              <Button className="w-full gap-2" onClick={() => void approveAllPending()}>
                <Check className="h-4 w-4" />
                Aprovar pendentes
              </Button>
              <Button variant="outline" className="w-full gap-2" onClick={() => void handleExport()}>
                <Download className="h-4 w-4" />
                Exportar mês
              </Button>
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
