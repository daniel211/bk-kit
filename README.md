# bk-kit — Beer Kit release channel

**Generated repository. Do not edit by hand.**

Every commit here is produced by the `/bk-releasekit <version>` skill in the
[beer-kit](https://github.com/daniel211/beer-kit) source repo. One commit + one tag per
released kit version. Editing this repo directly will be overwritten by the next release.

## Layout

```
dist/ios/          kit/, kit-manifest.json, META.json, package.json, bin/, commands/, lib/, cli/, templates/
dist/android/      same shape
dist/flutter/      same shape
```

Each `dist/<platform>/` is a complete, standalone npm package. `kit/` is the pre-merged
Claude Code kit (agents, skills, hooks, rules) that `bk-<platform> init` copies into a
project's `.claude/` directory.

## Installing a released version

Each tag also carries the three packed tarballs as GitHub Release assets — that is the
install path, and it works without an npm registry:

```bash
gh release download v0.1.0 --repo daniel211/bk-kit --pattern 'beer-kit-ios-*.tgz'
npm install -g ./beer-kit-ios-0.1.0.tgz

cd ~/MyApp
bk-ios init
bk-ios doctor
```

Swap `ios` for `android` or `flutter` as needed. `gh` handles authentication for this
private repo; a plain `npm install -g <url>` will not.

To inspect a version instead of installing it:

```bash
git clone --depth 1 --branch v0.1.0 https://github.com/daniel211/bk-kit
```

## Verifying an install

`dist/<platform>/kit-manifest.json` lists every shipped file with its SHA-256 hash, and
`META.json` records the kit version, the source commit it was built from, and the build
timestamp. `bk-<platform> doctor` checks an installed `.claude/` against that manifest.

## Related

| Repo | Role |
|---|---|
| [beer-kit](https://github.com/daniel211/beer-kit) | Source kit — agents, skills, hooks, rules, build pipeline |
| **bk-kit** (this repo) | Release channel — built output, one tag per version |
