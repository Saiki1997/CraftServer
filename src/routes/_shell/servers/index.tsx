import { createFileRoute } from "@tanstack/react-router";
import { ServersPage } from "@/components/craft/servers-page";

export const Route = createFileRoute("/_shell/servers/")({
  component: ServersPage,
});
