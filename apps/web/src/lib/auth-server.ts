import { convexBetterAuthReactStart } from "@convex-dev/better-auth/react-start";
import { getPublicRuntimeEnv } from "@/lib/runtime-env";

const runtimeEnv = getPublicRuntimeEnv();

export const { handler, getToken, fetchAuthQuery, fetchAuthMutation, fetchAuthAction } =
  convexBetterAuthReactStart({
    convexUrl: runtimeEnv.VITE_CONVEX_URL,
    convexSiteUrl: runtimeEnv.VITE_CONVEX_SITE_URL,
  });
