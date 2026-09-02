"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
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
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from "@bebest/ui";
import { createLead } from "@/data/crm/client";
import type { LeadSource } from "@/data/crm/types";

const SOURCE_LABEL: Record<LeadSource, string> = {
  direct: "Direct",
  referral: "Referral",
  apply_form: "Apply form",
  free_snapshot: "Free snapshot",
};

/** Manual lead entry — the standalone path the empty state promises before
 *  the marketing-site apply form is wired up in Epic 20. */
export function AddLeadDialog({ onCreated }: { onCreated: (leadId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [website, setWebsite] = useState("");
  const [source, setSource] = useState<LeadSource>("direct");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  function reset() {
    setName("");
    setEmail("");
    setCompany("");
    setWebsite("");
    setSource("direct");
    setNotes("");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setSubmitting(true);
    try {
      const lead = await createLead({ name: name.trim(), email: email.trim(), company: company.trim(), website: website.trim(), source, notes: notes.trim() });
      toast({ title: "Lead added", description: `${lead.name} is in the pipeline.`, variant: "success" });
      setOpen(false);
      reset();
      onCreated(lead.id);
    } catch {
      toast({ title: "Couldn't add that lead", description: "Try again in a moment.", variant: "danger" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary" size="sm">
          <UserPlus size={14} /> Add a lead
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add a lead</DialogTitle>
            <DialogDescription>
              For outreach your team has started directly — not through the free snapshot or apply form.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input label="Name" placeholder="Jane Doe" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
            <Input label="Email" type="email" placeholder="jane@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Input label="Company" placeholder="Company Inc." value={company} onChange={(e) => setCompany(e.target.value)} />
            <Input label="Website" placeholder="company.com" value={website} onChange={(e) => setWebsite(e.target.value)} />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-source">Source</Label>
              <Select value={source} onValueChange={(value) => setSource(value as LeadSource)}>
                <SelectTrigger id="lead-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SOURCE_LABEL) as LeadSource[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {SOURCE_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={submitting} disabled={!name.trim() || !email.trim()}>
              Add lead
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
