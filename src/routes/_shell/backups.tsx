import { createFileRoute } from "@tanstack/react-router";
import { BackupsPage } from "@/components/craft/misc-pages";

export const Route = createFileRoute("/_shell/backups")({
  component: BackupsPage,
});
