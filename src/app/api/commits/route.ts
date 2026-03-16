import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

interface CommitRequestRepo {
  fullName: string;
  branch?: string;
}

interface CommitRequest {
  repos: Array<string | CommitRequestRepo>;
  startDate: string;
  endDate: string;
  username?: string;
}

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      date: string;
    };
  };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const tokenFromHeader = req.headers.get("x-github-token")?.trim();
  const accessToken = tokenFromHeader || session?.accessToken;
  if (!accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { repos, startDate, endDate, username } = (await req.json()) as CommitRequest;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
  };

  let author = username ?? session.login;
  if (!author) {
    const userRes = await fetch("https://api.github.com/user", { headers, cache: "no-store" });
    if (userRes.ok) {
      const user = (await userRes.json()) as { login?: string };
      author = user.login;
    }
  }

  if (!author) {
    return NextResponse.json({ error: "Could not resolve GitHub username" }, { status: 400 });
  }

  const allCommits = await Promise.all(
    repos.map(async (repoInput) => {
      const repo = typeof repoInput === "string" ? { fullName: repoInput, branch: "" } : repoInput;
      const branchParam = repo.branch ? `&sha=${encodeURIComponent(repo.branch)}` : "";
      const url = `https://api.github.com/repos/${repo.fullName}/commits?author=${encodeURIComponent(author)}&since=${startDate}T00:00:00Z&until=${endDate}T23:59:59Z&per_page=100${branchParam}`;
      const res = await fetch(url, {
        headers,
        cache: "no-store",
      });

      if (!res.ok) {
        return [];
      }

      const commits = (await res.json()) as GitHubCommit[];
      return commits.map((commit) => ({
        sha: commit.sha,
        message: commit.commit.message.split("\n")[0],
        repo: repo.fullName,
        date: commit.commit.author.date,
        branch: repo.branch || undefined,
      }));
    }),
  );

  return NextResponse.json(allCommits.flat());
}
