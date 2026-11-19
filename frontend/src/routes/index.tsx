import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const SignalTocApp = lazy(() => import("@/components/SignalTocApp"));

const TITLE = "X-Tractor — Universal Railway Signalling Layout & TOC Workbench";
const DESCRIPTION =
  "Universal railway RFID layout extraction, engineering validation, and Indian Railways Table of Control (TOC) generator.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
      Loading X-Tractor workbench…
    </div>
  );
}

function Index() {
  return (
    <ClientOnly fallback={<Loading />}>
      <Suspense fallback={<Loading />}>
        <SignalTocApp />
      </Suspense>
    </ClientOnly>
  );
}
