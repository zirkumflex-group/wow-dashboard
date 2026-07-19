import Loader2 from "lucide-react/dist/esm/icons/loader-2.mjs";

export default function Loader() {
  return (
    <div className="flex h-full items-center justify-center pt-8">
      <Loader2 className="animate-spin" />
    </div>
  );
}
