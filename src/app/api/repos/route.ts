import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

interface GitHubOrg {
  login: string;
}

interface GitHubOrgMembership {
  organization?: {
    login?: string;
  };
}

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  default_branch: string;
  owner: {
    login: string;
    type: string;
  };
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

export async function GET(request: NextRequest) {
  const session = await auth();
  const tokenFromHeader = request.headers.get("x-github-token")?.trim();
  const accessToken = tokenFromHeader || session?.accessToken;
  if (!accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
  };

  const userRepos = await fetchPaginated<GitHubRepo>(
    "https://api.github.com/user/repos?sort=pushed&affiliation=owner,collaborator,organization_member",
    headers,
  );

  if (userRepos.length === 0) {
    return NextResponse.json({ error: "Failed to fetch repositories" }, { status: 502 });
  }

  const orgs = await fetchPaginated<GitHubOrg>("https://api.github.com/user/orgs", headers);
  const memberships = await fetchPaginated<GitHubOrgMembership>(
    "https://api.github.com/user/memberships/orgs?state=active",
    headers,
  );

  const orgLogins = new Set<string>();
  for (const org of orgs) {
    if (org.login) {
      orgLogins.add(org.login);
    }
  }
  for (const membership of memberships) {
    const login = membership.organization?.login;
    if (login) {
      orgLogins.add(login);
    }
  }

  const orgRepos = await Promise.all(
    Array.from(orgLogins).map((orgLogin) =>
      fetchPaginated<GitHubRepo>(`https://api.github.com/orgs/${orgLogin}/repos?sort=pushed`, headers),
    ),
  );

  const mergedById = new Map<number, GitHubRepo>();
  for (const repo of userRepos) {
    mergedById.set(repo.id, repo);
  }
  for (const reposOfOrg of orgRepos) {
    for (const repo of reposOfOrg) {
      mergedById.set(repo.id, repo);
    }
  }

  const allRepos = Array.from(mergedById.values()).map((repo) => {
    const isOrgRepo = repo.owner.type === "Organization" || orgLogins.has(repo.owner.login);
    return {
      id: String(repo.id),
      name: repo.name,
      fullName: repo.full_name,
      owner: repo.owner.login,
      isOrg: isOrgRepo,
      selected: false,
      defaultBranch: repo.default_branch,
      selectedBranch: repo.default_branch,
    };
  });

  allRepos.sort((a, b) => {
    if (a.isOrg !== b.isOrg) {
      return a.isOrg ? 1 : -1;
    }
    return a.fullName.localeCompare(b.fullName);
  });

  return NextResponse.json(allRepos);
}
