"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Settings, User } from "lucide-react";
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
  getInitials,
} from "@bebest/ui";
import { apiClient } from "@/lib/api-client";
import { clearSession, getRefreshToken } from "@/lib/auth-state";
import { useSession } from "@/lib/session-context";

export function UserMenu() {
  const router = useRouter();
  const { user, loading } = useSession();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      // Real `POST /auth/logout` (apps/api/src/routes/auth.ts) — revokes
      // this refresh token's session server-side. Best-effort: even if the
      // network call fails, local state is cleared and the user is sent to
      // `/login` regardless, since staying "logged in" client-side with a
      // token the server might have already invalidated helps no one.
      const refreshToken = getRefreshToken();
      if (refreshToken) {
        await apiClient.post("/auth/logout", { refreshToken }).catch(() => undefined);
      }
    } finally {
      clearSession();
      router.push("/login");
    }
  }

  if (loading) {
    return <Skeleton className="size-7 rounded-full" />;
  }

  const displayName = user?.name ?? "User";
  const displayEmail = user?.email ?? "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Account menu"
      >
        <Avatar fallback={getInitials(displayName)} size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="flex flex-col gap-0.5 normal-case tracking-normal">
          <span className="text-[13px] font-medium text-foreground">{displayName}</span>
          <span className="text-[12px] text-muted-foreground font-normal">{displayEmail}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/settings")}>
          <User size={14} className="mr-1" /> Profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push("/settings")}>
          <Settings size={14} className="mr-1" /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive disabled={signingOut} onSelect={handleSignOut}>
          <LogOut size={14} className="mr-1" /> {signingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
