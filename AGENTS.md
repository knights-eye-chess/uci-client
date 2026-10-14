# Repository guidance

This repository owns `@knights-eye-chess/uci-client`. Read [README.md](README.md)
and [SOURCE-ORIGIN.json](SOURCE-ORIGIN.json) before changing code. The origin record
names the historical extraction inputs; new work belongs to this repository.

Use Node 24.19.0 and npm 11.9.0, `npm ci`, `npm run check`, and `npm run
publish:prepare` for a reviewed release candidate. The source manifest keeps
`private: true`; only the staged candidate may be published after review. Never overwrite
an archive at an existing version with different bytes. Use a new version for a
changed candidate. The package does not bundle a chess engine or model weights.

The manual quality and publication workflows do not run on push. Publication
requires the reviewed exact version and archive SHA-256, a public repository,
and the protected npm token. Do not publish, deploy, or add an automatic release
trigger while preparing this source tree.
