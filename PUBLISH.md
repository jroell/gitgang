# Publishing GitGang Updates

## Publish Checklist (Node build)

1) Set npm auth:
```bash
export NPM_TOKEN="your-npm-token-here"
```

2) Run the release script (bumps patch, rebuilds dist/cli.js, publishes, pushes):
```bash
./release.sh
```

3) Verify:
```bash
npm info gitgang version
npm install -g gitgang@latest
gg --version
```

## Notes
- The CLI is now bundled with esbuild for Node; no Bun binary is shipped.
- `publish-npm-macos.sh` is legacy (Bun-based) and should be avoided; use `release.sh` instead.
