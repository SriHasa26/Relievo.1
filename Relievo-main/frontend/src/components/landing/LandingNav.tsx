import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { NeuToggle, ThemeToggle } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useLargeText } from "@/lib/prefs";
import { HOME } from "@/lib/types";

const LINKS: Array<[string, string]> = [["#capabilities", "What it does"], ["#workflow", "How it works"], ["#rooms", "Live rooms"], ["#evaluator", "Evaluator access"]];

/** Sticky glass nav for the public page. Anchors scroll smoothly (CSS); nothing hijacks the scroll wheel. */
export function LandingNav() {
  const { user } = useAuth();
  const [large, setLarge] = useLargeText();
  return (
    <header className="glass sticky top-0 z-[1100] rounded-none border-x-0 border-t-0">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
        <a href="#top" className="flex items-center gap-2 font-display text-lg font-bold">
          <ShieldAlert className="size-6 text-brand" aria-hidden /> Relievo
        </a>
        <nav aria-label="Sections" className="ml-4 hidden items-center gap-1 md:flex">
          {LINKS.map(([href, text]) => (
            <a key={href} href={href} className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--surface-2)]">{text}</a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <label className="hidden items-center gap-2 text-sm font-medium lg:flex">
            Large text <NeuToggle checked={large} onChange={setLarge} label="Large text" />
          </label>
          <ThemeToggle />
          {user
            ? <Link to={HOME[user.role]}><Button size="sm">Open dashboard</Button></Link>
            : <a href="#signin"><Button size="sm">Sign in</Button></a>}
        </div>
      </div>
    </header>
  );
}
