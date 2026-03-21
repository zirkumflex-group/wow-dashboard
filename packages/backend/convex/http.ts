import { httpRouter } from "convex/server";

import { authComponent, createAuth } from "./auth";
import { redeemCode } from "./loginCodes";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

// One-time code exchange endpoint for the Electron OAuth handoff.
http.route({
  path: "/api/auth/redeem-code",
  method: "POST",
  handler: redeemCode,
});

export default http;
