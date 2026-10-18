import { createFileRoute } from "@tanstack/react-router";
import { PlayPage } from "@/components/craft/play-page";

export const Route = createFileRoute("/_shell/play/")({
  component: PlayPage,
});
