import { createFileRoute } from "@tanstack/react-router";
import { DownloadsPage } from "@/components/craft/misc-pages";

export const Route = createFileRoute("/_shell/downloads")({
  component: DownloadsPage,
});
