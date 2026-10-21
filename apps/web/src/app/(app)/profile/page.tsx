import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingCta } from "@/components/app/onboarding-cta";
import { ProfileEditor } from "@/components/profile/profile-editor";
import { getCurrentUser } from "@/server/current-user";
import { getOnboardingState } from "@/server/onboarding/service";
import { getProfileForEdit } from "@/server/profile/service";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/profile");
  const profile = await getProfileForEdit(user.userId);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        Profile
      </h1>
      {profile ? (
        // Keyed by version: a refresh that brings a newer profile starts the editor from it.
        <ProfileEditor key={profile.version} init={profile} />
      ) : (
        <OnboardingCta
          state={await getOnboardingState(user.userId)}
          className="mt-8"
        />
      )}
    </div>
  );
}
