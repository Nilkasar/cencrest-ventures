"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  useToast,
} from "@bebest/ui";
import { convertLead } from "@/data/crm/client";
import type { Lead } from "@/data/crm/types";

/**
 * Mirrors the real `POST /leads/:id/convert` contract: creates a tenant
 * organization, links it back to the lead, and preserves the lead's
 * existing activity history rather than deleting the record.
 */
export function ConvertLeadDialog({ lead, onConverted }: { lead: Lead; onConverted: (accountId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  async function handleConfirm() {
    setSubmitting(true);
    try {
      const { account } = await convertLead(lead.id);
      toast({ title: "Converted", description: `${account.name} is now an account.`, variant: "success" });
      setOpen(false);
      onConverted(account.id);
    } catch {
      toast({ title: "Couldn't convert this lead", description: "Try again in a moment.", variant: "danger" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary" size="sm">
          Convert to account <ArrowRight size={14} />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert {lead.name} to an account</DialogTitle>
          <DialogDescription>
            Creates <strong className="text-foreground">{lead.company ?? lead.name}</strong> as a customer
            organization and links this lead to it. Every activity logged here stays on the record — nothing is
            deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" variant="primary" size="sm" loading={submitting} onClick={handleConfirm}>
            Convert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
