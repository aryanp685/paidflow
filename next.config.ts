import type { NextConfig } from "next";
import { validatePublicEnvironment } from "./src/lib/supabase/validate-env";
// Local lab configuration has no place in a production process. Fail before
// initializing either lab; never include configured values in the error.
if (process.env.NODE_ENV === "production" && Object.keys(process.env).some(key => key.startsWith("PAIDFLOW_BA_LAB_") || key.startsWith("PAIDFLOW_STORAGE_LAB_"))) {
  throw new Error("Local lab configuration is forbidden in production.");
}
validatePublicEnvironment();
const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "*.e2b.app"],
  // Better Auth email links carry one-time tokens in URLs. Do not log lab requests.
  logging: { incomingRequests: { ignore: [/\/(?:api\/)?better-auth-lab(?:\/|\?|$)/, /\/api\/storage-lab(?:\/|\?|$)/] } },
  async headers() { return ["/better-auth-lab/:path*", "/api/better-auth-lab/:path*", "/api/storage-lab/:path*"].map(source => ({source, headers: [
    {key:"Referrer-Policy",value:"no-referrer"}, {key:"Cache-Control",value:"no-store"}, {key:"X-Robots-Tag",value:"noindex, nofollow"},
  ]})); },
};
export default nextConfig;
