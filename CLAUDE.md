# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build and Development

- `bun run build` - Compile TypeScript to dist/ and make executables
- `bun run dev` - Start TypeScript compiler in watch mode for development
- `bun run start` - Run the compiled server from dist/index.js
- `bun run test` - Run all tests using Vitest

### Testing and Quality

- `bun run test` - Execute the complete test suite with custom sequencer (kubectl tests run last)
- Tests have 120s timeout and 60s hook timeout due to Kubernetes operations
- Use `npx @modelcontextprotocol/inspector node dist/index.js` for local testing with Inspector
- Always run single test based on with area you are working on. running all tests will take a long time.

### Local Development Testing

- `bun run chat` - Test locally with mcp-chat CLI client
- For Claude Desktop testing, point to local `dist/index.js` build

## Architecture Overview

This is an MCP (Model Context Protocol) server that provides Kubernetes cluster management capabilities. The server connects to Kubernetes clusters via kubectl and offers both read-only and destructive operations.

### Core Components

**KubernetesManager** (`src/utils/kubernetes-manager.ts`): Central class managing Kubernetes API connections, resource tracking, port forwards, and watches. Handles kubeconfig loading from multiple sources in priority order.

**Tool Structure**: Each Kubernetes operation is implemented as a separate tool in `src/tools/`, with corresponding Zod schemas for validation. Tools are divided into:

- kubectl operations (get, describe, apply, delete, create, etc.)
- Helm operations (install, upgrade, uninstall charts)
- Specialized operations (port forwarding, scaling, rollouts)

**Resource Handlers** (`src/resources/handlers.ts`): Manage MCP resource endpoints for dynamic data retrieval.

**Configuration System** (`src/config/`): Contains schemas and templates for deployments, namespaces, containers, and cleanup operations.

### Key Architecture Patterns

- **Tool Filtering**: Non-destructive mode dynamically removes destructive tools based on `ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS` environment variable
- **Unified kubectl API**: Consistent interface across all kubectl operations with standardized error handling
- **Resource Tracking**: All created resources are tracked for cleanup capabilities
- **Transport Flexibility**: Supports both StdioTransport and SSE transport for different integration scenarios

### Request Flow

1. Client sends MCP request via transport layer
2. Server filters available tools based on destructive/non-destructive mode
3. Request routed to appropriate handler (tools/resources)
4. KubernetesManager executes Kubernetes API calls
5. Responses formatted and returned through transport

## Development Guidelines

### Adding New Tools

- Create new tool file in `src/tools/` with Zod schema export
- Import and register in `src/index.ts` main server setup
- Add to destructive/non-destructive filtering logic as appropriate
- Include comprehensive error handling for Kubernetes API failures

### Testing Strategy

- Unit tests focus on tool functionality and schema validation
- Integration tests verify actual Kubernetes operations
- Custom test sequencer ensures kubectl tests run last (they modify cluster state)
- Tests require active Kubernetes cluster connection

### Configuration Handling

- Server loads kubeconfig from multiple sources: KUBECONFIG_YAML env var, KUBECONFIG path, or ~/.kube/config
- Supports multiple kubectl contexts with context switching capabilities
- Environment variables control server behavior (non-destructive mode, custom kubeconfig paths)

## Kubernetes Integration Details

The server requires:

- kubectl installed and accessible in PATH
- Valid kubeconfig with configured contexts
- Active Kubernetes cluster connection
- Helm v3 for chart operations (optional)

**Non-destructive mode** disables: kubectl_delete, uninstall_helm_chart, cleanup operations, and kubectl_generic (which could contain destructive commands).

## Release Process

Releases are fully automated by the CD workflow (`.github/workflows/cd.yml`), which triggers on any pushed tag matching `v*`. **The only manual step is creating the tag and a matching GitHub release** — the agent that merges a release-worthy PR should do this directly once the PR is merged.

**Do NOT bump the version numbers yourself.** CD owns the version bump: on tag push it runs `npm run version:update`, updates the version in every version-bearing file (`package.json`, `src/config/server-config.ts`, `manifest.json`, `CITATION.cff`, `README.md`, `gemini-extension.json`, and the Helm chart), commits `Bump version to <x.y.z>` to `main`, then builds and publishes to npm, GHCR/Helm, and Docker Hub, and uploads the release assets. Editing those files by hand collides with that step and breaks the release. Leave the source at the previous version.

To cut a release, after the PR is merged to `main`:

- Create the tag and GitHub release targeting the current tip of `main` (the merge commit):
  - Tag name: `v<x.y.z>` where `<x.y.z>` is the next patch version (e.g. `v4.0.2` after `v4.0.1`). This must match the version CD will compute, or the release-asset upload will fail.
  - Release title: `Release v<x.y.z>` (e.g. `Release v4.0.2`)
  - Release notes: one or two terse lines describing the change, referencing the PR number (e.g. `(#332)`), matching the style of prior releases.

  Example: `gh release create v4.0.2 --target main --title "Release v4.0.2" --notes "..."` (this creates the `v4.0.2` tag, which triggers CD).

That single tag/release is all that's needed — CD handles the version bump, publish, and asset uploads from there.

## Security Fixes and Coordinated Disclosure

When a change fixes a security issue tracked by a GHSA advisory or CVE, keep the disclosure in the maintainer's hands. Do **not** put any of the following into public channels — the PR title, PR description, PR comments, commit messages, or release notes:

- the GHSA or CVE identifier
- the vulnerability details, attack vector, impact, or affected-secret list
- a proof-of-concept or reproduction steps

Instead, describe the change neutrally as a hardening/robustness improvement — what the code now does, not how it could be exploited. The GHSA advisory and CVE are drafted and published separately by the maintainer; premature disclosure in a public PR or release undermines coordinated disclosure.

Once the advisory is public, the release notes may be updated to reference the GHSA/CVE identifier (older releases cite them this way).
