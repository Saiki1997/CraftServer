import { createFileRoute } from "@tanstack/react-router";
import { JavaPage } from "@/components/craft/misc-pages";

export const Route = createFileRoute("/_shell/java")({
  component: JavaPage,
});
