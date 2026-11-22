// Public landing page: hero, modules, 3D workflow, live rooms, sign-in, footer. Shown at /login (before sign-in) and /welcome.
import { Capabilities } from "@/components/landing/Capabilities";
import { Footer } from "@/components/landing/Footer";
import { Hero } from "@/components/landing/Hero";
import { LandingNav } from "@/components/landing/LandingNav";
import { Rooms } from "@/components/landing/Rooms";
import { SignInSection } from "@/components/landing/SignInSection";
import { Workflow3D } from "@/components/landing/Workflow3D";

export default function Landing() {
  return (
    <div className="app-root">
      <LandingNav />
      <main>
        <Hero />
        <Capabilities />
        <Workflow3D />
        <Rooms />
        <SignInSection />
      </main>
      <Footer />
    </div>
  );
}
