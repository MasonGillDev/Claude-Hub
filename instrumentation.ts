/**
 * Runs once when the Next server starts (Next 16 instrumentation hook).
 *
 * The Node-only process handlers live in ./instrumentation.node and are loaded
 * via dynamic import so they're never bundled into the Edge runtime (where
 * `process.on` isn't available).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation.node");
  }
}
