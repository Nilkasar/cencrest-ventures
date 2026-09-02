"use client";

import { useState } from "react";
import { Users, Plus } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  useToast,
} from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { ComingSoon } from "@/components/patterns/coming-soon";

function AddCompetitorDialog() {
  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState("");
  const { toast } = useToast();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setOpen(false);
    toast({
      title: "Not wired up yet",
      description: `Competitor tracking for "${domain || "that domain"}" ships with Epic 8 (Competitive Intelligence).`,
    });
    setDomain("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary" size="sm">
          <Plus size={14} /> Add a competitor
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add a competitor</DialogTitle>
            <DialogDescription>
              We&apos;ll track how often AI assistants recommend them instead of you, and trace the gap to its
              source.
            </DialogDescription>
          </DialogHeader>
          <Input
            label="Competitor website"
            placeholder="competitor.com"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            autoFocus
          />
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm">
              Add competitor
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function CompetitorsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="Competitors"
        description="How do I compare? Competitor AI Visibility Scores, share of AI voice, and movement alerts live here."
        actions={<AddCompetitorDialog />}
      />
      <ComingSoon
        icon={<Users size={20} />}
        eyebrow="Competitors"
        title="No competitors tracked yet"
        description="Add up to 5 competitors (more on higher tiers) to see how often AI recommends them instead of you, and where each gap comes from."
        epic={8}
      />
    </>
  );
}
