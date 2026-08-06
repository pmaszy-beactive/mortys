import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign, Plus, RefreshCw, Download, FileText, History, Send, Ban,
  CreditCard, Users, Receipt, BarChart3, Pencil, Trash2, ExternalLink,
} from "lucide-react";
import Sidebar from "@/components/sidebar";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { format, subDays } from "date-fns";

// ---------------- Types ----------------

interface PricingItem {
  id: number;
  name: string;
  code: string;
  itemType: string;
  amount: string;
  gstApplicable: boolean;
  qstApplicable: boolean;
  lessonPackageId: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isActive: boolean;
  description: string | null;
}

interface BillingCustomer {
  id: number;
  studentId: number;
  stripeCustomerId: string | null;
  billingName: string | null;
  billingEmail: string | null;
  billingPhone: string | null;
  billingAddress: string | null;
  notes: string | null;
  syncStatus: string;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  firstName: string;
  lastName: string;
  studentEmail: string;
}

interface InvoiceRow {
  id: number;
  studentId: number;
  studentName: string;
  invoiceNumber: string;
  amount: string;
  subtotal: string | null;
  gst: string | null;
  qst: string | null;
  status: string;
  description: string;
  dueDate: string | null;
  submissionMethod: string | null;
  failureReason: string | null;
  createdAt: string | null;
}

interface ReportData {
  startDate: string;
  endDate: string;
  revenue: number;
  refunds: number;
  netRevenue: number;
  paymentCount: number;
  invoicesPaid: number;
  invoicesPaidAmount: number;
  outstandingCount: number;
  outstandingAmount: number;
  failedCount: number;
  failedAmount: number;
  aging: { current: number; days31to60: number; days61to90: number; over90: number };
  agingAmounts: { current: number; days31to60: number; days61to90: number; over90: number };
}

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  submitted: "bg-blue-100 text-blue-800",
  charging: "bg-purple-100 text-purple-800",
  paid: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  void: "bg-gray-200 text-gray-500",
  unpaid: "bg-yellow-100 text-yellow-800",
  overdue: "bg-orange-100 text-orange-800",
  cancelled: "bg-gray-200 text-gray-500",
  pending: "bg-yellow-100 text-yellow-800",
  synced: "bg-green-100 text-green-800",
  error: "bg-red-100 text-red-800",
};

function StatusBadge({ status }: { status: string }) {
  return <Badge className={statusColors[status] || "bg-gray-100 text-gray-700"} data-testid={`badge-status-${status}`}>{status}</Badge>;
}

// ---------------- Pricing tab ----------------

const emptyItem = { name: "", code: "", itemType: "fee", amount: "", gstApplicable: true, qstApplicable: true, lessonPackageId: "", effectiveFrom: "", effectiveTo: "", description: "" };

function PricingTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PricingItem | null>(null);
  const [form, setForm] = useState<any>(emptyItem);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [gstRate, setGstRate] = useState<string>("");
  const [qstRate, setQstRate] = useState<string>("");

  const { data: items = [], isLoading } = useQuery<PricingItem[]>({ queryKey: ["/api/admin/billing/pricing"] });
  const { data: rates } = useQuery<{ gstRate: number; qstRate: number }>({ queryKey: ["/api/admin/billing/tax-rates"] });
  const { data: packages = [] } = useQuery<any[]>({ queryKey: ["/api/admin/billing/lesson-packages"] });
  const { data: history = [] } = useQuery<any[]>({ queryKey: ["/api/admin/billing/pricing-history"], enabled: historyOpen });

  const saveRates = useMutation({
    mutationFn: async () => apiRequest("PUT", "/api/admin/billing/tax-rates", {
      ...(gstRate !== "" ? { gstRate: parseFloat(gstRate) } : {}),
      ...(qstRate !== "" ? { qstRate: parseFloat(qstRate) } : {}),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/billing/tax-rates"] });
      toast({ title: "Tax rates updated" });
      setGstRate(""); setQstRate("");
    },
    onError: (e: any) => toast({ title: "Failed to update tax rates", description: e.message, variant: "destructive" }),
  });

  const saveItem = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name,
        code: form.code,
        itemType: form.itemType,
        amount: form.amount,
        gstApplicable: !!form.gstApplicable,
        qstApplicable: !!form.qstApplicable,
        lessonPackageId: form.lessonPackageId ? parseInt(form.lessonPackageId) : null,
        effectiveFrom: form.effectiveFrom || null,
        effectiveTo: form.effectiveTo || null,
        description: form.description || null,
      };
      return editing
        ? apiRequest("PUT", `/api/admin/billing/pricing/${editing.id}`, body)
        : apiRequest("POST", "/api/admin/billing/pricing", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/billing/pricing"] });
      toast({ title: editing ? "Pricing item updated" : "Pricing item created" });
      setDialogOpen(false);
    },
    onError: (e: any) => toast({ title: "Failed to save pricing item", description: e.message, variant: "destructive" }),
  });

  const toggleActive = useMutation({
    mutationFn: async (item: PricingItem) => apiRequest("PUT", `/api/admin/billing/pricing/${item.id}`, { isActive: !item.isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/billing/pricing"] }),
    onError: (e: any) => toast({ title: "Failed to update", description: e.message, variant: "destructive" }),
  });

  const openCreate = () => { setEditing(null); setForm(emptyItem); setDialogOpen(true); };
  const openEdit = (item: PricingItem) => {
    setEditing(item);
    setForm({ ...item, lessonPackageId: item.lessonPackageId ? String(item.lessonPackageId) : "", effectiveFrom: item.effectiveFrom || "", effectiveTo: item.effectiveTo || "", description: item.description || "" });
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Tax Rates</CardTitle>
          <CardDescription>Applied to taxable items at invoice/checkout time. Current: GST {rates?.gstRate ?? "…"}% · QST {rates?.qstRate ?? "…"}%</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label htmlFor="gst-rate">GST %</Label>
            <Input id="gst-rate" type="number" step="0.001" className="w-32" placeholder={String(rates?.gstRate ?? "")} value={gstRate} onChange={(e) => setGstRate(e.target.value)} data-testid="input-gst-rate" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="qst-rate">QST %</Label>
            <Input id="qst-rate" type="number" step="0.001" className="w-32" placeholder={String(rates?.qstRate ?? "")} value={qstRate} onChange={(e) => setQstRate(e.target.value)} data-testid="input-qst-rate" />
          </div>
          <Button onClick={() => saveRates.mutate()} disabled={saveRates.isPending || (gstRate === "" && qstRate === "")} className="bg-[#ECC462] text-[#111111] hover:bg-[#dbb655]" data-testid="button-save-tax-rates">
            Save Rates
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Pricing Items</CardTitle>
            <CardDescription>Course packages, lessons, and fees — checkout and invoicing read from this catalog</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setHistoryOpen(true)} data-testid="button-pricing-history">
              <History className="w-4 h-4 mr-2" /> Change History
            </Button>
            <Button onClick={openCreate} className="bg-[#ECC462] text-[#111111] hover:bg-[#dbb655]" data-testid="button-add-pricing-item">
              <Plus className="w-4 h-4 mr-2" /> New Price
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Taxes</TableHead>
                <TableHead>Effective</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
              ) : items.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-500">No pricing items yet — create your first price.</TableCell></TableRow>
              ) : items.map((item) => (
                <TableRow key={item.id} data-testid={`row-pricing-${item.id}`}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell><code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{item.code}</code></TableCell>
                  <TableCell className="capitalize">{item.itemType.replace("_", " ")}</TableCell>
                  <TableCell className="text-right font-mono">${parseFloat(item.amount).toFixed(2)}</TableCell>
                  <TableCell className="text-xs text-gray-600">{[item.gstApplicable && "GST", item.qstApplicable && "QST"].filter(Boolean).join(" + ") || "None"}</TableCell>
                  <TableCell className="text-xs text-gray-600">{item.effectiveFrom || "now"} → {item.effectiveTo || "open"}</TableCell>
                  <TableCell><StatusBadge status={item.isActive ? "synced" : "void"} /></TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(item)} data-testid={`button-edit-pricing-${item.id}`}><Pencil className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleActive.mutate(item)} data-testid={`button-toggle-pricing-${item.id}`}>
                      {item.isActive ? <Ban className="w-4 h-4 text-red-500" /> : <RefreshCw className="w-4 h-4 text-green-600" />}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Pricing Item" : "New Pricing Item"}</DialogTitle>
            <DialogDescription>All amounts are in CAD; nothing is priced in Stripe.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1 col-span-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-pricing-name" />
            </div>
            <div className="space-y-1">
              <Label>Code</Label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. fee:late-cancel" data-testid="input-pricing-code" />
            </div>
            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={form.itemType} onValueChange={(v) => setForm({ ...form, itemType: v })}>
                <SelectTrigger data-testid="select-pricing-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="course_package">Course Package</SelectItem>
                  <SelectItem value="lesson">Lesson</SelectItem>
                  <SelectItem value="fee">Fee</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Amount (CAD)</Label>
              <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="input-pricing-amount" />
            </div>
            <div className="space-y-1">
              <Label>Linked Package (price override)</Label>
              <Select value={form.lessonPackageId || "none"} onValueChange={(v) => setForm({ ...form, lessonPackageId: v === "none" ? "" : v })}>
                <SelectTrigger data-testid="select-pricing-package"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {packages.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Effective From</Label>
              <Input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} data-testid="input-pricing-from" />
            </div>
            <div className="space-y-1">
              <Label>Effective To</Label>
              <Input type="date" value={form.effectiveTo} onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })} data-testid="input-pricing-to" />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox checked={!!form.gstApplicable} onCheckedChange={(v) => setForm({ ...form, gstApplicable: !!v })} id="gst-app" />
              <Label htmlFor="gst-app">GST applies</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox checked={!!form.qstApplicable} onCheckedChange={(v) => setForm({ ...form, qstApplicable: !!v })} id="qst-app" />
              <Label htmlFor="qst-app">QST applies</Label>
            </div>
            <div className="space-y-1 col-span-2">
              <Label>Description</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <Button onClick={() => saveItem.mutate()} disabled={saveItem.isPending || !form.name || !form.code || !form.amount} className="w-full bg-[#ECC462] text-[#111111] hover:bg-[#dbb655]" data-testid="button-save-pricing-item">
            {saveItem.isPending ? "Saving…" : editing ? "Save Changes" : "Create Pricing Item"}
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pricing Change History</DialogTitle>
            <DialogDescription>Audit of pricing and tax-rate changes</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {history.length === 0 && <p className="text-sm text-gray-500">No changes recorded yet.</p>}
            {history.map((h: any) => (
              <div key={h.id} className="border rounded-md p-3 text-sm" data-testid={`row-pricing-history-${h.id}`}>
                <div className="flex justify-between">
                  <span className="font-medium">{h.itemName || h.settingKey || "—"} <Badge variant="secondary" className="ml-1">{h.action}</Badge></span>
                  <span className="text-xs text-gray-500">{h.createdAt ? format(new Date(h.createdAt), "yyyy-MM-dd HH:mm") : ""}{h.changedByEmail ? ` · ${h.changedByEmail}` : ""}</span>
                </div>
                {h.before && h.after && (
                  <p className="text-xs text-gray-600 mt-1">
                    {h.before.amount !== undefined && h.after.amount !== undefined && h.before.amount !== h.after.amount
                      ? `Amount: $${h.before.amount} → $${h.after.amount}`
                      : h.settingKey === "taxRates"
                        ? `GST ${h.before.gstRate}% → ${h.after.gstRate}%, QST ${h.before.qstRate}% → ${h.after.qstRate}%`
                        : "Details updated"}
                  </p>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------- Customers tab ----------------

function CustomersTab() {
  const { toast } = useToast();
  const [editing, setEditing] = useState<BillingCustomer | null>(null);
  const [form, setForm] = useState<any>({});

  const { data: customers = [], isLoading } = useQuery<BillingCustomer[]>({
    queryKey: ["/api/admin/billing/customers"],
    refetchInterval: 10000,
  });

  const syncAll = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/admin/billing/customers/sync-all"),
    onSuccess: () => toast({ title: "Bulk sync job enqueued", description: "Watch progress in Job Control. Billing jobs may be held after a restart." }),
    onError: (e: any) => toast({ title: "Failed to enqueue sync", description: e.message, variant: "destructive" }),
  });

  const syncOne = useMutation({
    mutationFn: async (studentId: number) => apiRequest("POST", `/api/admin/billing/customers/${studentId}/sync`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/billing/customers"] });
      toast({ title: "Customer sync job enqueued" });
    },
    onError: (e: any) => toast({ title: "Failed to enqueue sync", description: e.message, variant: "destructive" }),
  });

  const saveCustomer = useMutation({
    mutationFn: async () => apiRequest("PUT", `/api/admin/billing/customers/${editing!.id}`, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/billing/customers"] });
      toast({ title: "Billing details updated", description: "A sync job was enqueued to update Stripe." });
      setEditing(null);
    },
    onError: (e: any) => toast({ title: "Failed to update", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg">Billing Customers</CardTitle>
          <CardDescription>Students with billing activity, linked to Stripe customers via queued sync jobs</CardDescription>
        </div>
        <div className="flex gap-2">
          <Link href="/job-control"><Button variant="outline" data-testid="link-job-control"><ExternalLink className="w-4 h-4 mr-2" />Job Control</Button></Link>
          <Button onClick={() => syncAll.mutate()} disabled={syncAll.isPending} className="bg-[#ECC462] text-[#111111] hover:bg-[#dbb655]" data-testid="button-sync-all-customers">
            <RefreshCw className="w-4 h-4 mr-2" /> Sync All Customers
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Billing Email</TableHead>
              <TableHead>Stripe Customer</TableHead>
              <TableHead>Sync</TableHead>
              <TableHead>Last Synced</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
            ) : customers.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-gray-500">No billing customers yet — run "Sync All Customers" to create records for students with billing activity.</TableCell></TableRow>
            ) : customers.map((c) => (
              <TableRow key={c.id} data-testid={`row-customer-${c.id}`}>
                <TableCell className="font-medium">{c.billingName || `${c.firstName} ${c.lastName}`}<div className="text-xs text-gray-500">#{c.studentId}</div></TableCell>
                <TableCell>{c.billingEmail || c.studentEmail}</TableCell>
                <TableCell>{c.stripeCustomerId ? <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{c.stripeCustomerId}</code> : <span className="text-gray-400">—</span>}</TableCell>
                <TableCell>
                  <StatusBadge status={c.syncStatus} />
                  {c.syncStatus === "error" && c.lastSyncError && <div className="text-xs text-red-600 mt-1 max-w-[200px] truncate" title={c.lastSyncError}>{c.lastSyncError}</div>}
                </TableCell>
                <TableCell className="text-xs text-gray-600">{c.lastSyncedAt ? format(new Date(c.lastSyncedAt), "yyyy-MM-dd HH:mm") : "never"}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button variant="ghost" size="sm" onClick={() => { setEditing(c); setForm({ billingName: c.billingName || "", billingEmail: c.billingEmail || "", billingPhone: c.billingPhone || "", billingAddress: c.billingAddress || "", notes: c.notes || "" }); }} data-testid={`button-edit-customer-${c.id}`}><Pencil className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => syncOne.mutate(c.studentId)} data-testid={`button-sync-customer-${c.id}`}><RefreshCw className="w-4 h-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Billing Details</DialogTitle>
            <DialogDescription>{editing && `${editing.firstName} ${editing.lastName} (#${editing.studentId})`}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {(["billingName", "billingEmail", "billingPhone", "billingAddress"] as const).map((key) => (
              <div key={key} className="space-y-1">
                <Label className="capitalize">{key.replace("billing", "Billing ")}</Label>
                <Input value={form[key] || ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })} data-testid={`input-${key}`} />
              </div>
            ))}
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <Button onClick={() => saveCustomer.mutate()} disabled={saveCustomer.isPending} className="w-full bg-[#ECC462] text-[#111111] hover:bg-[#dbb655]" data-testid="button-save-customer">
              {saveCustomer.isPending ? "Saving…" : "Save & Sync to Stripe"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------- Invoices tab ----------------

type LineItemForm = { description: string; quantity: string; unitAmount: string; gstApplicable: boolean; qstApplicable: boolean; pricingItemId?: number | null };

function InvoicesTab() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItemForm[]>([{ description: "", quantity: "1", unitAmount: "", gstApplicable: true, qstApplicable: true }]);

  const { data: invoices = [], isLoading } = useQuery<InvoiceRow[]>({
    queryKey: ["/api/admin/billing/invoices", statusFilter],
    queryFn: async () => {
      const r = await fetch(`/api/admin/billing/invoices?status=${statusFilter}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch invoices");
      return r.json();
    },
    refetchInterval: 10000,
  });
  const { data: pricing = [] } = useQuery<PricingItem[]>({ queryKey: ["/api/admin/billing/pricing"] });
  const { data: rates } = useQuery<{ gstRate: number; qstRate: number }>({ queryKey: ["/api/admin/billing/tax-rates"] });

  const createInvoice = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/admin/billing/invoices", {
      studentId: parseInt(studentId),
      dueDate: dueDate || null,
      notes: notes || null,
      lineItems: lineItems.filter((li) => li.description && li.unitAmount).map((li) => ({
        description: li.description,
        quantity: parseInt(li.quantity) || 1,
        unitAmount: li.unitAmount,
        amount: "0",
        gstApplicable: li.gstApplicable,
        qstApplicable: li.qstApplicable,
        pricingItemId: li.pricingItemId ?? null,
      })),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/billing/invoices"] });
      toast({ title: "Draft invoice created" });
      setCreateOpen(false);
      setStudentId(""); setDueDate(""); setNotes("");
      setLineItems([{ description: "", quantity: "1", unitAmount: "", gstApplicable: true, qstApplicable: true }]);
    },
    onError: (e: any) => toast({ title: "Failed to create invoice", description: e.message, variant: "destructive" }),
  });

  const submitInvoice = useMutation({
    mutationFn: async ({ id, method }: { id: number; method: string }) => apiRequest("POST", `/api/admin/billing/invoices/${id}/submit`, { method }),
    onSuccess: (_d, v) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/billing/invoices"] });
      toast({ title: "Submission job enqueued", description: v.method === "email" ? "A branded invoice email will be sent." : "The saved card will be charged off-session. Watch Job Control." });
    },
    onError: (e: any) => toast({ title: "Failed to submit", description: e.message, variant: "destructive" }),
  });

  const voidInvoice = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/admin/billing/invoices/${id}/void`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/billing/invoices"] });
      toast({ title: "Invoice voided" });
    },
    onError: (e: any) => toast({ title: "Failed to void", description: e.message, variant: "destructive" }),
  });

  const applyPricingItem = (idx: number, itemId: string) => {
    const item = pricing.find((p) => p.id === parseInt(itemId));
    if (!item) return;
    setLineItems(lineItems.map((li, i) => i === idx ? {
      description: item.name,
      quantity: li.quantity || "1",
      unitAmount: item.amount,
      gstApplicable: item.gstApplicable,
      qstApplicable: item.qstApplicable,
      pricingItemId: item.id,
    } : li));
  };

  const previewTotals = (() => {
    const g = (rates?.gstRate ?? 5) / 100, q = (rates?.qstRate ?? 9.975) / 100;
    let sub = 0, gst = 0, qst = 0;
    for (const li of lineItems) {
      const amt = (parseInt(li.quantity) || 0) * (parseFloat(li.unitAmount) || 0);
      sub += amt;
      if (li.gstApplicable) gst += amt * g;
      if (li.qstApplicable) qst += amt * q;
    }
    return { sub, gst, qst, total: sub + gst + qst };
  })();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg">Invoices</CardTitle>
          <CardDescription>draft → submitted → paid / failed / void. Submission runs as a queued billing job.</CardDescription>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36" data-testid="select-invoice-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["all", "draft", "submitted", "paid", "failed", "void", "unpaid", "overdue"].map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => setCreateOpen(true)} className="bg-[#ECC462] text-[#111111] hover:bg-[#dbb655]" data-testid="button-create-invoice">
            <Plus className="w-4 h-4 mr-2" /> New Invoice
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Student</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
            ) : invoices.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-500">No invoices found.</TableCell></TableRow>
            ) : invoices.map((inv) => (
              <TableRow key={inv.id} data-testid={`row-invoice-${inv.id}`}>
                <TableCell className="font-mono text-xs">{inv.invoiceNumber}</TableCell>
                <TableCell>{inv.studentName}</TableCell>
                <TableCell className="max-w-[240px] truncate" title={inv.description}>{inv.description}
                  {inv.status === "failed" && inv.failureReason && <div className="text-xs text-red-600 truncate" title={inv.failureReason}>{inv.failureReason}</div>}
                </TableCell>
                <TableCell className="text-right font-mono">${parseFloat(inv.amount).toFixed(2)}</TableCell>
                <TableCell className="text-xs">{inv.dueDate || "—"}</TableCell>
                <TableCell><StatusBadge status={inv.status} /></TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {["draft", "failed", "unpaid", "overdue"].includes(inv.status) && (
                    <>
                      <Button variant="ghost" size="sm" title="Charge saved card" onClick={() => submitInvoice.mutate({ id: inv.id, method: "charge_card" })} data-testid={`button-charge-invoice-${inv.id}`}>
                        <CreditCard className="w-4 h-4 text-green-600" />
                      </Button>
                      <Button variant="ghost" size="sm" title="Email invoice with pay link" onClick={() => submitInvoice.mutate({ id: inv.id, method: "email" })} data-testid={`button-email-invoice-${inv.id}`}>
                        <Send className="w-4 h-4 text-blue-600" />
                      </Button>
                    </>
                  )}
                  {!["paid", "void", "cancelled"].includes(inv.status) && (
                    <Button variant="ghost" size="sm" title="Void invoice" onClick={() => voidInvoice.mutate(inv.id)} data-testid={`button-void-invoice-${inv.id}`}>
                      <Ban className="w-4 h-4 text-red-500" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Invoice</DialogTitle>
            <DialogDescription>Creates a draft — submit it afterwards to charge or email the student.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Student ID</Label>
                <Input type="number" value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder="e.g. 42" data-testid="input-invoice-student" />
              </div>
              <div className="space-y-1">
                <Label>Due Date</Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} data-testid="input-invoice-due" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Line Items</Label>
              {lineItems.map((li, idx) => (
                <div key={idx} className="border rounded-md p-3 space-y-2" data-testid={`line-item-${idx}`}>
                  <div className="flex gap-2">
                    <Select onValueChange={(v) => applyPricingItem(idx, v)}>
                      <SelectTrigger className="w-52" data-testid={`select-line-pricing-${idx}`}><SelectValue placeholder="From pricing catalog…" /></SelectTrigger>
                      <SelectContent>
                        {pricing.filter((p) => p.isActive).map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name} (${parseFloat(p.amount).toFixed(2)})</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input className="flex-1" placeholder="Description" value={li.description} onChange={(e) => setLineItems(lineItems.map((x, i) => i === idx ? { ...x, description: e.target.value, pricingItemId: null } : x))} data-testid={`input-line-desc-${idx}`} />
                    {lineItems.length > 1 && (
                      <Button variant="ghost" size="sm" onClick={() => setLineItems(lineItems.filter((_, i) => i !== idx))}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                    )}
                  </div>
                  <div className="flex gap-4 items-center">
                    <div className="flex items-center gap-1"><Label className="text-xs">Qty</Label><Input type="number" min={1} className="w-20" value={li.quantity} onChange={(e) => setLineItems(lineItems.map((x, i) => i === idx ? { ...x, quantity: e.target.value } : x))} data-testid={`input-line-qty-${idx}`} /></div>
                    <div className="flex items-center gap-1"><Label className="text-xs">Unit $</Label><Input type="number" step="0.01" className="w-28" value={li.unitAmount} onChange={(e) => setLineItems(lineItems.map((x, i) => i === idx ? { ...x, unitAmount: e.target.value } : x))} data-testid={`input-line-unit-${idx}`} /></div>
                    <label className="flex items-center gap-1 text-xs"><Checkbox checked={li.gstApplicable} onCheckedChange={(v) => setLineItems(lineItems.map((x, i) => i === idx ? { ...x, gstApplicable: !!v } : x))} /> GST</label>
                    <label className="flex items-center gap-1 text-xs"><Checkbox checked={li.qstApplicable} onCheckedChange={(v) => setLineItems(lineItems.map((x, i) => i === idx ? { ...x, qstApplicable: !!v } : x))} /> QST</label>
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setLineItems([...lineItems, { description: "", quantity: "1", unitAmount: "", gstApplicable: true, qstApplicable: true }])} data-testid="button-add-line-item">
                <Plus className="w-4 h-4 mr-1" /> Add Line
              </Button>
            </div>
            <div className="text-right text-sm space-y-0.5 text-gray-700">
              <p>Subtotal: <span className="font-mono">${previewTotals.sub.toFixed(2)}</span></p>
              <p>GST ({rates?.gstRate ?? 5}%): <span className="font-mono">${previewTotals.gst.toFixed(2)}</span> · QST ({rates?.qstRate ?? 9.975}%): <span className="font-mono">${previewTotals.qst.toFixed(2)}</span></p>
              <p className="font-bold">Total: <span className="font-mono">${previewTotals.total.toFixed(2)}</span></p>
            </div>
            <div className="space-y-1">
              <Label>Notes (internal)</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <Button onClick={() => createInvoice.mutate()} disabled={createInvoice.isPending || !studentId || !lineItems.some((li) => li.description && li.unitAmount)} className="w-full bg-[#ECC462] text-[#111111] hover:bg-[#dbb655]" data-testid="button-save-invoice">
              {createInvoice.isPending ? "Creating…" : "Create Draft Invoice"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------- Reports tab ----------------

function ReportsTab() {
  const { toast } = useToast();
  const today = format(new Date(), "yyyy-MM-dd");
  const [range, setRange] = useState({ start: format(subDays(new Date(), 30), "yyyy-MM-dd"), end: today });

  const { data: report, isLoading } = useQuery<ReportData>({
    queryKey: ["/api/admin/billing/report", range.start, range.end],
    queryFn: async () => {
      const r = await fetch(`/api/admin/billing/report?startDate=${range.start}&endDate=${range.end}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch report");
      return r.json();
    },
  });

  const enqueueReport = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/admin/billing/report-job", { startDate: range.start, endDate: range.end }),
    onSuccess: () => toast({ title: "Report job enqueued", description: "The full report output will appear in Job Control." }),
    onError: (e: any) => toast({ title: "Failed to enqueue report", description: e.message, variant: "destructive" }),
  });

  const stat = (label: string, value: string, sub?: string, color = "text-gray-900") => (
    <Card><CardHeader className="pb-2"><CardDescription>{label}</CardDescription></CardHeader>
      <CardContent>{isLoading ? <Skeleton className="h-8 w-24" /> : <><p className={`text-2xl font-bold ${color}`}>{value}</p>{sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}</>}</CardContent></Card>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6 flex flex-wrap items-end gap-4">
          <div className="space-y-1"><Label>Start</Label><Input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} data-testid="input-report-start" /></div>
          <div className="space-y-1"><Label>End</Label><Input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} data-testid="input-report-end" /></div>
          <a href={`/api/admin/billing/report.csv?startDate=${range.start}&endDate=${range.end}`} download>
            <Button variant="outline" data-testid="button-export-report-csv"><Download className="w-4 h-4 mr-2" /> Export CSV</Button>
          </a>
          <Button onClick={() => enqueueReport.mutate()} disabled={enqueueReport.isPending} className="bg-[#ECC462] text-[#111111] hover:bg-[#dbb655]" data-testid="button-report-job">
            <BarChart3 className="w-4 h-4 mr-2" /> Generate via Job Queue
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stat("Revenue", `$${(report?.revenue ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, `${report?.paymentCount ?? 0} payments`, "text-green-600")}
        {stat("Net Revenue", `$${(report?.netRevenue ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, `refunds $${(report?.refunds ?? 0).toFixed(2)}`, "text-blue-600")}
        {stat("Outstanding", `$${(report?.outstandingAmount ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, `${report?.outstandingCount ?? 0} invoices`, "text-orange-600")}
        {stat("Failed Charges", `$${(report?.failedAmount ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, `${report?.failedCount ?? 0} invoices`, "text-red-600")}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">Invoice Aging</CardTitle><CardDescription>Outstanding invoices by age (due date, or created date when no due date)</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Bucket</TableHead><TableHead className="text-right">Invoices</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>
              {([["0–30 days", "current"], ["31–60 days", "days31to60"], ["61–90 days", "days61to90"], ["90+ days", "over90"]] as const).map(([label, key]) => (
                <TableRow key={key} data-testid={`row-aging-${key}`}>
                  <TableCell>{label}</TableCell>
                  <TableCell className="text-right">{report?.aging?.[key] ?? 0}</TableCell>
                  <TableCell className="text-right font-mono">${(report?.agingAmounts?.[key] ?? 0).toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------- Page ----------------

export default function BillingAdmin() {
  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 overflow-auto md:pt-0 pt-16">
        <div className="p-6 space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-[#111111]" data-testid="text-page-title">Billing</h1>
            <p className="text-gray-600">In-house pricing, customers, invoices, and reporting — Stripe is only the card processor</p>
          </div>
          <Tabs defaultValue="invoices">
            <TabsList>
              <TabsTrigger value="invoices" data-testid="tab-invoices"><Receipt className="w-4 h-4 mr-2" />Invoices</TabsTrigger>
              <TabsTrigger value="pricing" data-testid="tab-pricing"><DollarSign className="w-4 h-4 mr-2" />Pricing</TabsTrigger>
              <TabsTrigger value="customers" data-testid="tab-customers"><Users className="w-4 h-4 mr-2" />Customers</TabsTrigger>
              <TabsTrigger value="reports" data-testid="tab-reports"><BarChart3 className="w-4 h-4 mr-2" />Reports</TabsTrigger>
            </TabsList>
            <TabsContent value="invoices" className="mt-6"><InvoicesTab /></TabsContent>
            <TabsContent value="pricing" className="mt-6"><PricingTab /></TabsContent>
            <TabsContent value="customers" className="mt-6"><CustomersTab /></TabsContent>
            <TabsContent value="reports" className="mt-6"><ReportsTab /></TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
