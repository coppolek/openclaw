#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/sync-upstream-main.sh [--target-branch <name>] [--source-ref <ref>] [--no-codex-handoff] [--codex-handoff-path <path>] [--no-push] [--dry-run] [--allow-dirty]

Defaults:
  --target-branch     main
  --source-ref        upstream/main
  --no-codex-handoff  do not write a Codex conflict handoff file
  --codex-handoff-path path for generated Codex conflict handoff file
  --no-push           do not push target branch after successful merge
  --dry-run           print computed values and exit
  --allow-dirty       skip clean-tree check
USAGE
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

TARGET_BRANCH="main"
SOURCE_REF="upstream/main"
PUSH=1
DRY_RUN=0
ALLOW_DIRTY=0
WRITE_CODEX_HANDOFF=1
CODEX_HANDOFF_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-branch)
      TARGET_BRANCH="${2:-}"
      shift 2
      ;;
    --source-ref)
      SOURCE_REF="${2:-}"
      shift 2
      ;;
    --no-codex-handoff)
      WRITE_CODEX_HANDOFF=0
      shift
      ;;
    --codex-handoff-path)
      CODEX_HANDOFF_PATH="${2:-}"
      shift 2
      ;;
    --no-push)
      PUSH=0
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --allow-dirty)
      ALLOW_DIRTY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

write_codex_handoff() {
  if [[ "${WRITE_CODEX_HANDOFF}" -ne 1 ]]; then
    return 0
  fi

  local handoff_path="${CODEX_HANDOFF_PATH}"
  if [[ -z "${handoff_path}" ]]; then
    handoff_path="${REPO_ROOT}/tmp/codex-handoff-main-${TARGET_BRANCH}.md"
  fi
  mkdir -p "$(dirname "${handoff_path}")"

  local unresolved
  unresolved="$(git diff --name-only --diff-filter=U || true)"
  if [[ -z "${unresolved}" ]]; then
    unresolved="(none detected by git diff --diff-filter=U)"
  fi

  {
    echo "# Codex Handoff: Resolve upstream main sync conflicts"
    echo
    echo "Context"
    echo "- Repo: ${REPO_ROOT}"
    echo "- Target branch: ${TARGET_BRANCH}"
    echo "- Source ref: ${SOURCE_REF}"
    echo
    echo "Unresolved conflict files"
    while IFS= read -r file; do
      [[ -n "${file}" ]] && echo "- ${file}"
    done <<< "${unresolved}"
    echo
    echo "Required outcomes"
    echo "- Merge ${SOURCE_REF} into ${TARGET_BRANCH} while preserving fork-specific behavior."
    echo "- Keep release tooling scripts functional:"
    echo "  - scripts/sync-upstream-release.sh"
    echo "  - scripts/verify-vida-release.sh"
    echo "  - scripts/sync-upstream-main.sh"
    echo
    echo "Suggested workflow"
    echo "1. Resolve conflict markers."
    echo "2. Run bash syntax checks for scripts:"
    echo "   bash -n scripts/sync-upstream-main.sh"
    echo "   bash -n scripts/sync-upstream-release.sh"
    echo "   bash -n scripts/verify-vida-release.sh"
    echo "3. Commit and push:"
    echo "   git add <resolved files>"
    echo "   git commit"
    echo "   git push origin ${TARGET_BRANCH}"
  } > "${handoff_path}"

  echo "Wrote Codex handoff: ${handoff_path}" >&2
}

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: run this script inside a git repository." >&2
  exit 1
fi

if [[ "${ALLOW_DIRTY}" -ne 1 ]] && [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean. Commit or stash changes first." >&2
  exit 1
fi

echo "Fetching remotes..."
git fetch --prune upstream
git fetch --prune origin

if ! git rev-parse -q --verify "${SOURCE_REF}" >/dev/null; then
  echo "Error: source ref '${SOURCE_REF}' not found." >&2
  exit 1
fi

echo "Target branch: ${TARGET_BRANCH}"
echo "Source ref:    ${SOURCE_REF}"

if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo "Dry run complete."
  exit 0
fi

if git show-ref --verify --quiet "refs/heads/${TARGET_BRANCH}"; then
  git checkout "${TARGET_BRANCH}"
elif git rev-parse -q --verify "origin/${TARGET_BRANCH}" >/dev/null; then
  git checkout -b "${TARGET_BRANCH}" "origin/${TARGET_BRANCH}"
else
  echo "Error: target branch '${TARGET_BRANCH}' not found locally or on origin." >&2
  exit 1
fi

echo "Rebasing ${TARGET_BRANCH} onto origin/${TARGET_BRANCH}..."
git pull --rebase origin "${TARGET_BRANCH}"

echo "Merging ${SOURCE_REF} into ${TARGET_BRANCH}..."
set +e
git merge --no-ff --no-edit "${SOURCE_REF}"
MERGE_EXIT=$?
set -e

if [[ "${MERGE_EXIT}" -ne 0 ]]; then
  echo
  echo "Merge reported conflicts or errors on branch '${TARGET_BRANCH}'." >&2
  write_codex_handoff
  echo "Resolve conflicts, commit, then push manually:" >&2
  echo "  git push origin ${TARGET_BRANCH}" >&2
  exit "${MERGE_EXIT}"
fi

if [[ "${PUSH}" -eq 1 ]]; then
  echo "Pushing ${TARGET_BRANCH} to origin..."
  git push origin "${TARGET_BRANCH}"
fi

echo "Done. ${SOURCE_REF} merged into ${TARGET_BRANCH}."
