"use client";

import { ReactNode, useEffect, useState } from "react";
import { Bell, Clock, Github, LogOut, Menu, RefreshCw, RotateCcw, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AppShellProps {
  children: ReactNode;
  title?: string;
  step?: number;
}

const steps = [
  { label: "Repositórios", path: "/repos" },
  { label: "Config", path: "/config" },
  { label: "Sheet", path: "/sheet" },
];

const REMINDER_SETTINGS_KEY = "gitsheet-reminder-settings";

interface ReminderSettings {
  dayEntryReminderEnabled: boolean;
}

const AppShell = ({ children, step }: AppShellProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [telegramReminderEnabled, setTelegramReminderEnabled] = useState(false);
  const [telegramConfigured, setTelegramConfigured] = useState(false);
  const [reconfigureMode, setReconfigureMode] = useState(false);
  const isSheetPage = pathname === "/sheet";

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(REMINDER_SETTINGS_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as ReminderSettings;
      setReminderEnabled(Boolean(parsed.dayEntryReminderEnabled));
    } catch {}
  }, []);

  useEffect(() => {
    setReconfigureMode(typeof window !== "undefined" && new URLSearchParams(window.location.search).get("reconfigure") === "1");
  }, []);

  useEffect(() => {
    let ignore = false;

    const loadReminderConfig = async () => {
      try {
        const response = await fetch("/api/config");
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as {
          config?: { telegramReminderEnabled?: boolean } | null;
          telegramConfigured?: boolean;
        };

        if (ignore) {
          return;
        }

        setTelegramReminderEnabled(Boolean(payload.config?.telegramReminderEnabled));
        setTelegramConfigured(Boolean(payload.telegramConfigured));
      } catch {}
    };

    void loadReminderConfig();

    return () => {
      ignore = true;
    };
  }, []);

  const persistReminderEnabled = (enabled: boolean) => {
    setReminderEnabled(enabled);
    window.localStorage.setItem(
      REMINDER_SETTINGS_KEY,
      JSON.stringify({ dayEntryReminderEnabled: enabled } satisfies ReminderSettings),
    );
  };

  const handleToggleReminder = async (checked: boolean) => {
    if (checked && typeof Notification !== "undefined") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error("Permita notificações no navegador para ativar o lembrete.");
        persistReminderEnabled(false);
        return;
      }
    }

    persistReminderEnabled(checked);
    toast.success(checked ? "Lembrete do dia ativado." : "Lembrete do dia desativado.");
  };

  const handleToggleTelegramReminder = async (checked: boolean) => {
    if (checked && !telegramConfigured) {
      toast.error("Telegram não configurado. Defina TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no .env.local.");
      return;
    }

    const response = await fetch("/api/reminders/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: checked }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({ error: "Não foi possível atualizar o lembrete." }))) as {
        error?: string;
      };
      toast.error(payload.error ?? "Não foi possível atualizar o lembrete do Telegram.");
      return;
    }

    setTelegramReminderEnabled(checked);
    toast.success(checked ? "Lembrete via Telegram ativado." : "Lembrete via Telegram desativado.");
  };

  const handleSyncNow = async () => {
    const response = await fetch("/api/sync/daily", { method: "POST" });
    if (!response.ok) {
      toast.error("Não foi possível executar o sync agora.");
      return;
    }

    const payload = (await response.json().catch(() => ({ processed: 0, synced: 0 }))) as {
      processed?: number;
      synced?: number;
    };

    toast.success(
      payload.processed && payload.processed > 1
        ? `Sync executado. ${payload.synced ?? 0} dia(s) sincronizado(s) em ${payload.processed} processado(s).`
        : "Sync executado.",
    );
    router.refresh();
    if (!isSheetPage) {
      router.push("/sheet");
      return;
    }

    window.location.reload();
  };

  const handleResetWorkspace = async () => {
    const confirmed = window.confirm("Isso apaga config, sheets, logs e estado salvo deste usuário. Continuar?");
    if (!confirmed) {
      return;
    }

    const response = await fetch("/api/reset", { method: "POST" });
    if (!response.ok) {
      toast.error("Não foi possível resetar o workspace.");
      return;
    }

    window.localStorage.removeItem("timesheet-store");
    window.localStorage.removeItem(REMINDER_SETTINGS_KEY);
    toast.success("Workspace resetado.");
    router.push("/repos");
    window.location.reload();
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-border bg-card/50 px-6 py-3 backdrop-blur-sm">
        <Link href="/" className="flex cursor-pointer items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
            <Clock className="h-4 w-4 text-primary" />
          </div>
          <span className="text-lg font-bold text-gradient">GitSheet</span>
        </Link>

        {step !== undefined && (
          <div className="hidden items-center gap-1 sm:flex">
            {steps.map((item, index) => (
              <div key={item.path} className="flex items-center gap-1">
                <button
                  onClick={() => router.push(reconfigureMode && item.path !== "/sheet" ? `${item.path}?reconfigure=1` : item.path)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                    index + 1 === step
                      ? "border border-primary/20 bg-primary/10 text-primary"
                      : pathname === item.path
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {item.label}
                </button>
                {index < steps.length - 1 && <span className="mx-1 text-border">›</span>}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Github className="h-4 w-4" />
            <span className="hidden font-mono text-xs sm:inline">{session?.login ?? "github"}</span>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground">
                <Menu className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Workspace</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => router.push("/config?reconfigure=1")}>
                <Settings2 className="mr-2 h-4 w-4" />
                Reconfigurar repositórios
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push("/config?reconfigure=1")}>
                <Settings2 className="mr-2 h-4 w-4" />
                Revisar período e branches
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleSyncNow()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Executar sync agora
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={reminderEnabled}
                onCheckedChange={(checked) => void handleToggleReminder(Boolean(checked))}
              >
                <Bell className="mr-2 h-4 w-4" />
                Lembrete no navegador
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={telegramReminderEnabled}
                onCheckedChange={(checked) => void handleToggleTelegramReminder(Boolean(checked))}
              >
                <Bell className="mr-2 h-4 w-4" />
                Lembrete via Telegram
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void handleResetWorkspace()} className="text-destructive focus:text-destructive">
                <RotateCcw className="mr-2 h-4 w-4" />
                Resetar tudo
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-muted-foreground"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="flex-1 px-4 py-8 sm:px-6 xl:px-8 2xl:px-10">{children}</main>
    </div>
  );
};

export default AppShell;
