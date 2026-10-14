#!/usr/bin/env bash
#
# Point the AdNauseam-lite repository at the latest pushed AdNauseam commit.
#
# Usage: tools/update-lite.sh [path/to/AdNauseam-lite]
#   (defaults to ../AdNauseam-lite, next to this repository)
#
# The top of AdNauseam-lite/CHANGELOG.md, down to the first `----------`,
# becomes the release notes. Unless CHANGELOG.md was already edited, the
# script drafts that section from the new commits whose message starts with
# "mv3:", shows it, and asks before committing and pushing.

set -e

ADN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LITE_DIR="${1:-$ADN_DIR/../AdNauseam-lite}"

if [ ! -d "$LITE_DIR/AdNauseam" ]; then
    echo "*** No AdNauseam-lite checkout at $LITE_DIR" >&2
    exit 1
fi
cd "$LITE_DIR"

echo "*** Update AdNauseam-lite in $(pwd)"

# Only CHANGELOG.md may carry local edits: anything else would be left out
# of the commit, or stop the pull.
if [[ $(git status --porcelain --ignore-submodules=all -- . ':!CHANGELOG.md') ]]; then
    echo "*** AdNauseam-lite has uncommitted changes besides CHANGELOG.md:" >&2
    git status --short -- . ':!CHANGELOG.md' >&2
    exit 1
fi

git pull --ff-only
git submodule update --init --remote AdNauseam

COMMIT=$(git -C AdNauseam rev-parse --short HEAD)

if [[ $(git rev-parse HEAD:AdNauseam) == $(git -C AdNauseam rev-parse HEAD) ]]; then
    echo "*** AdNauseam-lite already points at $COMMIT"
    exit 0
fi

# The submodule follows GitHub, not this checkout: unpushed work is not in it.
if [[ $(git -C "$ADN_DIR" rev-parse HEAD) != $(git -C AdNauseam rev-parse HEAD) ]]; then
    echo "*** Note: local AdNauseam HEAD is $(git -C "$ADN_DIR" rev-parse --short HEAD), the submodule gets $COMMIT (pushed)"
fi

# Commits since the last update; those whose message starts with "mv3:"
# make the release notes.
OLD=$(git rev-parse HEAD:AdNauseam)
MV3_LOG=$(git -C AdNauseam log --no-merges --format='%h %s' "$OLD..HEAD" | grep -iE '^[0-9a-f]+ mv3:' || true)

echo "*** All AdNauseam commits since $(git rev-parse --short HEAD:AdNauseam):"
git -C AdNauseam log --no-merges --format='    %h %s' "$OLD..HEAD"
echo "*** Of those, marked mv3:"
echo "${MV3_LOG:-(none)}" | sed 's/^/    /'

# Draft the release notes from the mv3: commits, unless CHANGELOG.md was
# already edited by hand.
if [[ -z $(git status --porcelain -- CHANGELOG.md) ]]; then
    NOTES=$(echo "$MV3_LOG" \
        | cut -d' ' -f2- \
        | sed -E 's/^[mM][vV]3: *//' \
        | awk 'NF { print "- " toupper(substr($0, 1, 1)) substr($0, 2) }')
    if [[ -z $NOTES ]]; then
        NOTES="- Update AdNauseam to $COMMIT"
    fi
    { echo "$NOTES"; echo; echo "----------"; echo; cat CHANGELOG.md; } > CHANGELOG.md.new
    mv CHANGELOG.md.new CHANGELOG.md
fi

echo "*** Release notes (top of CHANGELOG.md):"
sed '/^----------/q' CHANGELOG.md | sed 's/^/    /'

read -r -p "*** Commit and push? [y/N] " ANSWER
if [[ $ANSWER != [yY] ]]; then
    echo "*** Left uncommitted in $(pwd): edit CHANGELOG.md and run again to keep it,"
    echo "*** or undo with: git checkout CHANGELOG.md && git submodule update AdNauseam"
    exit 0
fi

git add AdNauseam CHANGELOG.md
git commit -m "point at $COMMIT"
git push

echo "*** AdNauseam-lite now points at $COMMIT"
echo "*** To release: gh workflow run create_release.yml --repo $(git remote get-url origin | sed -E 's#.*github.com[:/]##; s#\.git$##') --ref $(git branch --show-current)"
