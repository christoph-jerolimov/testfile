import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./components/App.js";
// Imported rather than linked from the HTML, so the bundle carries it and
// the stylesheet gets the same content hash treatment as the script.
import "./style.css";

// The server pushes changes over /api/events, so nothing here polls or
// refetches on its own: a query is stale only when that ping says so.
const client = new QueryClient({
  defaultOptions: {
    queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false },
  },
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <App />
  </QueryClientProvider>,
);
