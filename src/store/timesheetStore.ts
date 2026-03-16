import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DayDraft, Repository } from "@/types/timesheet";

interface TimesheetStore {
  selectedRepos: Repository[];
  startDate: string;
  endDate: string;
  includeSaturday: boolean;
  includeSunday: boolean;
  firstBlockStart: string;
  firstBlockEnd: string;
  secondBlockStart: string;
  secondBlockEnd: string;
  dayDrafts: DayDraft[];
  githubPat: string;
  setSelectedRepos: (repos: Repository[]) => void;
  setDateRange: (start: string, end: string, includeSaturday?: boolean, includeSunday?: boolean) => void;
  setDayDrafts: (drafts: DayDraft[]) => void;
  updateDayDraft: (id: string, draft: Partial<DayDraft>) => void;
  approveDayDraft: (id: string) => void;
  approveAllDayDrafts: () => void;
  setGithubPat: (pat: string) => void;
  setIncludeSaturday: (include: boolean) => void;
  setIncludeSunday: (include: boolean) => void;
  setScheduleDefaults: (schedule: {
    firstBlockStart: string;
    firstBlockEnd: string;
    secondBlockStart: string;
    secondBlockEnd: string;
  }) => void;
}

export const useTimesheetStore = create<TimesheetStore>()(
  persist(
    (set) => ({
      selectedRepos: [],
      startDate: "",
      endDate: "",
      includeSaturday: false,
      includeSunday: false,
      firstBlockStart: "09:00",
      firstBlockEnd: "13:00",
      secondBlockStart: "14:00",
      secondBlockEnd: "18:00",
      dayDrafts: [],
      githubPat: "",
      setSelectedRepos: (repos) => set({ selectedRepos: repos }),
      setDateRange: (start, end, includeSaturday, includeSunday) =>
        set((state) => ({
          startDate: start,
          endDate: end,
          includeSaturday: includeSaturday ?? state.includeSaturday,
          includeSunday: includeSunday ?? state.includeSunday,
        })),
      setDayDrafts: (drafts) => set({ dayDrafts: drafts }),
      updateDayDraft: (id, update) =>
        set((state) => ({
          dayDrafts: state.dayDrafts.map((draft) => (draft.id === id ? { ...draft, ...update } : draft)),
        })),
      approveDayDraft: (id) =>
        set((state) => ({
          dayDrafts: state.dayDrafts.map((draft) => (draft.id === id ? { ...draft, status: "approved" } : draft)),
        })),
      approveAllDayDrafts: () =>
        set((state) => ({
          dayDrafts: state.dayDrafts.map((draft) => ({ ...draft, status: "approved" })),
        })),
      setGithubPat: (pat) => set({ githubPat: pat.trim() }),
      setIncludeSaturday: (include) => set({ includeSaturday: include }),
      setIncludeSunday: (include) => set({ includeSunday: include }),
      setScheduleDefaults: (schedule) => set(schedule),
    }),
    {
      name: "timesheet-store",
      version: 2,
      migrate: (persistedState) => {
        const state = (persistedState as Partial<TimesheetStore>) ?? {};
        return {
          selectedRepos: [],
          startDate: "",
          endDate: "",
          includeSaturday: state.includeSaturday ?? false,
          includeSunday: state.includeSunday ?? false,
          firstBlockStart: state.firstBlockStart ?? "09:00",
          firstBlockEnd: state.firstBlockEnd ?? "13:00",
          secondBlockStart: state.secondBlockStart ?? "14:00",
          secondBlockEnd: state.secondBlockEnd ?? "18:00",
          dayDrafts: [],
          githubPat: state.githubPat ?? "",
        };
      },
    },
  ),
);
