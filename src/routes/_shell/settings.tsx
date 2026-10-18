import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/components/craft/misc-pages";

export const Route = createFileRoute("/_shell/settings")({
  component: SettingsPage,
});
