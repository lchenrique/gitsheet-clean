"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { ArrowRight, Building2, Check, ChevronDown, Search, User } from "lucide-react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Repository, SyncConfigRecord } from "@/types/timesheet";
import { useTimesheetStore } from "@/store/timesheetStore";

export default function RepoSelectionPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [repos, setRepos] = useState<Repository[]>([]);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | "personal" | "orgs">("all");
  const [isLoading, setIsLoading] = useState(true);
  const [patInput, setPatInput] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const { selectedRepos, setSelectedRepos, githubPat, setGithubPat } = useTimesheetStore();
  const [allowReconfigure] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("reconfigure") === "1",
  );

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [router, status]);

  useEffect(() => {
    setPatInput(githubPat);
  }, [githubPat]);

  useEffect(() => {
    if (!session?.accessToken && !githubPat) {
      return;
    }

    const loadRepos = async () => {
      setIsLoading(true);
      try {
        const headers: HeadersInit = {};
        if (githubPat) {
          headers["x-github-token"] = githubPat;
        }

        const configResponse = await fetch("/api/config");
        const configPayload = configResponse.ok
          ? ((await configResponse.json()) as { config: SyncConfigRecord | null })
          : { config: null };

        if (configPayload.config && !allowReconfigure) {
          router.replace("/sheet");
          return;
        }

        const response = await fetch("/api/repos", { headers });
        if (!response.ok) {
          throw new Error("Falha ao buscar repositórios");
        }

        const apiRepos = (await response.json()) as Repository[];
        const configRepos: Repository[] =
          configPayload.config?.repos.map((repo) => ({
            id: repo.id,
            name: repo.fullName.split("/")[1] || repo.fullName,
            fullName: repo.fullName,
            owner: repo.fullName.split("/")[0] || "",
            isOrg: true,
            selected: true,
            defaultBranch: repo.defaultBranch,
            selectedBranch: repo.selectedBranch,
          })) ?? [];
        const persistedRepos: Repository[] = configRepos.length > 0 ? configRepos : selectedRepos;
        const selectedById = new Map(persistedRepos.map((repo) => [repo.id, repo]));
        if (persistedRepos.length) {
          setSelectedRepos(persistedRepos);
        }
        setRepos(
          apiRepos.map((repo) => {
            const persisted = selectedById.get(repo.id);
            return {
              ...repo,
              selected: Boolean(persisted),
              selectedBranch: persisted?.selectedBranch || repo.selectedBranch || repo.defaultBranch,
              branches: persisted?.branches,
            };
          }),
        );
      } catch {
        toast.error("Não foi possível carregar os repositórios do GitHub.");
      } finally {
        setIsLoading(false);
      }
    };

    void loadRepos();
  }, [allowReconfigure, githubPat, router, session?.accessToken]);

  useEffect(() => {
    const selectedById = new Map(selectedRepos.map((repo) => [repo.id, repo]));
    setRepos((current) =>
      current.map((repo) => {
        const persisted = selectedById.get(repo.id);
        return {
          ...repo,
          selected: Boolean(persisted),
          selectedBranch: persisted?.selectedBranch || repo.selectedBranch || repo.defaultBranch,
          branches: persisted?.branches || repo.branches,
        };
      }),
    );
  }, [selectedRepos]);

  const handleApplyPat = () => {
    setGithubPat(patInput);
    toast.success("PAT atualizado. Recarregando repositórios...");
  };

  const filtered = useMemo(() => {
    let result = repos.filter((repo) => repo.fullName.toLowerCase().includes(search.toLowerCase()));

    if (filterType === "personal") {
      result = result.filter((repo) => !repo.isOrg);
    } else if (filterType === "orgs") {
      result = result.filter((repo) => repo.isOrg);
    }

    return result;
  }, [repos, search, filterType]);

  const grouped = useMemo(() => {
    const res: Record<string, Repository[]> = {};

    const personal = filtered.filter((repo) => !repo.isOrg);
    if (personal.length > 0) {
      res.Pessoal = personal;
    }

    filtered.forEach((repo) => {
      if (repo.isOrg) {
        const orgName = repo.fullName.split("/")[0];
        if (!res[orgName]) res[orgName] = [];
        res[orgName].push(repo);
      }
    });

    return res;
  }, [filtered]);

  useEffect(() => {
    setOpenGroups((current) => {
      const next: Record<string, boolean> = {};
      for (const name of Object.keys(grouped)) {
        next[name] = current[name] ?? true;
      }
      return next;
    });
  }, [grouped]);

  const selectedCount = repos.filter((repo) => repo.selected).length;

  const syncSelectedRepos = (updatedRepos: Repository[]) => {
    setSelectedRepos(updatedRepos.filter((repo) => repo.selected));
  };

  const toggleRepo = (id: string) => {
    setRepos((current) => {
      const updated = current.map((repo) => (repo.id === id ? { ...repo, selected: !repo.selected } : repo));
      syncSelectedRepos(updated);
      return updated;
    });
  };

  const toggleGroup = (groupName: string, select: boolean) => {
    setRepos((current) => {
      const updated = current.map((repo) => {
        const repoOrg = repo.isOrg ? repo.fullName.split("/")[0] : "Pessoal";
        if (repoOrg === groupName) {
          return { ...repo, selected: select };
        }
        return repo;
      });
      syncSelectedRepos(updated);
      return updated;
    });
  };

  const handleContinue = () => {
    const selected = repos.filter((repo) => repo.selected);
    setSelectedRepos(selected);
    router.push(allowReconfigure ? "/config?reconfigure=1" : "/config");
  };

  return (
    <AppShell title="Selecionar Repositórios" step={1}>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-xl font-semibold mb-1">Escolha seus repositórios</h2>
            <p className="text-muted-foreground text-sm">
              Selecione os repositórios que deseja monitorar para gerar o timesheet.
            </p>
          </div>

          <div className="glass-card p-3 sm:p-4 space-y-2">
            <p className="text-xs text-muted-foreground">
              Se as repos de organização não aparecerem via OAuth, informe um Personal Access Token (classic) com escopos
              <span className="font-mono"> repo, read:org </span>.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                type="password"
                placeholder="ghp_xxxxxxxxxxxxxxxxx"
                value={patInput}
                onChange={(event) => setPatInput(event.target.value)}
                className="bg-secondary border-border font-mono text-xs"
              />
              <Button onClick={handleApplyPat} className="sm:w-auto w-full">
                Aplicar PAT
              </Button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-10 bg-secondary border-border"
              />
            </div>

            <div className="flex p-1 bg-secondary border border-border rounded-lg">
              {[
                { id: "all", label: "Todos" },
                { id: "personal", label: "Pessoais" },
                { id: "orgs", label: "Orgs" },
              ].map((t: { id: "all" | "personal" | "orgs"; label: string }) => (
                <button
                  key={t.id}
                  onClick={() => setFilterType(t.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    filterType === t.id
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="glass-card p-4 text-sm text-muted-foreground text-center">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
              className="inline-block w-4 h-4 border-2 border-primary border-t-transparent rounded-full mr-2"
            />
            Carregando repositórios...
          </div>
        ) : (
          <div className="space-y-8 min-h-[400px]">
            {Object.keys(grouped).length === 0 ? (
              <div className="glass-card p-12 text-center text-muted-foreground border-dashed">
                Nenhum repositório encontrado com esses filtros.
              </div>
            ) : (
              Object.entries(grouped).map(([name, groupRepos]) => {
                if (groupRepos.length === 0) return null;
                const isPersonal = name === "Pessoal";
                const allSelected = groupRepos.every((r) => r.selected);
                const someSelected = groupRepos.some((r) => r.selected);

                return (
                  <RepoGroup
                    key={name}
                    icon={isPersonal ? <User className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
                    label={name}
                    repos={groupRepos}
                    onToggle={toggleRepo}
                    onToggleGroup={() => toggleGroup(name, !allSelected)}
                    allSelected={allSelected}
                    someSelected={someSelected}
                    isOpen={openGroups[name] ?? true}
                    onOpenChange={(open) =>
                      setOpenGroups((current) => ({
                        ...current,
                        [name]: open,
                      }))
                    }
                  />
                );
              })
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-border sticky bottom-0 bg-background/80 backdrop-blur-md pb-4">
          <span className="text-sm text-muted-foreground font-mono">
            {selectedCount} selecionado{selectedCount !== 1 ? "s" : ""}
          </span>
          <Button onClick={handleContinue} disabled={selectedCount === 0} className="gap-2 px-8">
            Continuar
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </AppShell>
  );
}

function RepoGroup({
  icon,
  label,
  repos,
  onToggle,
  onToggleGroup,
  allSelected,
  someSelected,
  isOpen,
  onOpenChange,
}: {
  icon: ReactNode;
  label: string;
  repos: Repository[];
  onToggle: (id: string) => void;
  onToggleGroup: () => void;
  allSelected: boolean;
  someSelected: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Collapsible open={isOpen} onOpenChange={onOpenChange} className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="h-8 px-2 gap-2 text-sm text-muted-foreground font-medium hover:text-foreground">
            {icon}
            <span>{label}</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : "rotate-0"}`} />
          </Button>
        </CollapsibleTrigger>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleGroup}
          className={`h-7 px-2 text-xs transition-colors ${
            allSelected ? "text-primary" : someSelected ? "text-primary/70" : "text-muted-foreground"
          }`}
        >
          {allSelected ? "Desmarcar todos" : "Marcar todos"}
        </Button>
      </div>
      <CollapsibleContent className="space-y-2 data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden">
        {repos.map((repo, index) => (
          <motion.button
            key={repo.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            onClick={() => onToggle(repo.id)}
            className={`flex items-center justify-between px-4 py-3 rounded-lg border transition-all text-left group w-full ${
              repo.selected
                ? "border-primary/50 bg-primary/5"
                : "border-border bg-secondary/50 hover:border-muted-foreground/30"
            }`}
          >
            <span className="font-mono text-sm truncate mr-4">{repo.fullName}</span>
            <div
              className={`w-5 h-5 rounded border flex items-center justify-center transition-all shrink-0 ${
                repo.selected
                  ? "bg-primary border-primary shadow-[0_0_10px_rgba(34,197,94,0.3)]"
                  : "border-muted-foreground/30 group-hover:border-muted-foreground/50"
              }`}
            >
              {repo.selected && <Check className="w-3 h-3 text-primary-foreground stroke-[3]" />}
            </div>
          </motion.button>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
