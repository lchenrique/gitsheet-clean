"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, FolderGit2, GitBranch, Loader2, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { buildTimeWindows } from "@/lib/generateDayDrafts";
import { useTimesheetStore } from "@/store/timesheetStore";
import { Commit, DayDraft, SyncConfigRecord } from "@/types/timesheet";

interface BranchResponseItem {
  fullName: string;
  branches: string[];
}

interface DraftResponse {
  drafts: DayDraft[];
  mode: "ai";
  warning?: string;
}

export default function DateConfigPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const {
    selectedRepos,
    startDate: savedStart,
    endDate: savedEnd,
    includeSaturday: savedIncludeSaturday,
    includeSunday: savedIncludeSunday,
    firstBlockStart: savedFirstBlockStart,
    firstBlockEnd: savedFirstBlockEnd,
    secondBlockStart: savedSecondBlockStart,
    secondBlockEnd: savedSecondBlockEnd,
    setDateRange,
    setDayDrafts,
    setSelectedRepos,
    setIncludeSaturday,
    setIncludeSunday,
    setScheduleDefaults,
    githubPat,
  } = useTimesheetStore();
  const [startDate, setStartDate] = useState(savedStart || "2026-03-01");
  const [endDate, setEndDate] = useState(savedEnd || "2026-03-11");
  const [includeSaturday, setIncludeSaturdayLocal] = useState(savedIncludeSaturday ?? false);
  const [includeSunday, setIncludeSundayLocal] = useState(savedIncludeSunday ?? false);
  const [firstBlockStart, setFirstBlockStart] = useState(savedFirstBlockStart || "09:00");
  const [firstBlockEnd, setFirstBlockEnd] = useState(savedFirstBlockEnd || "13:00");
  const [secondBlockStart, setSecondBlockStart] = useState(savedSecondBlockStart || "14:00");
  const [secondBlockEnd, setSecondBlockEnd] = useState(savedSecondBlockEnd || "18:00");
  const [loading, setLoading] = useState(false);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [configHydrated, setConfigHydrated] = useState(false);
  const [allowReconfigure] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("reconfigure") === "1",
  );

  const selectedRepoNames = useMemo(() => selectedRepos.map((repo) => repo.fullName), [selectedRepos]);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }

  }, [router, status]);

  useEffect(() => {
    if (status !== "authenticated" || configHydrated) {
      return;
    }

    let ignore = false;

    const loadPersistedConfig = async () => {
      try {
        const response = await fetch("/api/config");
        if (!response.ok) {
          throw new Error("Falha ao carregar a configuração salva.");
        }

        const payload = (await response.json()) as { config: SyncConfigRecord | null };
        if (ignore) {
          return;
        }

        if (payload.config) {
          setSelectedRepos(
            payload.config.repos.map((repo) => ({
              id: repo.id,
              name: repo.fullName.split("/")[1] || repo.fullName,
              fullName: repo.fullName,
              owner: repo.fullName.split("/")[0] || "",
              isOrg: true,
              selected: true,
              defaultBranch: repo.defaultBranch,
              selectedBranch: repo.selectedBranch,
            })),
          );

          if (payload.config.bootstrapStartDate) {
            setStartDate(payload.config.bootstrapStartDate);
          }

          if (payload.config.bootstrapEndDate) {
            setEndDate(payload.config.bootstrapEndDate);
          }

          if (payload.config.bootstrapStartDate && payload.config.bootstrapEndDate) {
            setDateRange(
              payload.config.bootstrapStartDate,
              payload.config.bootstrapEndDate,
              payload.config.includeSaturday,
              payload.config.includeSunday,
            );
          }

          setIncludeSaturdayLocal(payload.config.includeSaturday);
          setIncludeSundayLocal(payload.config.includeSunday);
          setIncludeSaturday(payload.config.includeSaturday);
          setIncludeSunday(payload.config.includeSunday);
          setFirstBlockStart(payload.config.firstBlockStart);
          setFirstBlockEnd(payload.config.firstBlockEnd);
          setSecondBlockStart(payload.config.secondBlockStart);
          setSecondBlockEnd(payload.config.secondBlockEnd);
          setScheduleDefaults({
            firstBlockStart: payload.config.firstBlockStart,
            firstBlockEnd: payload.config.firstBlockEnd,
            secondBlockStart: payload.config.secondBlockStart,
            secondBlockEnd: payload.config.secondBlockEnd,
          });
        } else if (!selectedRepos.length) {
          router.replace("/repos");
          return;
        }
      } catch {
        if (!selectedRepos.length) {
          router.replace("/repos");
          return;
        }
      } finally {
        if (!ignore) {
          setConfigHydrated(true);
        }
      }
    };

    void loadPersistedConfig();

    return () => {
      ignore = true;
    };
  }, [
    configHydrated,
    setDateRange,
    router,
    selectedRepos.length,
    setIncludeSaturday,
    setIncludeSunday,
    setScheduleDefaults,
    setSelectedRepos,
    status,
    allowReconfigure,
  ]);

  useEffect(() => {
    if (!selectedRepos.length) {
      return;
    }

    const reposMissingBranches = selectedRepos.filter((repo) => !repo.branches?.length);
    if (!reposMissingBranches.length) {
      return;
    }

    let ignore = false;

    const loadBranches = async () => {
      setBranchesLoading(true);

      try {
        const headers: HeadersInit = { "Content-Type": "application/json" };
        if (githubPat) {
          headers["x-github-token"] = githubPat;
        }

        const response = await fetch("/api/branches", {
          method: "POST",
          headers,
          body: JSON.stringify({
            repos: reposMissingBranches.map((repo) => ({
              fullName: repo.fullName,
              defaultBranch: repo.defaultBranch,
            })),
          }),
        });

        if (!response.ok) {
          throw new Error("Não foi possível carregar as branches dos repositórios selecionados.");
        }

        const branchData = (await response.json()) as BranchResponseItem[];
        if (ignore) {
          return;
        }

        const branchMap = new Map(branchData.map((item) => [item.fullName, item.branches]));

        setSelectedRepos(
          selectedRepos.map((repo) => {
            const branches = branchMap.get(repo.fullName) ?? repo.branches ?? [];
            const selectedBranch = branches.includes(repo.selectedBranch)
              ? repo.selectedBranch
              : branches.includes(repo.defaultBranch)
                ? repo.defaultBranch
                : branches[0] || repo.defaultBranch;

            return {
              ...repo,
              branches,
              selectedBranch,
            };
          }),
        );
      } catch (error) {
        if (!ignore) {
          const message =
            error instanceof Error ? error.message : "Não foi possível carregar as branches dos repositórios.";
          toast.error(message);
        }
      } finally {
        if (!ignore) {
          setBranchesLoading(false);
        }
      }
    };

    void loadBranches();

    return () => {
      ignore = true;
    };
  }, [githubPat, selectedRepos, setSelectedRepos]);

  const updateRepoBranch = (repoId: string, branch: string) => {
    setSelectedRepos(
      selectedRepos.map((repo) =>
        repo.id === repoId
          ? {
              ...repo,
              selectedBranch: branch,
            }
          : repo,
      ),
    );
  };

  const handleSync = async () => {
    if (!session?.accessToken && !githubPat) {
      toast.error("Faça login no GitHub ou informe um PAT para sincronizar.");
      return;
    }

    setLoading(true);
    setDateRange(startDate, endDate, includeSaturday, includeSunday);
    setIncludeSaturday(includeSaturday);
    setIncludeSunday(includeSunday);
    const schedule = buildTimeWindows({
      firstBlockStart,
      firstBlockEnd,
      secondBlockStart,
      secondBlockEnd,
    });
    setScheduleDefaults({
      firstBlockStart: schedule[0].start,
      firstBlockEnd: schedule[0].end,
      secondBlockStart: schedule[1].start,
      secondBlockEnd: schedule[1].end,
    });

    try {
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (githubPat) {
        headers["x-github-token"] = githubPat;
      }

      const commitsResponse = await fetch("/api/commits", {
        method: "POST",
        headers,
        body: JSON.stringify({
          repos: selectedRepos.map((repo) => ({
            fullName: repo.fullName,
            branch: repo.selectedBranch || repo.defaultBranch,
          })),
          startDate,
          endDate,
          username: session?.login,
        }),
      });

      if (!commitsResponse.ok) {
        let message = "Falha ao sincronizar commits";

        try {
          const payload = (await commitsResponse.json()) as { error?: string };
          if (payload.error) {
            message = payload.error;
          }
        } catch {
          const fallback = await commitsResponse.text();
          if (fallback) {
            message = fallback;
          }
        }

        throw new Error(message);
      }

      const commits = (await commitsResponse.json()) as Commit[];
      if (commits.length === 0) {
        setDayDrafts([]);
        toast.info("Nenhum commit foi encontrado no período e nas branches selecionadas.");
        return;
      }

      const draftsResponse = await fetch("/api/day-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commits,
          startDate,
          endDate,
          includeSaturday,
          includeSunday,
          timeWindows: schedule,
        }),
      });

      if (!draftsResponse.ok) {
        let message = "A IA não conseguiu gerar os drafts do timesheet.";

        try {
          const payload = (await draftsResponse.json()) as { error?: string };
          if (payload.error) {
            message = payload.error;
          }
        } catch {
          const fallback = await draftsResponse.text();
          if (fallback) {
            message = fallback;
          }
        }

        throw new Error(message);
      }

      const payload = (await draftsResponse.json()) as DraftResponse;
      const drafts = payload.drafts;

      if (drafts.length === 0) {
        setDayDrafts([]);
        toast.info("Os commits foram encontrados, mas a IA não retornou drafts aproveitáveis.");
        return;
      }

      setDayDrafts(drafts);

      const setupResponse = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repos: selectedRepos.map((repo) => ({
            id: repo.id,
            fullName: repo.fullName,
            defaultBranch: repo.defaultBranch,
            selectedBranch: repo.selectedBranch || repo.defaultBranch,
          })),
          includeSaturday,
          includeSunday,
          firstBlockStart: schedule[0].start,
          firstBlockEnd: schedule[0].end,
          secondBlockStart: schedule[1].start,
          secondBlockEnd: schedule[1].end,
          startDate,
          endDate,
          drafts,
          githubPat,
        }),
      });

      if (!setupResponse.ok) {
        throw new Error("Não foi possível salvar a configuração inicial.");
      }

      toast.success("Setup salvo e sheet mensal criada.");
      router.push("/sheet");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível sincronizar os commits do GitHub.";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell title="Configurar Período" step={2}>
      <div className="mx-auto max-w-lg space-y-8">
        <div>
          <h2 className="mb-1 text-xl font-semibold">Definir período de varredura</h2>
          <p className="text-sm text-muted-foreground">
            Informe o intervalo de datas para buscar seus commits e gerar o timesheet.
          </p>
        </div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card space-y-4 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FolderGit2 className="h-4 w-4 text-primary" />
                Repositórios selecionados
              </div>
              <p className="text-sm text-muted-foreground">
                {selectedRepoNames.length} repositório{selectedRepoNames.length !== 1 ? "s" : ""} selecionado
                {selectedRepoNames.length !== 1 ? "s" : ""} para a sincronização.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => router.push("/repos?reconfigure=1")}>
              Alterar
            </Button>
          </div>

          <div className="space-y-3">
            {selectedRepos.map((repo) => (
              <div
                key={repo.id}
                className="flex flex-col gap-3 rounded-xl border border-border/70 bg-background/40 p-3 md:flex-row md:items-center md:justify-between"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="max-w-full font-mono text-xs">
                    <span className="truncate">{repo.fullName}</span>
                  </Badge>
                  <Badge variant="outline" className="font-mono text-[11px]">
                    padrão: {repo.defaultBranch}
                  </Badge>
                </div>

                <div className="min-w-0 md:w-52">
                  <Label htmlFor={`branch-${repo.id}`} className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <GitBranch className="h-3.5 w-3.5" />
                    Branch
                  </Label>
                  <Select
                    value={repo.selectedBranch || repo.defaultBranch}
                    onValueChange={(branch) => updateRepoBranch(repo.id, branch)}
                    disabled={branchesLoading || !repo.branches?.length}
                  >
                    <SelectTrigger id={`branch-${repo.id}`} className="bg-secondary font-mono text-xs">
                      <SelectValue placeholder={branchesLoading ? "Carregando branches..." : "Selecione a branch"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(repo.branches || [repo.defaultBranch]).map((branch) => (
                        <SelectItem key={branch} value={branch} className="font-mono text-xs">
                          {branch}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card space-y-6 p-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startDate" className="text-sm text-muted-foreground">
                Data Inicial
              </Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="border-border bg-secondary font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate" className="text-sm text-muted-foreground">
                Data Final
              </Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="border-border bg-secondary font-mono"
              />
            </div>
          </div>

          <div className="grid gap-3 rounded-xl border border-border/70 bg-background/40 px-4 py-3 md:grid-cols-2">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="include-saturday" className="text-sm font-medium">
                  Incluir sábado
                </Label>
                <p className="text-sm text-muted-foreground">Permite gerar drafts aos sábados.</p>
              </div>
              <Switch
                id="include-saturday"
                checked={includeSaturday}
                onCheckedChange={(checked) => {
                  setIncludeSaturdayLocal(checked);
                  setIncludeSaturday(checked);
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="include-sunday" className="text-sm font-medium">
                  Incluir domingo
                </Label>
                <p className="text-sm text-muted-foreground">Permite gerar drafts aos domingos.</p>
              </div>
              <Switch
                id="include-sunday"
                checked={includeSunday}
                onCheckedChange={(checked) => {
                  setIncludeSundayLocal(checked);
                  setIncludeSunday(checked);
                }}
              />
            </div>
          </div>

          <div className="grid gap-4 rounded-xl border border-border/70 bg-background/40 px-4 py-4 md:grid-cols-2">
            <div className="space-y-4">
              <div className="text-sm font-medium">Bloco 1</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="first-block-start" className="text-sm text-muted-foreground">
                    Início
                  </Label>
                  <Input
                    id="first-block-start"
                    type="time"
                    value={firstBlockStart}
                    onChange={(event) => setFirstBlockStart(event.target.value)}
                    className="border-border bg-secondary font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="first-block-end" className="text-sm text-muted-foreground">
                    Fim
                  </Label>
                  <Input
                    id="first-block-end"
                    type="time"
                    value={firstBlockEnd}
                    onChange={(event) => setFirstBlockEnd(event.target.value)}
                    className="border-border bg-secondary font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="text-sm font-medium">Bloco 2</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="second-block-start" className="text-sm text-muted-foreground">
                    Início
                  </Label>
                  <Input
                    id="second-block-start"
                    type="time"
                    value={secondBlockStart}
                    onChange={(event) => setSecondBlockStart(event.target.value)}
                    className="border-border bg-secondary font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="second-block-end" className="text-sm text-muted-foreground">
                    Fim
                  </Label>
                  <Input
                    id="second-block-end"
                    type="time"
                    value={secondBlockEnd}
                    onChange={(event) => setSecondBlockEnd(event.target.value)}
                    className="border-border bg-secondary font-mono"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="glass-card flex items-center gap-3 px-4 py-3">
            <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
            <span className="text-sm text-muted-foreground">
              Após a carga inicial, o sistema pode distribuir os commits ao longo do período selecionado.
            </span>
          </div>

          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
            <div className="mb-1 flex items-center gap-2 font-medium text-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              Resumo com IA
            </div>
            O sistema só aceita resumos gerados pela IA em até 2 blocos de horário, usando exatamente as faixas que
            você definiu acima. Se a IA falhar, o fluxo é interrompido para você tentar novamente.
          </div>
        </motion.div>

        <div className="flex justify-end">
          <Button onClick={handleSync} disabled={loading || branchesLoading || !startDate || !endDate} className="gap-2">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Gerando drafts...
              </>
            ) : (
              <>
                Sincronizar
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
