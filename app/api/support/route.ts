import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getOrgId } from "@/lib/org-context";
import { sendNotificationEmail } from "@/lib/email";
import { reportError } from "@/lib/monitoring";
import { auditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

const CATEGORY_LABELS: Record<string, string> = {
  bug: "Bug Report",
  feature_request: "Feature Request",
  access_issue: "Access Issue",
  data_question: "Data Question",
  general: "General",
};

const VALID_CATEGORIES = ["bug", "feature_request", "access_issue", "data_question", "general"];
const VALID_PRIORITIES = ["low", "medium", "high"];

function generateTicketNumber(): string {
  const now = new Date();
  const y = now.getFullYear().toString().slice(2);
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const seq = Math.floor(Math.random() * 9000 + 1000);
  return `PRV-${y}${m}-${seq}`;
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { subject, category, priority, description } = body as {
      subject?: string;
      category?: string;
      priority?: string;
      description?: string;
    };

    if (!subject?.trim() || !category || !description?.trim()) {
      return NextResponse.json({ error: "Subject, category, and description are required" }, { status: 400 });
    }

    if (!VALID_CATEGORIES.includes(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }

    const effectivePriority = VALID_PRIORITIES.includes(priority ?? "") ? priority! : "medium";
    const ticketNumber = generateTicketNumber();
    const orgId = getOrgId(user);
    const categoryLabel = CATEGORY_LABELS[category] || category;

    // Insert into audit log (support tickets are audit-worthy events)
    await auditLog({
      organizationId: orgId,
      entityType: "support",
      entityId: 0,
      action: "support_ticket_created",
      newValue: JSON.stringify({
        ticketNumber,
        subject: subject.trim(),
        category,
        priority: effectivePriority,
      }),
      actorEmail: user.email ?? user.username,
    });

    // Send email to support@provisum.io
    const priorityBadge =
      effectivePriority === "high" ? "HIGH" : effectivePriority === "low" ? "Low" : "Medium";

    sendNotificationEmail(
      "support@provisum.io",
      `[${ticketNumber}] ${subject.trim()} — ${categoryLabel}`,
      `
<h3>New Support Ticket (In-App)</h3>
<table style="width:100%;border-collapse:collapse;font-size:14px;">
  <tr><td style="padding:6px 10px;font-weight:600;color:#6b7280;width:120px;">Ticket</td><td style="padding:6px 10px;">${ticketNumber}</td></tr>
  <tr style="background:#f9fafb;"><td style="padding:6px 10px;font-weight:600;color:#6b7280;">User</td><td style="padding:6px 10px;">${user.displayName} (${user.email})</td></tr>
  <tr><td style="padding:6px 10px;font-weight:600;color:#6b7280;">Role</td><td style="padding:6px 10px;">${user.role}</td></tr>
  <tr style="background:#f9fafb;"><td style="padding:6px 10px;font-weight:600;color:#6b7280;">Category</td><td style="padding:6px 10px;">${categoryLabel}</td></tr>
  <tr><td style="padding:6px 10px;font-weight:600;color:#6b7280;">Priority</td><td style="padding:6px 10px;">${priorityBadge}</td></tr>
  <tr style="background:#f9fafb;"><td style="padding:6px 10px;font-weight:600;color:#6b7280;">Subject</td><td style="padding:6px 10px;font-weight:500;">${subject.trim()}</td></tr>
</table>
<div style="margin-top:12px;padding:12px;background:#f9fafb;border-radius:6px;border:1px solid #e5e7eb;">
  <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;">Description</p>
  <p style="margin:0;font-size:14px;line-height:1.6;white-space:pre-wrap;">${description.trim()}</p>
</div>
      `.trim(),
    ).catch(() => {
      // Email is best-effort
    });

    return NextResponse.json({ success: true, ticketNumber });
  } catch (error) {
    reportError(error instanceof Error ? error : new Error(String(error)), { context: "support" });
    return NextResponse.json(
      { error: "Failed to submit ticket" },
      { status: 500 }
    );
  }
}
