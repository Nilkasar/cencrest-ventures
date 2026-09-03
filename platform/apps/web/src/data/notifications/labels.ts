import { Bot, ClipboardCheck, CreditCard, FileText, Gauge, LineChart, TrendingUp, Users } from "lucide-react";
import type { NotificationType } from "./types";

/** Display-only label/icon maps for Epic 15's `notification_type` enum —
 *  same role `data/opportunities/labels.ts` plays for that epic's enums. */

export const NOTIFICATION_TYPE_LABEL: Record<NotificationType, string> = {
  run_complete: "AI run complete",
  new_recommendations: "New recommendations",
  competitor_alert: "Competitor movement",
  score_change: "Score change",
  agent_action: "Agent action",
  report_ready: "Report ready",
  action_assigned: "Action assigned",
  billing_alert: "Billing",
  weekly_digest: "Weekly digest",
  entitlement_warning: "Usage limit",
};

export const NOTIFICATION_TYPE_ICON: Record<NotificationType, typeof Bot> = {
  run_complete: Gauge,
  new_recommendations: ClipboardCheck,
  competitor_alert: TrendingUp,
  score_change: LineChart,
  agent_action: Bot,
  report_ready: FileText,
  action_assigned: Users,
  billing_alert: CreditCard,
  weekly_digest: FileText,
  entitlement_warning: CreditCard,
};
