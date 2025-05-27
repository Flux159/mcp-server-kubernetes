import { KubernetesManager } from "../types.js";
import { CoreV1Event as V1Event } from "@kubernetes/client-node";

export const getEventsSchema = {
  name: "get_events",
  description: "Get Kubernetes events from the cluster",
  inputSchema: {
    type: "object",
    properties: {
      namespace: {
        type: "string",
        description: "Namespace to get events from. If not specified, gets events from all namespaces",
      },
      fieldSelector: {
        type: "string",
        description: "Field selector to filter events",
      },
    },
    required: [],
  },
};

export async function getEvents(
  k8sManager: KubernetesManager,
  params: {
    namespace?: string;
    fieldSelector?: string;
  }
) {
  const { namespace, fieldSelector } = params;

  const api = k8sManager.getCoreApi();
  let events;

  if (namespace) {
    const { body } = await api.listNamespacedEvent(
      namespace,
      undefined, // pretty
      undefined, // allowWatchBookmarks
      undefined, // _continue
      undefined, // fieldSelector
      fieldSelector // fieldSelector
    );
    events = body;
  } else {
    const { body } = await api.listEventForAllNamespaces(
      undefined, // allowWatchBookmarks
      undefined, // _continue
      fieldSelector, // fieldSelector
      undefined, // labelSelector
      undefined, // limit
      undefined, // pretty
      undefined, // resourceVersion
      undefined, // resourceVersionMatch
      undefined // timeoutSeconds
    );
    events = body;
  }

  const formattedEvents = events.items.map((event: V1Event) => ({
    type: event.type || "",
    reason: event.reason || "",
    message: event.message || "",
    involvedObject: {
      kind: event.involvedObject.kind || "",
      name: event.involvedObject.name || "",
      namespace: event.involvedObject.namespace || "",
    },
    firstTimestamp: event.firstTimestamp || "",
    lastTimestamp: event.lastTimestamp || "",
    count: event.count || 0,
  }));

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ events: formattedEvents }, null, 2),
      },
    ],
  };
}
