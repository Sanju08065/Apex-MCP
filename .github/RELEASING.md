# Releasing

This guide explains how to create a GitHub release for `Apex MCP`.

1. Update `CHANGELOG.md` — move changes from `Unreleased` to a new version heading.
2. Update `package.json` version field (e.g. `1.0.1`).
3. Commit the changes:

   git add CHANGELOG.md package.json
   git commit -m "chore(release): prepare vX.Y.Z"

4. Create a signed tag and push it:

   git tag vX.Y.Z
   git push origin vX.Y.Z

When the tag is pushed the GitHub Actions workflow `Build and Publish VSIX Release` will run, build the `.vsix` and create a Release with the artifact attached.

Notes:
- The workflow uses the `package` npm script (`vsce package`) to produce the `.vsix` file. Ensure `npm run package` succeeds locally before tagging.
- To publish directly to the Marketplace you can add a step that uses `vsce publish` and provide a `VSCE_TOKEN` secret.
