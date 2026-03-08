export const listNamespacesSchema = {
  name: "list_namespaces",
  description: "List all namespaces. Use when the user wants to see all available items in a collection or directory. Unlike list_api_resources, this tool specifically handles list namespaces.",
  inputSchema: {
    type: "object",
    properties: {},
  },
} as const;
