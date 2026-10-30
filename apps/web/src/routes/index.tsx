import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return <main className="p-8 text-2xl font-semibold">Runlet</main>;
}
