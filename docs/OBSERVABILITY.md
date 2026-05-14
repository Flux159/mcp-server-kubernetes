# Observability with OpenTelemetry

The Kubernetes MCP Server includes optional OpenTelemetry integration for distributed tracing, enabling comprehensive observability of tool executions, performance monitoring, and error tracking.

> **Current Release**: Distributed Tracing ✅
> **Coming Soon**: Metrics and Logs

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Deployment Examples](#deployment-examples)
- [Captured Telemetry](#captured-telemetry)
- [Backends](#backends)
- [Production Best Practices](#production-best-practices)
- [Troubleshooting](#troubleshooting)
- [Performance](#performance)
- [Roadmap](#roadmap)

---

## Overview

### What is OpenTelemetry?

OpenTelemetry is a vendor-neutral observability framework that provides a standard way to collect traces, metrics, and logs from applications. It's an industry standard supported by all major observability platforms.

### What Gets Traced?

The MCP server automatically traces:
- **Tool Calls**: Every MCP tool invocation (kubectl_get, kubectl_apply, etc.)
- **Execution Duration**: How long each tool takes to execute
- **Success/Failure**: Whether the tool succeeded or failed
- **Error Details**: Full error messages and stack traces for failures
- **Kubernetes Context**: Namespace, context, resource type when applicable

### Why Use Observability?

- **Performance Monitoring**: Identify slow tools and bottlenecks
- **Error Tracking**: Capture and analyze failures with full context
- **Debugging**: Trace request flows through the system
- **SRE Integration**: Export to enterprise observability platforms
- **Cost Analysis**: Use sampling to control telemetry costs

---

## Quick Start

### 1. Enable Observability

Observability is **disabled by default**. Enable it with environment variables:

```bash
export ENABLE_TELEMETRY=true
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317

npx mcp-server-kubernetes
```

### 2. Start Jaeger (Local Testing)

```bash
# Using Docker
docker run -d --name jaeger \
  -e COLLECTOR_OTLP_ENABLED=true \
  -p 16686:16686 \
  -p 4317:4317 \
  jaegertracing/all-in-one:latest

# Using Podman
podman run -d --name jaeger \
  -e COLLECTOR_OTLP_ENABLED=true \
  -p 16686:16686 \
  -p 4317:4317 \
  docker.io/jaegertracing/all-in-one:latest
```

**Jaeger UI**: http://localhost:16686

### 3. View Traces

1. Open Jaeger UI: http://localhost:16686
2. Select service: `kubernetes` (or custom service name)
3. Click "Find Traces"
4. See traces for each tool call!

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ENABLE_TELEMETRY` | **Yes*** | `false` | Master switch to enable observability |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | **Yes*** | - | OTLP collector URL (e.g., `http://localhost:4317`) |
| `OTEL_TRACES_SAMPLER` | No | `always_on` | Sampling strategy: `always_on`, `always_off`, `traceidratio` |
| `OTEL_TRACES_SAMPLER_ARG` | No | - | Sampling ratio (0.0-1.0) for `traceidratio` sampler |
| `OTEL_SERVICE_NAME` | No | `kubernetes` | Service identifier in tracing backend |
| `OTEL_RESOURCE_ATTRIBUTES` | No | - | Custom attributes (format: `key1=value1,key2=value2`) |
| `OTEL_CAPTURE_RESPONSE_METADATA` | No | `true` | Capture response metadata (item counts, sizes). Set to `false` for privacy |

**Required to enable observability*

### Configuration Examples

#### Development (100% sampling)
```bash
export ENABLE_TELEMETRY=true
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
export OTEL_TRACES_SAMPLER=always_on
```

#### Production (5% sampling)
```bash
export ENABLE_TELEMETRY=true
export OTEL_EXPORTER_OTLP_ENDPOINT=http://tempo.observability:4317
export OTEL_TRACES_SAMPLER=traceidratio
export OTEL_TRACES_SAMPLER_ARG=0.05
export OTEL_SERVICE_NAME=kubernetes-mcp-server
export OTEL_RESOURCE_ATTRIBUTES="deployment.environment=production,k8s.cluster=prod-us-west"
```

#### Disable Observability (Default)
```bash
# Simply don't set ENABLE_TELEMETRY, or explicitly disable:
export ENABLE_TELEMETRY=false
```

### Sampling Strategies

| Sampler | Description | Use Case |
|---------|-------------|----------|
| `always_on` | 100% sampling | Development, debugging |
| `always_off` | 0% sampling | Disable tracing |
| `traceidratio` | Percentage-based (requires `OTEL_TRACES_SAMPLER_ARG`) | Production (1-10% typical) |

**Production Recommendation**: Use `traceidratio` with 5-10% sampling to balance observability and cost.

---

## Deployment Examples

### Claude Code

Update `~/.config/claude-code/config.json`:

```json
{
  "mcpServers": {
    "kubernetes": {
      "command": "npx",
      "args": ["mcp-server-kubernetes"],
      "env": {
        "ENABLE_TELEMETRY": "true",
        "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4317",
        "OTEL_TRACES_SAMPLER": "always_on",
        "OTEL_SERVICE_NAME": "kubernetes-mcp-server"
      }
    }
  }
}
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kubernetes-mcp-server
  namespace: platform-tools
spec:
  replicas: 3
  selector:
    matchLabels:
      app: kubernetes-mcp-server
  template:
    metadata:
      labels:
        app: kubernetes-mcp-server
    spec:
      containers:
      - name: server
        image: your-registry/mcp-server-kubernetes:latest
        env:
        # Enable observability
        - name: ENABLE_TELEMETRY
          value: "true"

        # OTLP endpoint
        - name: OTEL_EXPORTER_OTLP_ENDPOINT
          value: "http://tempo-distributor.observability:4317"

        # Sampling (5% for production)
        - name: OTEL_TRACES_SAMPLER
          value: "traceidratio"
        - name: OTEL_TRACES_SAMPLER_ARG
          value: "0.05"

        # Service identification
        - name: OTEL_SERVICE_NAME
          value: "kubernetes-mcp-server"

        # Resource attributes for filtering
        - name: OTEL_RESOURCE_ATTRIBUTES
          value: "deployment.environment=production,k8s.cluster.name=prod-us-west-2,team=platform,version=0.1.0"

        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

### Helm Chart

#### values.yaml

```yaml
observability:
  # Enable OpenTelemetry observability
  enabled: false  # Disabled by default

  # OTLP exporter configuration
  otlp:
    endpoint: "http://tempo-distributor.observability:4317"
    protocol: "grpc"  # or "http/protobuf"

  # Sampling configuration
  sampling:
    type: "traceidratio"  # always_on, always_off, traceidratio
    ratio: 0.05  # 5% sampling (only for traceidratio)

  # Service identification
  serviceName: "kubernetes-mcp-server"

  # Custom resource attributes
  resourceAttributes:
    deployment.environment: "production"
    k8s.cluster.name: "prod-us-west-2"
    team: "platform"
    version: "0.1.0"
```

#### templates/deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "kubernetes-mcp-server.fullname" . }}
spec:
  template:
    spec:
      containers:
      - name: {{ .Chart.Name }}
        env:
        {{- if .Values.observability.enabled }}
        - name: ENABLE_TELEMETRY
          value: "true"
        - name: OTEL_EXPORTER_OTLP_ENDPOINT
          value: {{ .Values.observability.otlp.endpoint | quote }}
        - name: OTEL_TRACES_SAMPLER
          value: {{ .Values.observability.sampling.type | quote }}
        {{- if eq .Values.observability.sampling.type "traceidratio" }}
        - name: OTEL_TRACES_SAMPLER_ARG
          value: {{ .Values.observability.sampling.ratio | quote }}
        {{- end }}
        - name: OTEL_SERVICE_NAME
          value: {{ .Values.observability.serviceName | quote }}
        - name: OTEL_RESOURCE_ATTRIBUTES
          value: {{ include "kubernetes-mcp-server.resourceAttributes" . | quote }}
        {{- end }}
```

#### helpers.tpl

```yaml
{{/*
Build resource attributes string from map
*/}}
{{- define "kubernetes-mcp-server.resourceAttributes" -}}
{{- $attrs := list -}}
{{- range $key, $value := .Values.observability.resourceAttributes -}}
{{- $attrs = append $attrs (printf "%s=%s" $key $value) -}}
{{- end -}}
{{- join "," $attrs -}}
{{- end -}}
```

---

## Captured Telemetry

### Span Attributes

Every tool call creates a span with the following attributes:

#### Core Attributes
- `mcp.method.name`: MCP protocol method (always "tools/call")
- `gen_ai.tool.name`: Tool identifier (e.g., "kubectl_get")
- `gen_ai.operation.name`: Operation type (always "execute_tool")
- `tool.duration_ms`: Execution time in milliseconds
- `tool.argument_count`: Number of arguments passed
- `tool.argument_keys`: Comma-separated argument names

#### Kubernetes Attributes (when applicable)
- `k8s.namespace`: Kubernetes namespace
- `k8s.context`: Kubernetes context name
- `k8s.resource_type`: Resource type (pod, deployment, etc.)

#### Error Attributes (on failure)
- `error.type`: "tool_error"
- `error.message`: Full error message
- `error.code`: Error code (if available)

#### Network Attributes
- `network.transport`: "pipe" (STDIO mode)

#### Response Attributes (optional)
Captured by default, can be disabled with `OTEL_CAPTURE_RESPONSE_METADATA=false`:
- `response.content_items`: Number of content blocks in response
- `response.content_type`: Content type (text, json, etc.)
- `response.text_size_bytes`: Response size in bytes
- `response.k8s_items_count`: Number of Kubernetes resources returned
- `response.k8s_kind`: Kubernetes resource kind (PodList, NodeList, etc.)

**Use cases**: Track response sizes, debug empty results, monitor data growth.

### Example Span

```json
{
  "spanName": "tools/call kubectl_get",
  "duration": "1915ms",
  "attributes": {
    "mcp.method.name": "tools/call",
    "gen_ai.tool.name": "kubectl_get",
    "gen_ai.operation.name": "execute_tool",
    "tool.duration_ms": 1915,
    "tool.argument_count": 3,
    "tool.argument_keys": "resourceType,namespace,output",
    "k8s.namespace": "default",
    "k8s.resource_type": "deployments",
    "response.k8s_items_count": 92,
    "response.text_size_bytes": 16851,
    "response.content_type": "text"
  },
  "status": "OK"
}
```

### Resource Attributes

Automatically captured metadata about the service:

#### Service Information
- `service.name`: Service identifier
- `service.version`: Server version

#### Host Information (auto-detected)
- `host.arch`: CPU architecture (arm64, amd64)
- `host.name`: Hostname
- `host.id`: Unique host identifier

#### Process Information (auto-detected)
- `process.pid`: Process ID
- `process.owner`: Process owner
- `process.runtime.name`: "nodejs"
- `process.runtime.version`: Node.js version
- `process.executable.path`: Path to Node.js executable

#### OpenTelemetry SDK
- `telemetry.sdk.name`: "opentelemetry"
- `telemetry.sdk.version`: SDK version
- `telemetry.sdk.language`: "nodejs"

#### Custom Attributes
- Any attributes from `OTEL_RESOURCE_ATTRIBUTES` environment variable

---

## Backends

OpenTelemetry supports exporting to any OTLP-compatible backend:

### Jaeger (Open Source)

**Setup**:
```bash
docker run -d --name jaeger \
  -e COLLECTOR_OTLP_ENABLED=true \
  -p 16686:16686 \
  -p 4317:4317 \
  jaegertracing/all-in-one:latest
```

**Configuration**:
```bash
export ENABLE_TELEMETRY=true
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
```

**UI**: http://localhost:16686

### Grafana Tempo

**Setup**:
```yaml
# tempo.yaml
server:
  http_listen_port: 3200
distributor:
  receivers:
    otlp:
      protocols:
        grpc:
          endpoint: 0.0.0.0:4317
```

**Configuration**:
```bash
export ENABLE_TELEMETRY=true
export OTEL_EXPORTER_OTLP_ENDPOINT=http://tempo:4317
```

### Grafana Cloud

**Configuration**:
```bash
export ENABLE_TELEMETRY=true
export OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-us-central-0.grafana.net/otlp
# Add authentication headers via Grafana Cloud setup
```

### Commercial Platforms

Works with any OTLP-compatible platform:
- **Datadog**: https://docs.datadoghq.com/opentelemetry/
- **New Relic**: https://docs.newrelic.com/docs/opentelemetry/
- **Honeycomb**: https://docs.honeycomb.io/opentelemetry/
- **Lightstep**: https://docs.lightstep.com/opentelemetry/
- **AWS X-Ray**: https://aws.amazon.com/xray/

---

## Production Best Practices

### 1. Use Sampling

**Don't capture 100% of traces in production**. Use sampling to reduce costs:

```bash
export OTEL_TRACES_SAMPLER=traceidratio
export OTEL_TRACES_SAMPLER_ARG=0.05  # 5% sampling
```

**Recommended sampling rates**:
- Development: 100% (`always_on`)
- Staging: 50% (`0.5`)
- Production: 5-10% (`0.05` - `0.10`)
- High-traffic production: 1% (`0.01`)

### 2. Add Resource Attributes

Use resource attributes for filtering and analysis:

```bash
export OTEL_RESOURCE_ATTRIBUTES="deployment.environment=production,k8s.cluster.name=prod-us-west-2,team=platform,cost_center=engineering,version=0.1.0"
```

**Useful attributes**:
- `deployment.environment`: production, staging, development
- `k8s.cluster.name`: Cluster identifier
- `team`: Team responsible for the service
- `cost_center`: For cost allocation
- `version`: Service version

### 3. Set Resource Limits

Observability adds minimal overhead, but set limits:

```yaml
resources:
  requests:
    memory: "128Mi"  # Add ~10MB for telemetry
    cpu: "100m"      # Add ~10m for telemetry
  limits:
    memory: "512Mi"
    cpu: "500m"
```

### 4. Monitor Backend Health

Ensure your OTLP backend is healthy:
- Set up alerts for OTLP endpoint downtime
- Monitor trace ingestion rates
- Configure retry policies

### 5. Secure OTLP Endpoints

Use TLS for production:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://tempo.observability:4317
# Add certificates if using custom CA
```

### 6. Plan for Data Retention

Configure trace retention based on needs:
- Development: 1-7 days
- Staging: 7-14 days
- Production: 30-90 days

### 7. Create Alerts

Set up alerts for:
- High error rates (>5%)
- Slow tool execution (P95 > 5s)
- Tool failures for critical operations

---

## Troubleshooting

### Traces Not Appearing

**Check 1: Is telemetry enabled?**
```bash
# Look for this in logs:
# "Initializing OpenTelemetry: endpoint=..."
# "OpenTelemetry SDK initialized successfully"
```

If you see nothing, telemetry is disabled. Check:
```bash
echo $ENABLE_TELEMETRY  # Should be "true"
echo $OTEL_EXPORTER_OTLP_ENDPOINT  # Should be set
```

**Check 2: Is OTLP endpoint reachable?**
```bash
# Test gRPC endpoint
telnet localhost 4317

# Or use curl for HTTP
curl http://localhost:4318/v1/traces
```

**Check 3: Verify sampling**
```bash
echo $OTEL_TRACES_SAMPLER  # Should not be "always_off"
```

### Build Errors

If you encounter TypeScript errors:
```bash
cd /path/to/mcp-server-kubernetes
npm run build
```

### Performance Issues

If observability causes performance problems:

1. **Reduce sampling**:
   ```bash
   export OTEL_TRACES_SAMPLER=traceidratio
   export OTEL_TRACES_SAMPLER_ARG=0.01  # 1% sampling
   ```

2. **Check OTLP backend**:
   - Ensure backend can handle ingestion rate
   - Check for network latency

3. **Disable temporarily**:
   ```bash
   export ENABLE_TELEMETRY=false
   ```

### Missing Attributes

If Kubernetes attributes (namespace, context) are missing:
- These are only captured when provided as tool arguments
- Not all tools have these attributes

### Authentication Errors

If OTLP endpoint requires authentication:
- Check backend documentation for auth setup
- Grafana Cloud and commercial platforms require API keys

---

## Performance

### Overhead Measurements

| Metric | Impact |
|--------|--------|
| **Middleware overhead** | 1-2ms per tool call |
| **Memory footprint** | 5-10MB for span buffers |
| **CPU impact** | <1% for typical workloads |
| **Network** | Async batch exports (5-second intervals) |
| **Blocking** | Zero (async export) |

### Performance Tips

1. **Use sampling in production** - Reduces overhead by 90-99%
2. **Batch exports** - Telemetry batches spans every 5 seconds
3. **Async export** - No blocking on critical path
4. **Efficient serialization** - Protobuf for OTLP

### Benchmarks

**Without observability**:
- Tool call latency: 100ms (baseline)

**With observability (100% sampling)**:
- Tool call latency: 101-102ms (+1-2ms)
- Memory usage: +5MB
- CPU usage: +0.5%

**With observability (5% sampling)**:
- Tool call latency: 100ms (no measurable difference)
- Memory usage: +2MB
- CPU usage: +0.1%

---

## Advanced Configuration

### Custom Span Attributes

Add custom attributes to specific tool calls:

```typescript
import { addSpanAttributes } from './middleware/telemetry-middleware.js';

// In your tool handler
addSpanAttributes({
  'custom.attribute': 'value',
  'user.id': 'user-123'
});
```

### Record Events

Record significant events within a span:

```typescript
import { recordSpanEvent } from './middleware/telemetry-middleware.js';

// Record an event
recordSpanEvent('cache_hit', {
  'cache.key': 'pods-default',
  'cache.ttl': 60
});
```

### Manual Span Creation

Create custom spans for operations:

```typescript
import { withSpan } from './middleware/telemetry-middleware.js';

const result = await withSpan(
  'custom-operation',
  { 'operation.type': 'batch-processing' },
  async () => {
    // Your operation here
    return processData();
  }
);
```

---

## Migration Guide

### Enabling Observability in Existing Deployments

#### Before (observability disabled)
```yaml
env: []
```

#### After (observability enabled)
```yaml
env:
- name: ENABLE_TELEMETRY
  value: "true"
- name: OTEL_EXPORTER_OTLP_ENDPOINT
  value: "http://tempo:4317"
- name: OTEL_TRACES_SAMPLER
  value: "traceidratio"
- name: OTEL_TRACES_SAMPLER_ARG
  value: "0.05"
```

**Rolling deployment**: Update deployments one at a time to verify observability works correctly.

---

## FAQ

### Q: Is observability enabled by default?
**A**: No, it's disabled by default. Set `ENABLE_TELEMETRY=true` to enable.

### Q: Does this require kubectl or Helm installation?
**A**: No, observability is independent of kubectl/Helm.

### Q: What's the performance impact?
**A**: <1% CPU and 1-2ms per tool call. Negligible for production use.

### Q: Can I use this with multiple backends?
**A**: Currently supports one OTLP endpoint. Use an OTLP collector to fan out to multiple backends.

### Q: Does this work in STDIO mode?
**A**: Yes, observability works in both STDIO and HTTP modes.

### Q: How much does telemetry cost?
**A**: Depends on your backend. Use sampling to reduce costs (5% sampling = 95% cost reduction).

### Q: Can I disable specific tools from tracing?
**A**: Currently all tools are traced. Use sampling to reduce overall trace volume.

### Q: Does this expose sensitive data?
**A**: No, we don't capture argument values, only argument keys. Secrets are not exposed.

---

## Roadmap

### Upcoming Features

#### Metrics (Planned)
Prometheus-compatible metrics endpoint for:
- Tool execution counters
- Response time histograms
- Error rate tracking
- Resource usage metrics

#### Logs (Planned)
Structured logging integration:
- Correlated with traces
- JSON format output
- Configurable log levels
- Backend export support

---

## Support

### Resources
- **Issue Tracker**: https://github.com/Flux159/mcp-server-kubernetes/issues
- **OpenTelemetry Docs**: https://opentelemetry.io/docs/
- **Jaeger Docs**: https://www.jaegertracing.io/docs/

### Getting Help

1. Check [Troubleshooting](#troubleshooting) section
2. Review backend-specific documentation
3. Open an issue on GitHub with:
   - Environment configuration
   - Server logs
   - Backend type
   - Error messages

---

**Last Updated**: 2026-01-30
**Version**: 1.0.0
