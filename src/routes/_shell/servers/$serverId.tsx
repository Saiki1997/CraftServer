import { createFileRoute } from "@tanstack/react-router";
import { ServerDetail } from "@/components/craft/server-detail";

export const Route = createFileRoute("/_shell/servers/$serverId")({
  component: ServerRoute,
});

function ServerRoute() {
  const { serverId } = Route.useParams();
  return <ServerDetail serverId={serverId} />;
}
