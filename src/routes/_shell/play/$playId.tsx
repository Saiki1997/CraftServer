import { createFileRoute } from "@tanstack/react-router";
import { PlayDetail } from "@/components/craft/play-detail";

export const Route = createFileRoute("/_shell/play/$playId")({
  component: PlayRoute,
});

function PlayRoute() {
  const { playId } = Route.useParams();
  return <PlayDetail playId={playId} />;
}
