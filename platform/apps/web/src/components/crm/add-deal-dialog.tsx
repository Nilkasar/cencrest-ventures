"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  useToast,
} from "@bebest/ui";
import { createDeal, fetchAccounts, fetchCrmUsers, fetchLeads } from "@/data/crm/client";
import { DEAL_STAGE_LABEL, DEAL_STAGE_SEQUENCE, type Account, type CrmUserRef, type DealStage, type Lead } from "@/data/crm/types";

const NONE = "none";

export function AddDealDialog({ onCreated }: { onCreated: (dealId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [linkTo, setLinkTo] = useState(NONE);
  const [value, setValue] = useState("");
  const [stage, setStage] = useState<DealStage>("new");
  const [probability, setProbability] = useState("20");
  const [closeDate, setCloseDate] = useState("");
  const [ownerId, setOwnerId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [owners, setOwners] = useState<CrmUserRef[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    // Only leads that can still take a new deal. Asking the API for the
    // two statuses to exclude isn't expressible, so this filters the page
    // it gets — acceptable for a picker, which shows a bounded list anyway.
    fetchLeads({ limit: 100 }).then((page) =>
      setLeads(page.items.filter((l) => l.status !== "converted" && l.status !== "lost")),
    );
    fetchAccounts({ limit: 100 }).then((page) => setAccounts(page.items));
    fetchCrmUsers().then((all) => {
      setOwners(all);
      setOwnerId((current) => current || all[0]?.id || "");
    });
  }, [open]);

  function reset() {
    setTitle("");
    setLinkTo(NONE);
    setValue("");
    setStage("new");
    setProbability("20");
    setCloseDate("");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const cents = Math.round(Number(value) * 100);
    if (!title.trim() || !Number.isFinite(cents) || cents <= 0 || !ownerId) return;

    setSubmitting(true);
    try {
      const [linkKind, linkId] = linkTo === NONE ? [null, null] : linkTo.split(":");
      const deal = await createDeal({
        title: title.trim(),
        leadId: linkKind === "lead" ? (linkId ?? null) : null,
        organizationId: linkKind === "account" ? (linkId ?? null) : null,
        valueCents: cents,
        stage,
        probability: Math.min(100, Math.max(0, Number(probability) || 0)),
        expectedCloseDate: closeDate || null,
        ownerId,
      });
      toast({ title: "Deal created", description: deal.title, variant: "success" });
      setOpen(false);
      reset();
      onCreated(deal.id);
    } catch {
      toast({ title: "Couldn't create that deal", description: "Try again in a moment.", variant: "danger" });
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
          <Plus size={14} /> Add a deal
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add a deal</DialogTitle>
            <DialogDescription>Track a Diagnostic, Full Rebuild, or Continuous engagement through the pipeline.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input label="Title" placeholder="e.g. Diagnostic — Acme Corp" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="deal-link">Link to</Label>
              <Select value={linkTo} onValueChange={setLinkTo}>
                <SelectTrigger id="deal-link">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not linked</SelectItem>
                  {leads.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Leads</SelectLabel>
                      {leads.map((lead) => (
                        <SelectItem key={lead.id} value={`lead:${lead.id}`}>
                          {lead.company ?? lead.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {accounts.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Accounts</SelectLabel>
                      {accounts.map((account) => (
                        <SelectItem key={account.id} value={`account:${account.id}`}>
                          {account.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input label="Value (USD)" type="number" min={0} step={100} placeholder="24000" value={value} onChange={(e) => setValue(e.target.value)} required />
              <Input label="Probability (%)" type="number" min={0} max={100} value={probability} onChange={(e) => setProbability(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="deal-stage">Stage</Label>
                <Select value={stage} onValueChange={(v) => setStage(v as DealStage)}>
                  <SelectTrigger id="deal-stage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEAL_STAGE_SEQUENCE.map((s) => (
                      <SelectItem key={s} value={s}>
                        {DEAL_STAGE_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input label="Expected close" type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="deal-owner">Owner</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger id="deal-owner">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {owners.map((owner) => (
                    <SelectItem key={owner.id} value={owner.id}>
                      {owner.name}
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
            <Button type="submit" variant="primary" size="sm" loading={submitting} disabled={!title.trim() || !value}>
              Add deal
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
