export const cleanupSchema = {
  name: "cleanup",
  description: "Cleanup all managed resources. Use when the user wants to cleanup.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  annotations: {
    destructiveHint: true,
  },
} as const;
