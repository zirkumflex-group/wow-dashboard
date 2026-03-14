import { useEffect, useState } from "react";
import { ConvexClient } from "convex/browser";
import { api } from "@wow-dashboard/backend/convex/_generated/api";
import { env } from "@wow-dashboard/env/app";

const client = new ConvexClient(env.VITE_CONVEX_URL);

export default function App() {
  const [status, setStatus] = useState<"checking" | "ok" | "error">("checking");

  useEffect(() => {
    return client.onUpdate(api.healthCheck.get, {}, (result) => {
      setStatus(result === "OK" ? "ok" : "error");
    });
  }, []);

  const dotColor =
    status === "checking" ? "bg-orange-400" : status === "ok" ? "bg-green-500" : "bg-red-500";

  const statusText =
    status === "checking" ? "Checking..." : status === "ok" ? "Connected" : "Error";

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-5xl font-bold text-white">Hello World</h1>
        <p className="text-gray-400 text-lg">WoW Dashboard — Electron + React + Tailwind</p>
        <div className="rounded-lg border border-gray-800 p-4 text-left">
          <h2 className="mb-2 font-medium text-white">API Status</h2>
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${dotColor}`} />
            <span className="text-sm text-gray-400">{statusText}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
