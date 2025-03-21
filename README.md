# MCP Server Kubernetes

[![CI](https://github.com/Flux159/mcp-server-kubernetes/actions/workflows/ci.yml/badge.svg)](https://github.com/yourusername/mcp-server-kubernetes/actions/workflows/ci.yml)
[![Language](https://img.shields.io/github/languages/top/Flux159/mcp-server-kubernetes)](https://github.com/yourusername/mcp-server-kubernetes)
[![Bun](https://img.shields.io/badge/runtime-bun-orange)](https://bun.sh)
[![Kubernetes](https://img.shields.io/badge/kubernetes-%23326ce5.svg?style=flat&logo=kubernetes&logoColor=white)](https://kubernetes.io/)
[![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=flat&logo=docker&logoColor=white)](https://www.docker.com/)
[![Stars](https://img.shields.io/github/stars/Flux159/mcp-server-kubernetes)](https://github.com/Flux159/mcp-server-kubernetes/stargazers)
[![Issues](https://img.shields.io/github/issues/Flux159/mcp-server-kubernetes)](https://github.com/Flux159/mcp-server-kubernetes/issues)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Flux159/mcp-server-kubernetes/pulls)
[![Last Commit](https://img.shields.io/github/last-commit/Flux159/mcp-server-kubernetes)](https://github.com/Flux159/mcp-server-kubernetes/commits/main)
[![smithery badge](https://smithery.ai/badge/mcp-server-kubernetes)](https://smithery.ai/protocol/mcp-server-kubernetes)

MCP Server that can connect to a Kubernetes cluster and manage it.

https://github.com/user-attachments/assets/f25f8f4e-4d04-479b-9ae0-5dac452dd2ed

<a href="https://glama.ai/mcp/servers/w71ieamqrt"><img width="380" height="200" src="https://glama.ai/mcp/servers/w71ieamqrt/badge" /></a>

## Usage with Claude Desktop

```json
{
  "mcpServers": {
    "kubernetes": {
      "command": "npx",
      "args": ["mcp-server-kubernetes"]
    }
  }
}
```

The server will automatically connect to your current kubectl context. Make sure you have:

1. kubectl installed and in your PATH
2. A valid kubeconfig file with contexts configured
3. Access to a Kubernetes cluster configured for kubectl (e.g. minikube, Rancher Desktop, GKE, etc.)
4. Helm v3 installed and in your PATH (no Tiller required). Optional if you don't plan to use Helm.

You can verify your connection by asking Claude to list your pods or create a test deployment.

If you have errors open up a standard terminal and run `kubectl get pods` to see if you can connect to your cluster without credentials issues.

## Usage with mcp-chat

[mcp-chat](https://github.com/Flux159/mcp-chat) is a CLI chat client for MCP servers. You can use it to interact with the Kubernetes server.

```shell
npx mcp-chat --server "npx mcp-server-kubernetes"
```

Alternatively, pass it your existing Claude Desktop configuration file from above (Linux should pass the correct path to config):

Mac:

```shell
npx mcp-chat --config "~/Library/Application Support/Claude/claude_desktop_config.json"
```

Windows:

```shell
npx mcp-chat --config "%APPDATA%\Claude\claude_desktop_config.json"
```

## Features

- [x] Connect to a Kubernetes cluster
- [x] List all pods
- [x] List all services
- [x] List all deployments
- [x] List all nodes
- [x] Create a pod
- [x] Delete a pod
- [x] Describe a pod
- [x] List all namespaces
- [x] Get logs from a pod for debugging (supports pods deployments jobs and label selectors)
- [x] Support Helm v3 for installing charts
  - Install charts with custom values
  - Uninstall releases
  - Upgrade existing releases
  - Support for namespaces
  - Support for version specification
  - Support for custom repositories
- [x] kubectl explain and kubectl api-resources support
- [x] Get Kubernetes events from the cluster
- [ ] Port forward to a pod
- [ ] Choose namespace for next commands (memory)

## Local Development

```bash
git clone https://github.com/Flux159/mcp-server-kubernetes.git
cd mcp-server-kubernetes
bun install
```

### Development Workflow

1. Start the server in development mode (watches for file changes):

```bash
bun run dev
```

2. Run unit tests:

```bash
bun run test
```

3. Build the project:

```bash
bun run build
```

4. Local Testing with [Inspector](https://github.com/modelcontextprotocol/inspector)

```bash
npx @modelcontextprotocol/inspector node dist/index.js
# Follow further instructions on terminal for Inspector link
```

5. Local testing with Claude Desktop

```json
{
  "mcpServers": {
    "mcp-server-kubernetes": {
      "command": "node",
      "args": ["/path/to/your/mcp-server-kubernetes/dist/index.js"]
    }
  }
}
```

6. Local testing with [mcp-chat](https://github.com/Flux159/mcp-chat)

```bash
npm run chat
```

### Project Structure

```
├── src/
│   ├── index.ts              # Main server implementation
│   ├── types.ts              # Type re-exports
│   ├── config/               # Configuration files
│   │   ├── container-templates.ts  # Container configurations
│   │   ├── server-config.ts        # Server settings
│   │   ├── deployment-config.ts    # Deployment schemas
│   │   ├── namespace-config.ts     # Namespace schemas
│   │   └── cleanup-config.ts       # Resource cleanup configuration
│   ├── models/               # Data models and schemas
│   │   ├── response-schemas.ts     # API response schemas
│   │   ├── resource-models.ts      # Resource models
│   │   ├── tool-models.ts          # Tool schemas
│   │   ├── helm-models.ts          # Helm operation schemas
│   │   └── kubectl-models.ts       # Kubectl operation schemas
│   ├── utils/                # Utility classes
│   │   └── kubernetes-manager.ts   # K8s management
│   ├── resources/            # Resource handlers
│   │   └── handlers.ts       # Resource implementation
│   └── tools/                # Tool implementations
│       ├── list_pods.ts      # Pod listing operations
│       ├── list_services.ts  # Service listing operations
│       ├── list_deployments.ts # Deployment listing operations
│       ├── list_nodes.ts     # Node listing operations
│       ├── create_pod.ts     # Pod creation operations
│       ├── delete_pod.ts     # Pod deletion operations
│       ├── describe_pod.ts   # Pod description operations
│       ├── get_logs.ts       # Container logs operations
│       ├── get_events.ts     # Kubernetes events operations
│       ├── helm-operations.ts # Helm chart operations
│       └── kubectl-operations.ts # Kubectl utility operations
├── tests/                    # Test files
│   ├── unit.test.ts          # Unit tests for basic operations
│   ├── helm.test.ts          # Helm-specific tests
│   └── kubectl.test.ts       # Kubectl-specific tests
├── .github/                  # GitHub configuration
│   └── workflows/            # CI/CD workflows
│       ├── ci.yml            # Continuous integration
│       └── cd.yml            # Continuous deployment
├── Dockerfile                # Docker container definition
├── LICENSE                   # MIT license
├── README.md                 # Project documentation
├── package.json              # NPM package configuration
├── tsconfig.json             # TypeScript configuration
└── vitest.config.ts          # Test configuration
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

For bigger changes please open an issue first to discuss the proposed changes.

## Architecture

This section describes the high-level architecture of the MCP Kubernetes server.

### Request Flow

The sequence diagram below illustrates how requests flow through the system:

```mermaid
sequenceDiagram
    participant Client
    participant Transport as StdioTransport
    participant Server as MCP Server
    participant Handler as Request Handler
    participant K8sManager as KubernetesManager
    participant K8s as Kubernetes API

    Client->>Transport: Send Request via STDIO
    Transport->>Server: Forward Request

    alt Tools Request
        Server->>Handler: Route to tools handler
        Handler->>K8sManager: Execute tool operation
        K8sManager->>K8s: Make API call
        K8s-->>K8sManager: Return result
        K8sManager-->>Handler: Process response
        Handler-->>Server: Return tool result
    else Resource Request
        Server->>Handler: Route to resource handler
        Handler->>K8sManager: Get resource data
        K8sManager->>K8s: Query API
        K8s-->>K8sManager: Return data
        K8sManager-->>Handler: Format response
        Handler-->>Server: Return resource data
    end

    Server-->>Transport: Send Response
    Transport-->>Client: Return Final Response
```

## Publishing new release

Go to the [releases page](https://github.com/Flux159/mcp-server-kubernetes/releases), click on "Draft New Release", click "Choose a tag" and create a new tag by typing out a new version number using "v{major}.{minor}.{patch}" semver format. Then, write a release title "Release v{major}.{minor}.{patch}" and description / changelog if necessary and click "Publish Release".

This will create a new tag which will trigger a new release build via the cd.yml workflow. Once successful, the new release will be published to [npm](https://www.npmjs.com/package/mcp-server-kubernetes). Note that there is no need to update the package.json version manually, as the workflow will automatically update the version number in the package.json file & push a commit to main.

## Not planned

Authentication / adding clusters to kubectx.
