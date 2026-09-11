# Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io/), certificate
by [SignPath Foundation](https://signpath.org/).

## Project roles

- Authors and committers: the Tridibox project owner and repository
  collaborators with write access.
- Reviewers: the Tridibox project owner and maintainers listed in the public
  repository contributor history. Contributions from people without write
  access require review before merge.
- Approvers: the Tridibox project owner. Every signing request requires manual
  approval in SignPath.

The public commit history, contributor list and repository access settings are
the authoritative record of the people assigned to these roles. If SignPath
Foundation requires named profile links during onboarding, they will be added
after the repository URL and owner identity are assigned.

## Source and build requirements

- Only artifacts built by the release workflow in this repository may be
  submitted for signing.
- Locally compiled or manually modified executables must never be submitted.
- The workflow starts from a tagged commit, installs locked dependencies with
  `npm ci`, runs the automated test suite and builds the Windows artifact.
- Product name and version metadata must agree with `package.json`, the Git tag
  and the release name.
- Source code, build scripts and workflow changes are treated as security-
  sensitive changes and must be reviewed before release.
- A signed file must not be changed after SignPath returns it.

## Release approval

Each release is built automatically from a version tag. The designated
approver checks the source revision, successful tests, artifact metadata and
release notes before manually approving the signing request. The exact signed
artifact returned by SignPath is then attached to the corresponding release.

## Privacy

Tridibox processes models locally. It does not collect telemetry, upload user
files or transfer application data to networked systems. See
[PRIVACY.md](PRIVACY.md).

