const intervalMs = 60_000;

if (import.meta.main) {
  console.log("[worker] idle loop started");

  setInterval(() => {
    console.log("[worker] idle heartbeat");
  }, intervalMs);
}
