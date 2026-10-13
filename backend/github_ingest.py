#!/usr/bin/env python3
"""Shapley Phase 1.1: GitHub commit ingestion.

Pulls commits, diffs, and contributor mapping for a repo.
Usage: python github_ingest.py <owner/repo> [--max-commits 50]
"""
import json
import sys
import urllib.request
import urllib.parse
import urllib.error

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response

CREDENTIAL = "custom.github"
HOSTS = ["api.github.com"]

# Skip these patterns (bots, merges)
SKIP_AUTHORS = ["dependabot", "github-actions", "renovate"]
SKIP_MESSAGES = ["merge branch", "merge pull request"]


def api_get(path):
    url = f"https://api.github.com{path}"
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "shapley-hackathon",
    })
    add_surrogate_to_request(req, CREDENTIAL, allowed_hosts=HOSTS)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return read_json_response(resp)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise ValueError(
                f"Repository not found. Check the URL — it should look like "
                f"'owner/repo' or 'https://github.com/owner/repo'. "
                f"Private repos need additional access.")
        elif e.code == 403:
            body = e.read().decode()[:300] if hasattr(e, 'read') else ""
            if "rate limit" in body.lower():
                raise ValueError(
                    "GitHub API rate limit exceeded. Wait a few minutes and try again.")
            raise ValueError(
                "GitHub API access denied. The repo may be private or the "
                "token may lack access.")
        elif e.code == 401:
            raise ValueError("GitHub authentication failed. Check API credentials.")
        raise ValueError(f"GitHub API error ({e.code}). Try again in a moment.")


def parse_repo_url(url):
    """Extract owner/repo from various URL formats."""
    url = url.strip().rstrip("/")
    if url.startswith("https://github.com/"):
        parts = url.replace("https://github.com/", "").split("/")
        return f"{parts[0]}/{parts[1]}"
    elif "/" in url and " " not in url:
        return url  # Assume already owner/repo
    raise ValueError(f"Cannot parse repo URL: {url}")


def is_bot_commit(commit):
    author = (commit.get("author") or {}).get("login", "").lower()
    committer = (commit.get("committer") or {}).get("login", "").lower()
    msg = commit["commit"]["message"].lower()
    if any(b in author or b in committer for b in SKIP_AUTHORS):
        return True
    if any(s in msg for s in SKIP_MESSAGES):
        return True
    return False


def get_commits(repo, max_commits=50):
    """Fetch commits with diffs, grouped by contributor."""
    print(f"Fetching commits for {repo}...", file=sys.stderr)
    commits_data = api_get(f"/repos/{repo}/commits?per_page={min(max_commits, 100)}")

    contributors = {}  # email -> {name, email, commits: []}

    for c in commits_data:
        if is_bot_commit(c):
            continue

        sha = c["sha"]
        author_info = c["commit"]["author"]
        email = author_info.get("email", "unknown")
        name = author_info.get("name", email)

        # Skip noreply emails for cleaner mapping
        if "noreply" in email:
            gh_author = (c.get("author") or {}).get("login", "")
            if gh_author:
                email = f"{gh_author}@users.noreply.github.com"
                name = gh_author

        # Get full commit with diffs
        try:
            detail = api_get(f"/repos/{repo}/commits/{sha}")
        except Exception as e:
            print(f"  Warning: could not fetch {sha[:7]}: {e}", file=sys.stderr)
            continue

        files = []
        for f in detail.get("files", []):
            files.append({
                "filename": f["filename"],
                "additions": f.get("additions", 0),
                "deletions": f.get("deletions", 0),
                "patch": f.get("patch", "")[:4000],  # Truncate long patches
            })

        commit_entry = {
            "sha": sha[:7],
            "message": c["commit"]["message"].split("\n")[0][:120],
            "date": author_info.get("date", ""),
            "additions": sum(f["additions"] for f in files),
            "deletions": sum(f["deletions"] for f in files),
            "files": files,
        }

        key = email.lower()
        if key not in contributors:
            contributors[key] = {"name": name, "email": email, "commits": []}
        contributors[key]["commits"].append(commit_entry)
        print(f"  {sha[:7]} by {name}: {commit_entry['message'][:50]}", file=sys.stderr)

    return contributors


def main():
    if len(sys.argv) < 2:
        print("Usage: python github_ingest.py <owner/repo or URL> [--max-commits N]")
        sys.exit(1)

    repo = parse_repo_url(sys.argv[1])
    max_commits = 50
    if "--max-commits" in sys.argv:
        idx = sys.argv.index("--max-commits")
        max_commits = int(sys.argv[idx + 1])

    contributors = get_commits(repo, max_commits)

    print(f"\n{'='*60}")
    print(f"Contributors: {len(contributors)}")
    for email, data in contributors.items():
        total_add = sum(c["additions"] for c in data["commits"])
        total_del = sum(c["deletions"] for c in data["commits"])
        print(f"  {data['name']} ({email}): "
              f"{len(data['commits'])} commits, +{total_add}/-{total_del}")

    # Save for next stage
    out_path = "/tmp/shapley_contributors.json"
    with open(out_path, "w") as f:
        json.dump(contributors, f, indent=2)
    print(f"\nSaved to {out_path}")


if __name__ == "__main__":
    main()
