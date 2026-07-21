import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Settings as SettingsIcon, FileText, Hash, Users, Plus, Pencil, Trash2, Eye, EyeOff, ShieldCheck, AlertTriangle, Download, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ─── Contract Settings ────────────────────────────────────────────────────────
const settingsSchema = z.object({
  nextContractNumber: z.number().min(1, "Must be at least 1"),
});
type SettingsFormData = z.infer<typeof settingsSchema>;

// ─── User Schema ──────────────────────────────────────────────────────────────
const userSchema = z.object({
  firstName: z.string().min(1, "First name required"),
  lastName: z.string().min(1, "Last name required"),
  email: z.string().email("Valid email required"),
  role: z.string().min(1, "Role required"),
  password: z.string().optional(),
  canOverrideBookingPolicies: z.boolean().default(false),
});
type UserFormData = z.infer<typeof userSchema>;

interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  canOverrideBookingPolicies: boolean;
  createdAt: string;
}

// ─── User Dialog ──────────────────────────────────────────────────────────────
function UserDialog({
  open,
  onClose,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  existing?: AdminUser;
}) {
  const { toast } = useToast();
  const [showPass, setShowPass] = useState(false);
  const isEdit = !!existing;

  const form = useForm<UserFormData>({
    resolver: zodResolver(
      isEdit
        ? userSchema.extend({ password: z.string().optional() })
        : userSchema.extend({ password: z.string().min(6, "Password must be at least 6 characters") })
    ),
    defaultValues: {
      firstName: existing?.firstName ?? "",
      lastName: existing?.lastName ?? "",
      email: existing?.email ?? "",
      role: existing?.role ?? "admin",
      password: "",
      canOverrideBookingPolicies: existing?.canOverrideBookingPolicies ?? false,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        firstName: existing?.firstName ?? "",
        lastName: existing?.lastName ?? "",
        email: existing?.email ?? "",
        role: existing?.role ?? "admin",
        password: "",
        canOverrideBookingPolicies: existing?.canOverrideBookingPolicies ?? false,
      });
      setShowPass(false);
    }
  }, [open, existing, form]);

  const mutation = useMutation({
    mutationFn: (data: UserFormData) => {
      const payload: any = { ...data };
      if (!payload.password) delete payload.password;
      if (isEdit) return apiRequest("PUT", `/api/admin/users/${existing!.id}`, payload);
      return apiRequest("POST", "/api/admin/users", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: isEdit ? "User updated" : "User created" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to save user", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit User" : "Add Admin User"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(d => mutation.mutate(d))} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="firstName" render={({ field }) => (
                <FormItem>
                  <FormLabel>First Name</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="lastName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Last Name</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl><Input type="email" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="role" render={({ field }) => (
              <FormItem>
                <FormLabel>Role</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="staff">Staff</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="password" render={({ field }) => (
              <FormItem>
                <FormLabel>{isEdit ? "New Password (leave blank to keep)" : "Password"}</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input type={showPass ? "text" : "password"} {...field} />
                    <button type="button" onClick={() => setShowPass(p => !p)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="canOverrideBookingPolicies" render={({ field }) => (
              <FormItem className="flex items-center gap-3 rounded-lg border p-3">
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
                <div>
                  <FormLabel className="text-sm font-medium">Can Override Booking Policies</FormLabel>
                  <p className="text-xs text-gray-500">Allows bypassing booking rules with a reason</p>
                </div>
              </FormItem>
            )} />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={mutation.isPending}
                className="bg-[#ECC462] text-[#111111] hover:bg-[#d4ad4f]">
                {mutation.isPending ? "Saving..." : isEdit ? "Save Changes" : "Create User"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Admin Users Tab ──────────────────────────────────────────────────────────
function AdminUsersTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState<AdminUser | undefined>();

  const { data: adminUsers = [], isLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to delete user", variant: "destructive" });
    },
  });

  const roleColors: Record<string, string> = {
    owner: "bg-purple-100 text-purple-800",
    admin: "bg-blue-100 text-blue-800",
    manager: "bg-green-100 text-green-800",
    staff: "bg-gray-100 text-gray-700",
  };

  function handleEdit(user: AdminUser) {
    setEditUser(user);
    setDialogOpen(true);
  }

  function handleAdd() {
    setEditUser(undefined);
    setDialogOpen(true);
  }

  function handleClose() {
    setDialogOpen(false);
    setEditUser(undefined);
  }

  function handleDelete(user: AdminUser) {
    if (!confirm(`Delete ${user.email}? This cannot be undone.`)) return;
    deleteMutation.mutate(user.id);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Admin Users</h3>
          <p className="text-sm text-gray-500">Manage who has access to the admin portal</p>
        </div>
        <Button onClick={handleAdd} className="bg-[#ECC462] text-[#111111] hover:bg-[#d4ad4f] gap-2">
          <Plus className="h-4 w-4" /> Add User
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      ) : (
        <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {adminUsers.map(user => (
            <div key={user.id} className="flex items-center justify-between p-4 hover:bg-gray-50">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-[#ECC462]/20 flex items-center justify-center text-[#111111] font-semibold text-sm">
                  {(user.firstName?.[0] ?? user.email[0]).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">
                      {user.firstName || user.lastName ? `${user.firstName} ${user.lastName}`.trim() : "—"}
                    </span>
                    <Badge className={`text-xs px-2 py-0 ${roleColors[user.role] ?? roleColors.staff}`}>
                      {user.role}
                    </Badge>
                    {user.canOverrideBookingPolicies && (
                      <span title="Can override booking policies" aria-label="Can override booking policies">
                        <ShieldCheck className="h-4 w-4 text-amber-500" />
                      </span>
                    )}
                  </div>
                  <span className="text-sm text-gray-500">{user.email}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => handleEdit(user)} className="h-8 w-8 p-0">
                  <Pencil className="h-4 w-4 text-gray-500" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleDelete(user)}
                  className="h-8 w-8 p-0 hover:text-red-600" disabled={deleteMutation.isPending}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <UserDialog open={dialogOpen} onClose={handleClose} existing={editUser} />
    </div>
  );
}

// ─── Contract Settings Tab ────────────────────────────────────────────────────
function ContractSettingsTab() {
  const { toast } = useToast();

  const { data: settings, isLoading } = useQuery<{ nextContractNumber: number }>({
    queryKey: ["/api/settings"],
    retry: false,
  });

  const form = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: { nextContractNumber: settings?.nextContractNumber || 1 },
  });

  useState(() => {
    if (settings) form.reset({ nextContractNumber: settings.nextContractNumber });
  });

  const updateMutation = useMutation({
    mutationFn: (data: SettingsFormData) => apiRequest("PUT", "/api/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Settings saved" });
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" } as any),
  });

  if (isLoading) return <div className="h-32 bg-gray-100 rounded-lg animate-pulse" />;

  return (
    <Card className="border border-gray-200 shadow-sm">
      <CardHeader className="border-b bg-gray-50 pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="h-5 w-5 text-[#ECC462]" /> Contract Management
        </CardTitle>
        <CardDescription>Configure automatic contract number generation.</CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(d => updateMutation.mutate(d))} className="space-y-6">
            <FormField control={form.control} name="nextContractNumber" render={({ field }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-2">
                  <Hash className="h-4 w-4 text-amber-600" /> Next Contract Number
                </FormLabel>
                <FormControl>
                  <Input type="number" min="1" {...field}
                    onChange={e => field.onChange(parseInt(e.target.value) || 1)} />
                </FormControl>
                <FormMessage />
                <p className="text-sm text-gray-500">
                  The next student will receive contract number {form.watch("nextContractNumber")}.
                </p>
              </FormItem>
            )} />
            <Button type="submit" disabled={updateMutation.isPending}
              className="bg-[#ECC462] text-[#111111] hover:bg-[#d4ad4f]">
              {updateMutation.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

// ─── Error Logs Tab ───────────────────────────────────────────────────────────
interface ErrorLogEntry {
  id: number;
  statusCode: number;
  method: string;
  path: string;
  message: string;
  stack: string | null;
  userId: string | null;
  userEmail: string | null;
  requestContext: any;
  createdAt: string;
}

const ERROR_PAGE_SIZE = 25;

function downloadJson(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function ErrorLogsTab() {
  const [page, setPage] = useState(0);
  const [pathFilter, setPathFilter] = useState("");
  const [appliedPath, setAppliedPath] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const params = new URLSearchParams();
  params.set("limit", String(ERROR_PAGE_SIZE));
  params.set("offset", String(page * ERROR_PAGE_SIZE));
  if (appliedPath) params.set("path", appliedPath);
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  const listUrl = `/api/admin/error-logs?${params.toString()}`;

  const { data, isLoading, isFetching, refetch } = useQuery<{ logs: ErrorLogEntry[]; total: number }>({
    queryKey: [listUrl],
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / ERROR_PAGE_SIZE));

  function applyFilters() {
    setAppliedPath(pathFilter.trim());
    setPage(0);
  }

  function downloadAll() {
    const dl = new URLSearchParams(params);
    dl.set("download", "true");
    dl.set("limit", "500");
    dl.set("offset", "0");
    downloadJson(`/api/admin/error-logs?${dl.toString()}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Server Error Logs</h3>
          <p className="text-sm text-gray-500">
            Every server error (HTTP 500+) is recorded here. Entries are kept for 30 days, then deleted automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-error-logs">
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={downloadAll} disabled={total === 0} data-testid="button-download-error-logs">
            <Download className="h-4 w-4 mr-1" /> Download JSON
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex-1 min-w-[180px]">
          <Label className="text-xs text-gray-500">Path contains</Label>
          <Input
            value={pathFilter}
            onChange={e => setPathFilter(e.target.value)}
            onKeyDown={e => e.key === "Enter" && applyFilters()}
            placeholder="/api/students"
            className="h-9"
            data-testid="input-error-path-filter"
          />
        </div>
        <div>
          <Label className="text-xs text-gray-500">From</Label>
          <Input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPage(0); }} className="h-9" data-testid="input-error-start-date" />
        </div>
        <div>
          <Label className="text-xs text-gray-500">To</Label>
          <Input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setPage(0); }} className="h-9" data-testid="input-error-end-date" />
        </div>
        <Button size="sm" onClick={applyFilters} className="h-9 bg-[#ECC462] text-[#111111] hover:bg-[#d4ad4f]" data-testid="button-apply-error-filters">
          Apply
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      ) : logs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500" data-testid="text-no-error-logs">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-gray-300" />
          No server errors recorded{appliedPath || startDate || endDate ? " for these filters" : ""}. That's a good thing!
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
          {logs.map(log => {
            const expanded = expandedId === log.id;
            return (
              <div key={log.id} data-testid={`row-error-log-${log.id}`}>
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : log.id)}
                  className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50"
                  data-testid={`button-expand-error-${log.id}`}
                >
                  {expanded ? <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />}
                  <Badge className="bg-red-100 text-red-800 shrink-0">{log.statusCode}</Badge>
                  <span className="text-xs font-mono text-gray-500 shrink-0">{log.method}</span>
                  <span className="text-sm font-mono text-gray-800 truncate max-w-[220px]" title={log.path}>{log.path}</span>
                  <span className="text-sm text-gray-600 truncate flex-1" title={log.message}>{log.message}</span>
                  <span className="text-xs text-gray-400 shrink-0 hidden sm:inline">{log.userEmail || log.userId || "anonymous"}</span>
                  <span className="text-xs text-gray-400 shrink-0">{new Date(log.createdAt).toLocaleString()}</span>
                </button>
                {expanded && (
                  <div className="px-4 pb-4 pt-1 space-y-3 bg-gray-50 border-t border-gray-100">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-500">
                        Logged {new Date(log.createdAt).toLocaleString()} · User: {log.userEmail || log.userId || "not logged in"}
                      </div>
                      <Button variant="outline" size="sm" onClick={() => downloadJson(`/api/admin/error-logs/${log.id}?download=true`)} data-testid={`button-download-error-${log.id}`}>
                        <Download className="h-3.5 w-3.5 mr-1" /> Download entry
                      </Button>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-gray-700 mb-1">Message</div>
                      <div className="text-sm text-gray-800 bg-white rounded border border-gray-200 p-2 break-words" data-testid={`text-error-message-${log.id}`}>{log.message}</div>
                    </div>
                    {log.stack && (
                      <div>
                        <div className="text-xs font-semibold text-gray-700 mb-1">Stack trace</div>
                        <pre className="text-xs text-gray-700 bg-white rounded border border-gray-200 p-2 overflow-x-auto max-h-64 whitespace-pre-wrap" data-testid={`text-error-stack-${log.id}`}>{log.stack}</pre>
                      </div>
                    )}
                    {log.requestContext && (
                      <div>
                        <div className="text-xs font-semibold text-gray-700 mb-1">Request data (sanitized)</div>
                        <pre className="text-xs text-gray-700 bg-white rounded border border-gray-200 p-2 overflow-x-auto max-h-64 whitespace-pre-wrap" data-testid={`text-error-context-${log.id}`}>
                          {JSON.stringify(log.requestContext, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {total > ERROR_PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span data-testid="text-error-log-count">
            Showing {page * ERROR_PAGE_SIZE + 1}–{Math.min((page + 1) * ERROR_PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)} data-testid="button-error-prev-page">
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)} data-testid="button-error-next-page">
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Settings() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <SettingsIcon className="h-7 w-7 text-[#ECC462]" />
            <h1 className="text-3xl font-bold text-[#111111]">Settings</h1>
          </div>
          <p className="text-gray-500">Manage application settings and admin access.</p>
        </div>

        <Tabs defaultValue="users">
          <TabsList className="mb-6 border-b w-full justify-start rounded-none bg-transparent p-0 gap-0">
            <TabsTrigger value="users"
              className="rounded-none border-b-2 border-transparent px-4 pb-3 pt-1 text-sm font-medium text-gray-500 data-[state=active]:border-[#ECC462] data-[state=active]:text-[#111111] data-[state=active]:shadow-none bg-transparent">
              <Users className="h-4 w-4 mr-2 inline" />Admin Users
            </TabsTrigger>
            <TabsTrigger value="contracts"
              className="rounded-none border-b-2 border-transparent px-4 pb-3 pt-1 text-sm font-medium text-gray-500 data-[state=active]:border-[#ECC462] data-[state=active]:text-[#111111] data-[state=active]:shadow-none bg-transparent">
              <FileText className="h-4 w-4 mr-2 inline" />Contracts
            </TabsTrigger>
            <TabsTrigger value="error-logs" data-testid="tab-error-logs"
              className="rounded-none border-b-2 border-transparent px-4 pb-3 pt-1 text-sm font-medium text-gray-500 data-[state=active]:border-[#ECC462] data-[state=active]:text-[#111111] data-[state=active]:shadow-none bg-transparent">
              <AlertTriangle className="h-4 w-4 mr-2 inline" />Error Logs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <AdminUsersTab />
          </TabsContent>

          <TabsContent value="contracts">
            <ContractSettingsTab />
          </TabsContent>

          <TabsContent value="error-logs">
            <ErrorLogsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
