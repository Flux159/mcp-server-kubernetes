# mcp-server-kubernetes
[![smithery badge](https://smithery.ai/badge/mcp-server-kubernetes)](https://smithery.ai/servers/mcp-server-kubernetes)

MCP Server that can connect to a Kubernetes cluster and manage it.

https://github.com/user-attachments/assets/f25f8f4e-4d04-479b-9ae0-5dac452dd2ed

<a href="https://glama.ai/mcp/servers/w71ieamqrt"><img width="380" height="200" src="https://glama.ai/mcp/servers/w71ieamqrt/badge" /></a>

## Usage with Claude Desktop

### Installing via Smithery

To install Kubernetes Server for Claude Desktop automatically via [Smithery](https://smithery.ai/servers/mcp-server-kubernetes):

```bash
npx -y @smithery/cli install mcp-server-kubernetes --client claude
```

### Manual Installation
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

You can verify your connection by asking Claude to list your pods or create a test deployment.

If you have errors, open up a standard terminal and run `kubectl get pods` to see if you can connect to your cluster without credentials issues.

## Features

- [x] Connect to a Kubernetes cluster
- [x] List all pods
- [x] List all services
- [x] List all deployments
- [x] Create a pod
- [x] Delete a pod
- [x] List all namespaces
- [] Port forward to a pod
- [] Get logs from a pod for debugging
- [] Choose namespace for next commands (memory)
- [] Support Helm for installing charts

## Development & Testing

```bash
git clone https://github.com/Flux159/mcp-server-kubernetes.git
cd mcp-server-kubernetes
bun install
bun run test
```

## Not planned

Authentication / adding clusters to kubectx.
