import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Shield, Plus, Pencil, Trash2, Clock, Calendar, Users, AlertTriangle, History, Loader2 } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import type { BookingPolicy } from "@shared/schema";

interface PolicyVersion {
  id: number;
  policyId: number;
  version: number;
  name: string;
  policyType: string;
  courseType: string | null;
  classType: string | null;
  value: number;
  isActive: boolean;
  description: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  changedBy: string;
  changedByName: string;
  changedByEmail: string;
  changeReason: string | null;
  createdAt: string;
}

const policyTypes = [
  { value: "max_duration", label: "Maximum Booking Duration (minutes)", description: "Maximum duration for a single booking" },
  { value: "max_bookings_per_day", label: "Maximum Bookings Per Day", description: "Maximum number of bookings a student can make per day" },
  { value: "max_bookings_per_week", label: "Maximum Bookings Per Week", description: "Maximum number of bookings a student can make per week" },
  { value: "advance_booking_days", label: "Advance Booking Days", description: "How many days in advance students can book" },
  { value: "min_booking_notice", label: "Minimum Booking Notice (hours)", description: "Minimum hours notice required for booking" },
  { value: "max_pending_bookings", label: "Maximum Pending Bookings", description: "Maximum number of unconfirmed bookings allowed" },
];

const courseTypes = [
  { value: "all", label: "All Course Types" },
  { value: "auto", label: "Automobile" },
  { value: "moto", label: "Motorcycle" },
  { value: "scooter", label: "Scooter" },
];

const classTypes = [
  { value: "all", label: "All Class Types" },
  { value: "theory", label: "Theory Classes" },
  { value: "driving", label: "Driving Classes" },
];

const policyFormSchema = z.object({
  name: z.string().min(1, "Policy name is required"),
  policyType: z.string().min(1, "Policy type is required"),
  courseType: z.string().optional(),
  classType: z.string().optional(),
  value: z.number().min(1, "Value must be at least 1"),
  isActive: z.boolean().default(true),
  description: z.string().optional(),
  effectiveFrom: z.string().optional(),
  effectiveTo: z.string().optional(),
  changeReason: z.string().optional(),
});

type PolicyFormData = z.infer<typeof policyFormSchema>;

