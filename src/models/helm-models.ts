import { z } from "zod";

export const HelmResponseSchema = z.object({
  content: z.array(
    z.object({
      type: z.literal("text"),
      text: z.string(),
    })
  ),
});

export const HelmValuesSchema = z.record(z.any());

export interface HelmOperation {
  name: string;
  namespace: string;
}

export interface HelmInstallOperation extends HelmOperation {
  chart: string;
  repo?: string;
  values?: Record<string, any>;
  valuesFile?: string;
  createNamespace?: boolean;
  useTemplate?: boolean;
}

export interface HelmUpgradeOperation extends HelmInstallOperation {}

export type HelmResponse = {
  status: "installed" | "upgraded" | "uninstalled";
  message?: string;
};
