import { RouteNotFound } from "@/components/patterns/route-not-found";

export default function AppSegmentNotFound() {
  return (
    <RouteNotFound
      description="That page doesn't exist, or you don't have access to it. Use the sidebar, or head back to your overview."
      homeHref="/overview"
      homeLabel="Go to Overview"
    />
  );
}
