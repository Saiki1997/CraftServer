import { createFileRoute } from "@tanstack/react-router";
import { CreatePage } from "@/components/craft/create-page";

export const Route = createFileRoute("/_shell/create")({
  component: CreatePage,
});
