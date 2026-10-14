# Publishing @knights-eye-chess/uci-client

The source manifest has `private: true` and a `0.1.0-dev.0` preview version. Repository
visibility must be verified separately; no registry publication is claimed here.
Choose a fresh version after
independent source and license review; never replace an immutable candidate at
the same version. The package is released with the `next` dist-tag, preserving
`latest`.

The release coordinator first checks that this repository's generated release
files match `knightseye-net/tools/release-tooling` and that the app's canonical
registry includes `uci-client`. Then use Node 24.19.0 and npm 11.9.0:

```sh
npm ci --ignore-scripts --registry https://registry.npmjs.org/
npm run publish:prepare
```

Review the exact staged archive in `artifacts/`, its SHA-256, exports, MIT
notices, source origin, and absence of engine binaries and private inputs. The
source manifest remains `private: true`; the pack helper stages a consumer
manifest with public npm settings. The generated manual quality workflow runs
the same local checks. The separate manual publication workflow accepts an exact
version and archive SHA-256 on `dev`, requires a public repository and token,
rebuilds the candidate, and publishes only matching bytes with npm provenance.
It does not trigger on push or pull request. No publication is part of this
scaffold.
