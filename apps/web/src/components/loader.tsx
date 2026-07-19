import Loader2 from "lucide-react/dist/esm/icons/loader-2.mjs";

export default function Loader() {
  return (
    <div
      className="flex h-full items-center justify-center gap-2 pt-8 text-sm text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
      <span>Loading…</span>
    </div>
  );
}
