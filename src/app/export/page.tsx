"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Check, Copy, Download, Eye, FileSpreadsheet, FileText } from "lucide-react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { useTimesheetStore } from "@/store/timesheetStore";
import type { DayDraft, TimesheetEntry } from "@/types/timesheet";

type ExportFormat = "csv" | "xlsx";
type ColumnKey = "project" | "date" | "description" | "startTime" | "endTime" | "duration";

interface ExportRow {
  dayId: string;
  entryId: string;
  project: string;
  date: string;
  description: string;
  startTime: string;
  endTime: string;
  duration: string;
}

interface CellPoint {
  row: number;
  column: number;
}

const columns: Array<{ key: ColumnKey; label: string; editable: boolean; multiline?: boolean; className?: string }> = [
  { key: "project", label: "Projeto", editable: true, className: "w-[220px]" },
  { key: "date", label: "Data", editable: false, className: "w-[140px]" },
  { key: "description", label: "Descrição", editable: true, multiline: true, className: "w-[520px]" },
  { key: "startTime", label: "Início", editable: true, className: "w-[110px]" },
  { key: "endTime", label: "Fim", editable: true, className: "w-[110px]" },
  { key: "duration", label: "Duração", editable: false, className: "w-[120px]" },
];

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

function formatDateForSheet(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    return date;
  }

  return `${match[3]}/${match[2]}/${match[1]}`;
}

