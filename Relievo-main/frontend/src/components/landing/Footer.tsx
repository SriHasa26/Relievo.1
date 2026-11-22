import { ShieldAlert } from "lucide-react";

/** Footer of the public page only. States plainly that this is a demo with synthetic content. */
export function Footer() {
  return (
    <footer className="border-t px-4 py-10" style={{ background: "var(--surface)" }}>
      <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 font-display font-bold"><ShieldAlert className="size-5 text-brand" aria-hidden />Relievo</p>
        <p className="max-w-2xl text-sm muted">
          <strong style={{ color: "var(--text)" }}>Demo environment.</strong> Everything here is static, synthetic sample content for demonstration.
          These are not real emergencies, and nothing on this site contacts or dispatches real responders.
          If life is in danger, call your local emergency number.
        </p>
      </div>
    </footer>
  );
}
