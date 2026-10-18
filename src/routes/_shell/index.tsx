import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/components/craft/dashboard";

export const Route = createFileRoute("/_shell/")({
  component: Dashboard,
});
