import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/craft/shell";

export const Route = createFileRoute("/_shell")({
  component: Shell,
});
