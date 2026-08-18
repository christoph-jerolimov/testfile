# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets).
Each markdown file in here (besides this one) is a pending changelog entry: it
names the packages a change affects, the semver bump each one needs, and the
sentence that will appear in their `CHANGELOG.md`.

Add one alongside any pull request that changes a published package:

```sh
npm run changeset
```

The release workflow (`.github/workflows/release.yaml`) collects the pending
entries on `main` into a "Version packages" pull request; merging that PR
publishes the bumped packages to npm and tags the release.

See the [Releases section of the README](../README.md#releases) for the full
release process.
