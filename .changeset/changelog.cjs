// Custom changelog generator: same GitHub PR/commit links as
// @changesets/changelog-github, but release lines use the template
// "\n\n- {pull} {commit} - {summary}" (no "Thanks @author!" attribution).
const { getInfo, getInfoFromPullRequest } = require("@changesets/get-github-info");

/** @type {import("@changesets/types").ChangelogFunctions} */
const changelogFunctions = {
  getDependencyReleaseLines: async (changesets, dependenciesUpdated, options) => {
    if (!options.repo) {
      throw new Error(
        'Please provide a repo to this changelog generator like this:\n"changelog": ["./changelog.cjs", { "repo": "org/repo" }]',
      );
    }
    if (dependenciesUpdated.length === 0) return "";

    const commitLinks = (
      await Promise.all(
        changesets.map(async (cs) => {
          if (!cs.commit) return undefined;
          const { links } = await getInfo({ repo: options.repo, commit: cs.commit });
          return links.commit;
        }),
      )
    ).filter((link) => link);

    const changesetLink = `- Updated dependencies [${commitLinks.join(", ")}]:`;
    const updatedDependenciesList = dependenciesUpdated.map(
      (dependency) => `  - ${dependency.name}@${dependency.newVersion}`,
    );
    return [changesetLink, ...updatedDependenciesList].join("\n");
  },
  getReleaseLine: async (changeset, _type, options) => {
    if (!options || !options.repo) {
      throw new Error(
        'Please provide a repo to this changelog generator like this:\n"changelog": ["./changelog.cjs", { "repo": "org/repo" }]',
      );
    }

    // Support the same pr:/commit: (and ignored author:) overrides in the
    // changeset summary that @changesets/changelog-github understands.
    let prFromSummary;
    let commitFromSummary;
    const replacedChangelog = changeset.summary
      .replace(/^\s*(?:pr|pull|pull\s+request):\s*#?(\d+)/im, (_, pr) => {
        prFromSummary = Number(pr);
        return "";
      })
      .replace(/^\s*commit:\s*([^\s]+)/im, (_, commit) => {
        commitFromSummary = commit;
        return "";
      })
      .replace(/^\s*(?:author|user):\s*@?([^\s]+)/gim, "")
      .trim();

    const [firstLine, ...futureLines] = replacedChangelog.split("\n").map((l) => l.trimEnd());

    const links = await (async () => {
      if (prFromSummary !== undefined) {
        let { links } = await getInfoFromPullRequest({ repo: options.repo, pull: prFromSummary });
        if (commitFromSummary) {
          const shortCommitId = commitFromSummary.slice(0, 7);
          links = {
            ...links,
            commit: `[\`${shortCommitId}\`](https://github.com/${options.repo}/commit/${commitFromSummary})`,
          };
        }
        return links;
      }
      const commitToFetchFrom = commitFromSummary || changeset.commit;
      if (commitToFetchFrom) {
        const { links } = await getInfo({ repo: options.repo, commit: commitToFetchFrom });
        return links;
      }
      return { commit: null, pull: null, user: null };
    })();

    const pull = links.pull ? ` ${links.pull}` : "";
    const commit = links.commit ? ` ${links.commit}` : "";
    const linksPart = pull || commit ? `${pull}${commit} -` : "";
    const suffix = futureLines.length > 0 ? `\n${futureLines.map((l) => `  ${l}`).join("\n")}` : "";

    return `\n\n-${linksPart} ${firstLine}${suffix}`;
  },
};

module.exports = changelogFunctions;
