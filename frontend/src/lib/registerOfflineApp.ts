import { registerSW } from "virtual:pwa-register";

const PREVIEW_LABEL = /^(?:id-preview|preview)(?:-[a-z0-9]+)?--.+$/;

export function isOfflineRegistrationRefused(hostname: string, search = ""): boolean {
  const host = hostname.toLowerCase();
  return (
    !import.meta.env.PROD ||
    window.top !== window.self ||
    PREVIEW_LABEL.test(host.split(".")[0] ?? "") ||
    host === "id-preview--9306f61f-554e-4bff-84b0-6ab6875186e0.lovable.app" ||
    host === "project--9306f61f-554e-4bff-84b0-6ab6875186e0-dev.lovable.app" ||
    host === "lovableproject.com" ||
    host.endsWith(".lovableproject.com") ||
    host === "lovableproject-dev.com" ||
    host.endsWith(".lovableproject-dev.com") ||
    host === "beta.lovable.dev" ||
    host.endsWith(".beta.lovable.dev") ||
    new URLSearchParams(search).get("sw") === "off"
  );
}

async function unregisterAppWorkers(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations
      .filter((registration) =>
        [registration.active, registration.waiting, registration.installing].some((worker) =>
          worker?.scriptURL.endsWith("/sw.js"),
        ),
      )
      .map((registration) => registration.unregister()),
  );
}

export async function registerOfflineApp(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  if (isOfflineRegistrationRefused(window.location.hostname, window.location.search)) {
    await unregisterAppWorkers();
    return;
  }
  registerSW({ immediate: true });
}
