import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

interface BranchRequestRepo {
  fullName: string;
  defaultBranch?: string;
}

interface BranchRequest {
  repos: Array<string | BranchRequestRepo>;
}

interface GitHubBranch {
  name: string;
}

const MAX_PAGES = 5;

async function fetchPaginated<T>(url: string, headers: Record<string, string>): Promise<T[]> {
  const results: T[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const joinChar = url.includes("?") ? "&" : "?";
    const pageUrl = `${url}${joinChar}per_page=100&page=${page}`;
    const response = await fetch(pageUrl, { headers, cache: "no-store" });

    if (!response.ok) {
      break;
    }

    const data = (await response.json()) as T[];
    if (data.length === 0) {
      break;
    }

    results.push(...data);

    if (data.length < 100) {
      break;
    }
  }

  return results;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const tokenFromHeader = req.headers.get("x-github-token")?.trim();
  const accessToken = tokenFromHeader || session?.accessToken;
  if (!accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { repos } = (await req.json()) as BranchRequest;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
  };

  const branchData = await Promise.all(
    repos.map(async (repoInput) => {
      const repo = typeof repoInput === "string" ? { fullName: repoInput, defaultBranch: "" } : repoInput;
      const branches = await fetchPaginated<GitHubBranch>(`https://api.github.com/repos/${repo.fullName}/branches`, headers);
      const branchNames = branches.map((branch) => branch.name);

      if (repo.defaultBranch && branchNames.includes(repo.defaultBranch)) {
        branchNames.sort((a, b) => {
          if (a === repo.defaultBranch) return -1;
          if (b === repo.defaultBranch) return 1;
          return a.localeCompare(b);
        });
      } else {
        branchNames.sort((a, b) => a.localeCompare(b));
      }

      return {
        fullName: repo.fullName,
        branches: branchNames,
      };
    }),
  );

  return NextResponse.json(branchData);
}
