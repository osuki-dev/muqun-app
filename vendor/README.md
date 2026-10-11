# Local first-party diagram package

`skia-diagrams-9bc8003.tgz` is a built snapshot of the owned
`@osuki-dev/skia-diagrams` repository. The App consumes it through a repository-relative
`file:vendor/...` dependency, so a fresh checkout can reproduce the unreleased API
without an absolute workstation path or a dependency patch.

- Source repository: `https://github.com/osuki-dev/skia-diagrams`
- Local source worktree: `/home/ryu/Work/skia-diagrams-worktrees/viewer-icons`
- Branch: `feat/viewer-icon-configuration`, based on local `main` (`d16652e`)
- Commit: `9bc8003` (`feat: configure full-screen viewer action icons`)
- SHA-256: `d568e2c6680807fb084a7dc16deaa6f0961c394bdc0ea709efeddb792885f02e`
- Build: `bun pm pack --filename /tmp/skia-diagrams-viewer-icons-9bc8003.tgz`
  (runs the package's TypeScript prepack build)

The user authorized local commits only, without publishing. This temporary
pre-release artifact exposes the official `renderViewerIcon` configuration hook;
the published npm 0.1.6 does not have that API. The package manifest inside the
archive still reads 0.1.6, so the commit-specific filename and checksum identify
this snapshot, not the registry version number. It includes source, built JavaScript,
declarations, documentation, and the upstream Apache-2.0 license.

Once an approved library release includes commit `9bc8003` or its equivalent,
replace the relative dependency with that published version, regenerate `bun.lock`,
and remove this archive and this note. Do not substitute registry 0.1.6 while the
App uses the new hook. Publishing is a separate, explicitly authorized action.
