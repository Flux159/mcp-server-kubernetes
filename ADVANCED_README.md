# Advanced README for mcp-server-kubernetes

To enable [SSE transport](https://modelcontextprotocol.io/docs/concepts/transports#server-sent-events-sse) for mcp-server-kubernetes, use the ENABLE_UNSAFE_SSE_TRANSPORT environment variable.

```shell
ENABLE_UNSAFE_SSE_TRANSPORT=1 npx flux159/mcp-server-kubernetes
```

This will start an http server with the `/sse` endpoint for server-sent events. Use the `PORT` env var to configure the server port.

```shell
ENABLE_UNSAFE_SSE_TRANSPORT=1 PORT=3001 npx flux159/mcp-server-kubernetes
```

This will allow clients to connect via HTTP to the `/sse` endpoint and receive server-sent events. You can test this by using curl (using port 3001 from above):

```shell
curl http://localhost:3001/sse
```

You will receive a response like this:

```
event: endpoint
data: /messages?sessionId=b74b64fb-7390-40ab-8d16-8ed98322a6e6
```

Take note of the session id and make a request to the endpoint provided:

```shell
curl -X POST -H "Content-Type: application/json" -d '{"jsonrpc": "2.0", "id": 1234, "method": "tools/call", "params": {"name": "list_pods", "namespace": "default"}}'  "http://localhost:3001/messages?sessionId=b74b64fb-7390-40ab-8d16-8ed98322a6e6"
```

If there's no error, you will receive an `event: message` response in the localhost:3001/sse session.

Note that normally a client would handle this for you. This is just a demonstration of how to use the SSE transport.

## Why is it Unsafe?

SSE transport exposes an http endpoint that can be accessed by anyone with the URL. This can be a security risk if the server is not properly secured. It is recommended to use a secure proxy server to proxy to the SSE endpoint. In addition, anyone with access to the URL will be able to utilize the authentication of your kubeconfig to make requests to your Kubernetes cluster. You should add logging to your proxy in order to monitor user requests to the SSE endpoint.
