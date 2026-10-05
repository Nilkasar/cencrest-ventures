"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { Button, EmptyState } from "@bebest/ui";
import { PageStack, Reveal } from "@/components/patterns/motion";

/**
 * Settings > Notifications. There is no preferences endpoint in this app's
 * data layer yet (the per-channel preference API is being built in a
 * separate change), so this tab says so plainly instead of rendering
 * controls that wouldn't save anything.
 */
export function NotificationsPanel() {
  return (
    <PageStack>
      <Reveal>
        <EmptyState
          icon={<Bell size={20} />}
          title="Notification preferences aren't configurable yet"
          description="Alerts such as completed runs and competitor movement show up in the activity feed on your Overview. Per-channel email and in-app preferences will be managed here."
          action={
            <Button variant="secondary" size="sm" asChild>
              <Link href="/overview">Open Overview</Link>
            </Button>
          }
        />
      </Reveal>
    </PageStack>
  );
}
