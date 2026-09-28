import type { MetadataRoute } from "next";

/**
 * Web app manifest (/manifest.webmanifest): installable on desktop (Chrome, Edge) and phones.
 * `start_url` is the root, which opens the last workspace; offline, the service worker sends it to
 * the last page it kept instead. Icons live in public/icons (generated from public/icons/icon.svg).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Leafdesk",
    short_name: "Leafdesk",
    description: "Pages, databases and live collaboration in one self-hosted workspace.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    categories: ["productivity"],
    icons: [
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
