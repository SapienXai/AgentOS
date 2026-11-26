"use client";

import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

import { useSurfaceTheme } from "@/components/ui/surface-theme-provider";

export { toast } from "sonner";

export function Toaster(props: ToasterProps) {
  const { surfaceTheme } = useSurfaceTheme();
  return <SonnerToaster theme={surfaceTheme} {...props} />;
}
