# SignPath Foundation application record

This file records the information to use in the SignPath Foundation
application. It is not a secret and may remain in the public repository.

## Project details

- Project name: Tridibox 3MF to U1 Desktop
- Current version: 1.2.1
- Platform: Windows x64
- Artifact type: Electron portable executable
- License: GNU Affero General Public License v3.0 only
- Build system: GitHub Actions on Windows
- Signing policy: [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md)
- Privacy policy: [PRIVACY.md](PRIVACY.md)
- Security policy: [SECURITY.md](SECURITY.md)

## Project description

Tridibox 3MF to U1 Desktop is an open-source offline Windows application for
preparing and converting 3MF projects for the Snapmaker U1. It includes
optimized Snapmaker Orca profiles for the U1 0.4 mm nozzle, four-material
mapping and post-conversion verification. The application processes files
locally, does not collect telemetry and does not upload user files. Windows
artifacts are built automatically from the public source repository using
GitHub Actions.

## Provenance

The conversion engine is derived from `3mf-to-u1` by Eric Reid, itself derived
from `bl2u1` by Josuan Benedicto. The repository preserves attribution and
license notices. Snapmaker profile data is generated from the open-source
Snapmaker Orca repository at the exact revision documented in `NOTICE`.

## Information to complete after repository creation

- Public repository URL
- Public release/download URL
- Repository owner GitHub profile
- SignPath organization and project identifiers assigned during onboarding