export default function BookingPolicies() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<BookingPolicy | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [isVersionHistoryOpen, setIsVersionHistoryOpen] = useState(false);
  const [selectedPolicyId, setSelectedPolicyId] = useState<number | null>(null);

  const { data: policies = [], isLoading } = useQuery<BookingPolicy[]>({
    queryKey: ["/api/booking-policies"],
  });

  const { data: versionHistory = [], isLoading: isLoadingVersions } = useQuery<PolicyVersion[]>({
    queryKey: ["/api/booking-policies", selectedPolicyId, "versions"],
    enabled: !!selectedPolicyId && isVersionHistoryOpen,
  });

  const form = useForm<PolicyFormData>({
    resolver: zodResolver(policyFormSchema),
    defaultValues: {
      name: "",
      policyType: "",
      courseType: "all",
      classType: "all",
      value: 120,
      isActive: true,
      description: "",
      effectiveFrom: "",
      effectiveTo: "",
      changeReason: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: PolicyFormData) => {
      const payload = {
        ...data,
        courseType: data.courseType === "all" ? null : data.courseType,
        classType: data.classType === "all" ? null : data.classType,
        effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom).toISOString() : null,
        effectiveTo: data.effectiveTo ? new Date(data.effectiveTo).toISOString() : null,
      };
      return apiRequest("POST", "/api/booking-policies", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/booking-policies"] });
      toast({ title: "Policy Created", description: "Booking policy has been created successfully." });
      setIsDialogOpen(false);
      form.reset();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create booking policy.", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: PolicyFormData & { id: number }) => {
      const { id, changeReason, ...rest } = data;
      const payload = {
        ...rest,
        courseType: rest.courseType === "all" ? null : rest.courseType,
        classType: rest.classType === "all" ? null : rest.classType,
        effectiveFrom: rest.effectiveFrom ? new Date(rest.effectiveFrom).toISOString() : null,
        effectiveTo: rest.effectiveTo ? new Date(rest.effectiveTo).toISOString() : null,
        changeReason: changeReason || undefined,
      };
      return apiRequest("PATCH", `/api/booking-policies/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/booking-policies"] });
      toast({ title: "Policy Updated", description: "Booking policy has been updated successfully. Version history has been updated." });
      setIsDialogOpen(false);
      setEditingPolicy(null);
      form.reset();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update booking policy.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/booking-policies/${id}`, undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/booking-policies"] });
      toast({ title: "Policy Deleted", description: "Booking policy has been deleted." });
      setDeleteConfirmId(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete booking policy.", variant: "destructive" });
    },
  });

  const handleEdit = (policy: BookingPolicy) => {
    setEditingPolicy(policy);
    form.reset({
      name: policy.name,
      policyType: policy.policyType,
      courseType: policy.courseType || "all",
      classType: policy.classType || "all",
      value: policy.value,
      isActive: policy.isActive,
      description: policy.description || "",
      effectiveFrom: policy.effectiveFrom ? format(new Date(policy.effectiveFrom), "yyyy-MM-dd'T'HH:mm") : "",
      effectiveTo: policy.effectiveTo ? format(new Date(policy.effectiveTo), "yyyy-MM-dd'T'HH:mm") : "",
      changeReason: "",
    });
    setIsDialogOpen(true);
  };

  const handleCreate = () => {
    setEditingPolicy(null);
    form.reset({
      name: "",
      policyType: "",
      courseType: "all",
      classType: "all",
      value: 120,
      isActive: true,
      description: "",
      effectiveFrom: "",
      effectiveTo: "",
      changeReason: "",
    });
    setIsDialogOpen(true);
  };

  const openVersionHistory = (policyId: number) => {
    setSelectedPolicyId(policyId);
    setIsVersionHistoryOpen(true);
  };

  const onSubmit = (data: PolicyFormData) => {
    if (editingPolicy) {
      updateMutation.mutate({ ...data, id: editingPolicy.id });
    } else {
      createMutation.mutate(data);
    }
  };

  const getPolicyTypeLabel = (type: string) => {
    return policyTypes.find(t => t.value === type)?.label || type;
  };

  const formatValue = (type: string, value: number) => {
    switch (type) {
      case "max_duration":
        return `${value} minutes (${(value / 60).toFixed(1)} hours)`;
      case "min_booking_notice":
        return `${value} hours`;
      case "advance_booking_days":
        return `${value} days`;
      default:
        return value.toString();
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-amber-50 to-yellow-50">
        <div className="p-4 sm:p-6 lg:p-8">
          <div className="animate-pulse space-y-8">
            <div className="h-12 bg-gradient-to-r from-gray-200 to-gray-300 rounded-xl w-1/3"></div>
            <div className="h-64 bg-gradient-to-br from-gray-200 to-gray-300 rounded-2xl"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-amber-50 to-yellow-50">
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h1 className="text-4xl font-bold bg-gradient-to-r from-[#111111] to-gray-800 bg-clip-text text-transparent">
                Booking Policies
              </h1>
              <Shield className="h-8 w-8 text-[#ECC462]" />
            </div>
            <Button 
              onClick={handleCreate}
              className="bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111]"
              data-testid="button-create-policy"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Policy
            </Button>
          </div>
          <p className="text-lg text-gray-600 font-medium">
            Define booking limits and rules for students. Staff with override permissions can bypass these limits.
          </p>
        </div>

        <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
          <CardHeader className="border-b bg-gradient-to-r from-amber-50 to-yellow-50 pb-4">
            <CardTitle className="text-2xl font-bold bg-gradient-to-r from-[#ECC462] to-amber-600 bg-clip-text text-transparent flex items-center gap-2">
              <Clock className="h-6 w-6 text-[#ECC462]" />
              Active Policies
            </CardTitle>
            <CardDescription className="mt-1 text-gray-600">
              These policies control what students can book. Admins and authorized staff can override these limits when booking on behalf of students.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {policies.length === 0 ? (
              <div className="p-12 text-center">
                <Shield className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-600 mb-2">No Policies Defined</h3>
                <p className="text-gray-500 mb-4">Create your first booking policy to set limits for students.</p>
                <Button 
                  onClick={handleCreate}
                  className="bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111]"
                  data-testid="button-create-first-policy"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create First Policy
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead>Policy Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Applies To</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Effective Dates</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {policies.map((policy) => (
                    <TableRow key={policy.id} data-testid={`row-policy-${policy.id}`}>
                      <TableCell className="font-medium" data-testid={`text-policy-name-${policy.id}`}>
                        {policy.name}
                        {policy.description && (
                          <p className="text-xs text-gray-500 mt-1">{policy.description}</p>
                        )}
                      </TableCell>
                      <TableCell data-testid={`text-policy-type-${policy.id}`}>
                        {getPolicyTypeLabel(policy.policyType)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="outline" className="text-xs">
                            {courseTypes.find(c => c.value === (policy.courseType || "all"))?.label}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {classTypes.find(c => c.value === (policy.classType || "all"))?.label}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono" data-testid={`text-policy-value-${policy.id}`}>
                        {formatValue(policy.policyType, policy.value)}
                      </TableCell>
                      <TableCell>
                        <div className="text-xs space-y-1">
                          {policy.effectiveFrom && (
                            <div className="flex items-center gap-1">
                              <span className="text-gray-500">From:</span>
                              <span>{format(new Date(policy.effectiveFrom), "MMM d, yyyy")}</span>
                            </div>
                          )}
                          {policy.effectiveTo && (
                            <div className="flex items-center gap-1">
                              <span className="text-gray-500">To:</span>
                              <span>{format(new Date(policy.effectiveTo), "MMM d, yyyy")}</span>
                            </div>
                          )}
                          {!policy.effectiveFrom && !policy.effectiveTo && (
                            <span className="text-gray-400">No limits</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-amber-50 font-mono">
                          v{policy.version}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge 
                          className={policy.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}
                          data-testid={`badge-policy-status-${policy.id}`}
                        >
                          {policy.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => openVersionHistory(policy.id)}
                          title="View version history"
                          data-testid={`button-history-policy-${policy.id}`}
                        >
                          <History className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => handleEdit(policy)}
                          data-testid={`button-edit-policy-${policy.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Dialog open={deleteConfirmId === policy.id} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
                          <DialogTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="text-red-600 hover:text-red-700"
                              onClick={() => setDeleteConfirmId(policy.id)}
                              data-testid={`button-delete-policy-${policy.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle className="flex items-center gap-2">
                                <AlertTriangle className="h-5 w-5 text-red-500" />
                                Delete Policy
                              </DialogTitle>
                              <DialogDescription>
                                Are you sure you want to delete "{policy.name}"? This action cannot be undone.
                              </DialogDescription>
                            </DialogHeader>
                            <DialogFooter>
                              <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
                              <Button 
                                variant="destructive" 
                                onClick={() => deleteMutation.mutate(policy.id)}
                                disabled={deleteMutation.isPending}
                                data-testid="button-confirm-delete"
                              >
                                Delete
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingPolicy ? "Edit Policy" : "Create New Policy"}</DialogTitle>
              <DialogDescription>
                {editingPolicy ? "Update the booking policy settings." : "Define a new booking limit or rule for students."}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Policy Name</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g., 2-Hour Max Booking" data-testid="input-policy-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="policyType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Policy Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-policy-type">
                            <SelectValue placeholder="Select policy type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {policyTypes.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        {policyTypes.find(t => t.value === field.value)?.description}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="courseType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Course Type</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-course-type">
                              <SelectValue placeholder="Select course" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {courseTypes.map((type) => (
                              <SelectItem key={type.value} value={type.value}>
                                {type.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="classType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Class Type</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-class-type">
                              <SelectValue placeholder="Select class" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {classTypes.map((type) => (
                              <SelectItem key={type.value} value={type.value}>
                                {type.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="value"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Value</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          {...field} 
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                          data-testid="input-policy-value"
                        />
                      </FormControl>
                      <FormDescription>
                        {form.watch("policyType") === "max_duration" && "Enter value in minutes (e.g., 120 for 2 hours)"}
                        {form.watch("policyType") === "min_booking_notice" && "Enter value in hours"}
                        {form.watch("policyType") === "advance_booking_days" && "Enter value in days"}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description (Optional)</FormLabel>
                      <FormControl>
                        <Textarea 
                          {...field} 
                          placeholder="Add a description for this policy..."
                          rows={2}
                          data-testid="input-policy-description"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="effectiveFrom"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          Effective From
                        </FormLabel>
                        <FormControl>
                          <Input 
                            type="datetime-local" 
                            {...field}
                            data-testid="input-effective-from"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="effectiveTo"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          Effective To
                        </FormLabel>
                        <FormControl>
                          <Input 
                            type="datetime-local" 
                            {...field}
                            data-testid="input-effective-to"
                          />
                        </FormControl>
                        <FormDescription className="text-xs">Leave empty for no end date</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <FormLabel>Active</FormLabel>
                        <FormDescription>Enable or disable this policy</FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="switch-policy-active"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {editingPolicy && (
                  <FormField
                    control={form.control}
                    name="changeReason"
                    render={({ field }) => (
                      <FormItem className="border-t pt-4">
                        <FormLabel className="flex items-center gap-1">
                          <History className="h-4 w-4" />
                          Reason for Change
                        </FormLabel>
                        <FormControl>
                          <Textarea 
                            {...field} 
                            placeholder="Describe why this policy is being updated (tracked in version history)..."
                            rows={2}
                            data-testid="input-change-reason"
                          />
                        </FormControl>
                        <FormDescription className="text-xs">Optional: Provide a reason for audit trail</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    className="bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111]"
                    disabled={createMutation.isPending || updateMutation.isPending}
                    data-testid="button-save-policy"
                  >
                    {editingPolicy ? "Update Policy" : "Create Policy"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        <Dialog open={isVersionHistoryOpen} onOpenChange={setIsVersionHistoryOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <History className="h-5 w-5 text-[#ECC462]" />
                Version History
              </DialogTitle>
              <DialogDescription>
                View all changes made to this policy over time.
              </DialogDescription>
            </DialogHeader>

            <ScrollArea className="h-[400px] pr-4">
              {isLoadingVersions ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="h-6 w-6 animate-spin text-[#ECC462]" />
                </div>
              ) : versionHistory.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <History className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                  <p className="font-medium">No version history available</p>
                  <p className="text-sm">Changes to this policy will be tracked here when edited with a change reason.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {versionHistory.map((version, index) => (
                    <Card key={version.id} className={index === 0 ? "border-[#ECC462] border-2" : ""}>
                      <CardHeader className="py-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="bg-amber-50">v{version.version}</Badge>
                            <span className="text-sm font-medium">{version.name}</span>
                            {index === 0 && <Badge className="bg-[#ECC462] text-[#111111]">Previous</Badge>}
                          </div>
                          <span className="text-xs text-gray-500">
                            {format(new Date(version.createdAt), "MMM d, yyyy 'at' h:mm a")}
                          </span>
                        </div>
                      </CardHeader>
                      <CardContent className="py-2 space-y-2">
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <span className="text-gray-500">Type:</span>{" "}
                            <span className="font-medium">{getPolicyTypeLabel(version.policyType)}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Value:</span>{" "}
                            <span className="font-medium">{version.value}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Status:</span>{" "}
                            <Badge variant={version.isActive ? "default" : "secondary"} className="text-xs">
                              {version.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </div>
                          <div>
                            <span className="text-gray-500">Changed by:</span>{" "}
                            <span className="font-medium">{version.changedByName || version.changedByEmail}</span>
                          </div>
                        </div>
                        {version.changeReason && (
                          <div className="text-sm bg-gray-50 p-2 rounded border-l-4 border-[#ECC462]">
                            <span className="text-gray-500 font-medium">Reason:</span>{" "}
                            <span>{version.changeReason}</span>
                          </div>
                        )}
                        {(version.effectiveFrom || version.effectiveTo) && (
                          <div className="text-sm flex items-center gap-4 text-gray-600">
                            <Calendar className="h-4 w-4 text-gray-400" />
                            {version.effectiveFrom && (
                              <span>From: {format(new Date(version.effectiveFrom), "MMM d, yyyy")}</span>
                            )}
                            {version.effectiveTo && (
                              <span>To: {format(new Date(version.effectiveTo), "MMM d, yyyy")}</span>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