function parseSheetDate(value: string, fallback: string) {
  const normalized = value.trim();
  const brDate = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(normalized);
  if (brDate) {
    return `${brDate[3]}-${brDate[2]}-${brDate[1]}`;
  }

  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (isoDate) {
    return normalized;
  }

  return fallback;
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

function createSheetRow(day: DayDraft, entry: TimesheetEntry): ExportRow {
  return {
    dayId: day.id,
    entryId: entry.id,
    project: entry.project,
    date: entry.date,
    description: entry.description,
    startTime: entry.startTime,
    endTime: entry.endTime,
    duration: getDurationLabel(entry.startTime, entry.endTime),
  };
}

function toExportPayload(rows: ExportRow[]) {
  return rows.map((row) => ({
    Projeto: row.project,
    Data: formatDateForSheet(row.date),
    Descrição: row.description,
    Início: row.startTime,
    Fim: row.endTime,
    Duração: row.duration,
  }));
}

function getCellValue(row: ExportRow, column: ColumnKey) {
  if (column === "date") {
    return formatDateForSheet(row.date);
  }

  return row[column];
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

export default function ExportPage() {
  const router = useRouter();
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [selectionStart, setSelectionStart] = useState<CellPoint | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<CellPoint | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const { dayDrafts, updateDayDraft } = useTimesheetStore();

  const exportableDays = useMemo(
    () => dayDrafts.filter((day) => day.status === "approved" || day.status === "exported"),
    [dayDrafts],
  );

  const initialRows = useMemo(
    () => exportableDays.flatMap((day) => day.entries.map((entry) => createSheetRow(day, entry))),
    [exportableDays],
  );

  const [sheetRows, setSheetRows] = useState<ExportRow[]>(initialRows);

  useEffect(() => {
    setSheetRows(initialRows);
  }, [initialRows]);

  const range = useMemo(() => createRange(selectionStart, selectionEnd), [selectionStart, selectionEnd]);
  const exportRows = useMemo(() => toExportPayload(sheetRows), [sheetRows]);

  const totalDuration = useMemo(() => {
    return sheetRows.reduce((accumulator, row) => {
      const [hours, minutes] = row.duration.replace("m", "").split("h ").map(Number);
      return accumulator + hours * 60 + minutes;
    }, 0);
  }, [sheetRows]);

  const formattedTotalDuration = `${Math.floor(totalDuration / 60)}h ${totalDuration % 60}m`;

  useEffect(() => {
    const handleMouseUp = () => setIsSelecting(false);
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

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
  }, [range, sheetRows]);

  const syncRowsToStore = (rows: ExportRow[]) => {
    const entriesByDay = new Map<string, TimesheetEntry[]>();

    for (const row of rows) {
      const current = entriesByDay.get(row.dayId) ?? [];
      current.push({
        id: row.entryId,
        project: row.project,
        date: row.date,
        description: row.description,
        startTime: row.startTime,
        endTime: row.endTime,
      });
      entriesByDay.set(row.dayId, current);
    }

    for (const [dayId, entries] of entriesByDay) {
      updateDayDraft(dayId, { entries });
    }
  };

  const updateRowValue = (rowIndex: number, column: ColumnKey, rawValue: string) => {
    setSheetRows((currentRows) => {
      const nextRows = currentRows.map((row, index) => {
        if (index !== rowIndex) {
          return row;
        }

        if (column === "date" || column === "duration") {
          return row;
        }

        const nextRow = { ...row };

        if (column === "startTime") {
          nextRow.startTime = normalizeTime(rawValue, row.startTime);
        } else if (column === "endTime") {
          nextRow.endTime = normalizeTime(rawValue, row.endTime);
        } else if (column === "project") {
          nextRow.project = rawValue.trim() || row.project;
        } else if (column === "description") {
          nextRow.description = rawValue.trim() || row.description;
        }

        nextRow.date = parseSheetDate(formatDateForSheet(nextRow.date), row.date);
        nextRow.duration = getDurationLabel(nextRow.startTime, nextRow.endTime);
        return nextRow;
      });

      syncRowsToStore(nextRows);
      return nextRows;
    });
  };

  const getSelectedText = () => {
    if (!range) {
      return "";
    }

    const selectedRows: string[] = [];
    for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex += 1) {
      const row = sheetRows[rowIndex];
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
      selectedRows.push(values.join("\t"));
    }

    return selectedRows.join("\n");
  };

  const copySelectedCells = async () => {
    const text = getSelectedText();
    if (!text) {
      toast.error("Selecione uma ou mais células primeiro.");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      toast.success("Seleção copiada para a área de transferência.");
    } catch {
      toast.error("Não foi possível copiar a seleção.");
    }
  };

  const exportCSV = () => {
    const csv = Papa.unparse(exportRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `timesheet-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportXLSX = () => {
    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    worksheet["!cols"] = [
      { wch: 24 },
      { wch: 14 },
      { wch: 64 },
      { wch: 10 },
      { wch: 10 },
      { wch: 12 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Timesheet");
    XLSX.writeFile(workbook, `timesheet-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleExport = () => {
    if (!exportRows.length) {
      toast.error("Não há dias aprovados para exportar.");
      return;
    }

    if (format === "csv") {
      exportCSV();
    } else {
      exportXLSX();
    }

    exportableDays.forEach((day) => {
      if (day.status !== "exported") {
        updateDayDraft(day.id, { status: "exported" });
      }
    });

    toast.success(`Timesheet exportado como ${format.toUpperCase()}.`);
  };

  const formats = [
    { key: "xlsx" as const, label: "Excel (XLSX)", icon: FileSpreadsheet, desc: "Planilha formatada e pronta para envio" },
    { key: "csv" as const, label: "CSV", icon: FileText, desc: "Arquivo leve para abrir em qualquer editor" },
  ];

  return (
    <AppShell title="Exportar Timesheet">
      <div className="mx-auto max-w-7xl space-y-6">
        <Button variant="ghost" onClick={() => router.push("/sheet")} className="gap-2 -ml-2">
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Button>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="mb-1 text-xl font-semibold">Planilha online do timesheet</h2>
            <p className="text-sm text-muted-foreground">
              Revise a planilha no navegador, ajuste o que precisar e exporte no formato final.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 text-sm">
            <div className="glass-card min-w-[120px] px-4 py-3 text-center">
              <div className="font-mono text-2xl font-bold">{exportableDays.length}</div>
              <div className="text-xs text-muted-foreground">Dias</div>
            </div>
            <div className="glass-card min-w-[120px] px-4 py-3 text-center">
              <div className="font-mono text-2xl font-bold text-primary">{sheetRows.length}</div>
              <div className="text-xs text-muted-foreground">Linhas</div>
            </div>
            <div className="glass-card min-w-[120px] px-4 py-3 text-center">
              <div className="font-mono text-2xl font-bold">{formattedTotalDuration}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="glass-card overflow-hidden">
            <div className="border-b border-border px-5 py-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Eye className="h-4 w-4 text-primary" />
                Prévia da planilha
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Você pode editar projeto, descrição e horários direto aqui. Data e duração são automáticas.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Arraste para selecionar células e copie com <span className="font-mono">Ctrl/Cmd + C</span> ou pelo botão.
              </p>
            </div>

            <div className="overflow-auto p-4">
              {sheetRows.length ? (
                <div className="space-y-3">
                  <div className="flex justify-end">
                    <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => void copySelectedCells()}>
                      <Copy className="h-4 w-4" />
                      Copiar seleção
                    </Button>
                  </div>

                  <div className="overflow-auto rounded-xl border border-border bg-card">
                    <table className="w-full min-w-[1120px] border-collapse text-sm">
                      <thead>
                        <tr className="bg-secondary/60 text-muted-foreground">
                          {columns.map((column) => (
                            <th key={column.key} className={`border border-border px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] ${column.className ?? ""}`}>
                              {column.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sheetRows.map((row, rowIndex) => (
                          <tr key={row.entryId} className="align-top">
                            {columns.map((column, columnIndex) => {
                              const point = { row: rowIndex, column: columnIndex };
                              const selected = isInsideRange(point, range);
                              const value = getCellValue(row, column.key);

                              return (
                                <td
                                  key={column.key}
                                  className={`border border-border bg-card transition-colors ${selected ? "bg-primary/10 ring-1 ring-inset ring-primary" : ""}`}
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
                                  {column.editable ? (
                                    column.multiline ? (
                                      <textarea
                                        value={value}
                                        onChange={(event) => updateRowValue(rowIndex, column.key, event.target.value)}
                                        onFocus={() => {
                                          setSelectionStart(point);
                                          setSelectionEnd(point);
                                        }}
                                        className="min-h-[92px] w-full resize-none border-0 bg-transparent px-4 py-3 text-sm text-foreground outline-none"
                                      />
                                    ) : (
                                      <input
                                        value={value}
                                        onChange={(event) => updateRowValue(rowIndex, column.key, event.target.value)}
                                        onFocus={() => {
                                          setSelectionStart(point);
                                          setSelectionEnd(point);
                                        }}
                                        className="h-[54px] w-full border-0 bg-transparent px-4 py-3 text-sm text-foreground outline-none"
                                      />
                                    )
                                  ) : (
                                    <div className={`px-4 py-3 ${column.key === "duration" ? "font-semibold text-muted-foreground" : "text-foreground"}`}>
                                      {value}
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-[280px] items-center justify-center rounded-xl border border-dashed border-border bg-secondary/30 p-8 text-center text-sm text-muted-foreground">
                  Aprove alguns dias primeiro para montar a planilha online.
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-4">
            <div className="glass-card p-4">
              <span className="text-sm text-muted-foreground">Formato de saída</span>
              <div className="mt-3 grid gap-2">
                {formats.map((option) => (
                  <motion.button
                    key={option.key}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setFormat(option.key)}
                    className={`flex items-center gap-4 rounded-lg border px-4 py-3 text-left transition-all ${
                      format === option.key
                        ? "border-primary/50 bg-primary/5"
                        : "border-border bg-secondary/50 hover:border-muted-foreground/30"
                    }`}
                  >
                    <option.icon className={`h-5 w-5 ${format === option.key ? "text-primary" : "text-muted-foreground"}`} />
                    <div className="flex-1">
                      <div className="text-sm font-medium">{option.label}</div>
                      <div className="text-xs text-muted-foreground">{option.desc}</div>
                    </div>
                    {format === option.key && (
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                        <Check className="h-3 w-3 text-primary-foreground" />
                      </div>
                    )}
                  </motion.button>
                ))}
              </div>
            </div>

            <div className="glass-card p-4">
              <div className="text-sm font-medium">Layout da planilha</div>
              <p className="mt-1 text-xs text-muted-foreground">
                O arquivo sai na mesma ordem da prévia: projeto, data, descrição, início, fim e duração.
              </p>
            </div>

            <Button onClick={handleExport} className="h-11 w-full gap-2" size="lg">
              <Download className="h-4 w-4" />
              Exportar como {format.toUpperCase()}
            </Button>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
