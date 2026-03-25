import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  DollarSign, Search, CheckCircle2, Clock, Eye, 
  Loader2, AlertTriangle, User, Plus, UserPlus, Receipt,
  CreditCard, Banknote, Building, Split, X, ArrowRight
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Student, PaymentIntake, PayerProfile, PaymentAllocation, StudentCourse } from "@shared/schema";
import { format } from "date-fns";

const PAYMENT_METHODS = [
  { value: 'e_transfer', label: 'E-Transfer', icon: CreditCard },
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'cheque', label: 'Cheque', icon: Receipt },
  { value: 'bank_transfer', label: 'Bank Transfer', icon: Building },
  { value: 'other', label: 'Other', icon: DollarSign },
];

interface AllocationItem {
  studentId: number;
  studentName: string;
  courseId?: number;
  courseName?: string;
  amount: number;
  isCredit: boolean;
}

export default function PaymentReconciliation() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [dateRange, setDateRange] = useState({ start: "", end: "" });
  const [selectedPayment, setSelectedPayment] = useState<PaymentIntake | null>(null);
  const [isAllocating, setIsAllocating] = useState(false);
  const [isAddingPayment, setIsAddingPayment] = useState(false);
  const [isAddingPayer, setIsAddingPayer] = useState(false);
  const [activeTab, setActiveTab] = useState("pending");
  
  const [newPayment, setNewPayment] = useState({
    amount: "",
    payerName: "",
    payerEmail: "",
    payerPhone: "",
    paymentMethod: "e_transfer",
    referenceNumber: "",
    receivedDate: format(new Date(), "yyyy-MM-dd"),
    notes: "",
    payerId: null as number | null,
  });
  
  const [allocations, setAllocations] = useState<AllocationItem[]>([]);
  const [allocatedTotal, setAllocatedTotal] = useState(0);
  const [allocationNotes, setAllocationNotes] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedStudentForAllocation, setSelectedStudentForAllocation] = useState<Student | null>(null);
  
  const { toast } = useToast();

  const { data: payments = [], isLoading: paymentsLoading } = useQuery<PaymentIntake[]>({
    queryKey: ["/api/admin/payments/intakes", statusFilter, searchQuery, dateRange.start, dateRange.end],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== 'all') params.append('status', statusFilter);
      if (searchQuery) params.append('search', searchQuery);
      if (dateRange.start) params.append('startDate', dateRange.start);
      if (dateRange.end) params.append('endDate', dateRange.end);
      const response = await fetch(`/api/admin/payments/intakes?${params}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch payments');
      return response.json();
    },
  });

  const { data: payerProfiles = [], isLoading: payersLoading } = useQuery<(PayerProfile & { linkedStudents?: Student[] })[]>({
    queryKey: ["/api/admin/payers/with-students"],
    queryFn: async () => {
      const response = await fetch('/api/admin/payers/with-students', { credentials: 'include' });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const { data: studentsResponse } = useQuery<{ students: Student[] }>({
    queryKey: ["/api/students"],
  });
  const students = studentsResponse?.students || [];

  const { data: searchedStudents = [] } = useQuery<Student[]>({
    queryKey: ["/api/admin/students/search", studentSearch],
    queryFn: async () => {
      if (!studentSearch || studentSearch.length < 2) return [];
      const response = await fetch(`/api/admin/students/search?q=${encodeURIComponent(studentSearch)}`, { credentials: 'include' });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: studentSearch.length >= 2,
  });

  const createPaymentMutation = useMutation({
    mutationFn: async (payment: typeof newPayment) => {
      return apiRequest('POST', '/api/admin/payments/intakes', {
        amount: parseFloat(payment.amount),
        payerName: payment.payerName,
        payerEmail: payment.payerEmail || null,
        payerPhone: payment.payerPhone || null,
        paymentMethod: payment.paymentMethod,
        referenceNumber: payment.referenceNumber || null,
        receivedDate: payment.receivedDate,
        notes: payment.notes || null,
        payerId: payment.payerId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payments/intakes"] });
      toast({ title: "Payment recorded", description: "The payment has been added to the pending queue." });
      setIsAddingPayment(false);
      resetNewPayment();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to record payment.", variant: "destructive" });
    },
  });

  const allocatePaymentMutation = useMutation({
    mutationFn: async ({ paymentId, allocations, notes }: { 
      paymentId: number; 
      allocations: AllocationItem[];
      notes: string;
    }) => {
      return apiRequest('POST', `/api/admin/payments/intakes/${paymentId}/allocate`, {
        allocations: allocations.map(a => ({
          studentId: a.studentId,
          courseId: a.courseId || null,
          amount: a.amount,
          isCredit: a.isCredit,
        })),
        notes,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payments/intakes"] });
      toast({ title: "Payment allocated", description: "The payment has been successfully allocated." });
      setIsAllocating(false);
      setSelectedPayment(null);
      setAllocations([]);
      setAllocationNotes("");
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to allocate payment.", variant: "destructive" });
    },
  });

  const createPayerMutation = useMutation({
    mutationFn: async (payer: { name: string; email?: string; phone?: string; relationship?: string; studentId?: number }) => {
      return apiRequest('POST', '/api/admin/payers', payer);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payers/with-students"] });
      toast({ title: "Payer added", description: "The payer profile has been created." });
      setIsAddingPayer(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create payer profile.", variant: "destructive" });
    },
  });

  const resetNewPayment = () => {
    setNewPayment({
      amount: "",
      payerName: "",
      payerEmail: "",
      payerPhone: "",
      paymentMethod: "e_transfer",
      referenceNumber: "",
      receivedDate: format(new Date(), "yyyy-MM-dd"),
      notes: "",
      payerId: null,
    });
  };

  const handleAddAllocation = (student: Student, isCredit = false) => {
    const existingIndex = allocations.findIndex(a => a.studentId === student.id && a.isCredit === isCredit);
    if (existingIndex >= 0) {
      toast({ title: "Already added", description: "This student is already in the allocation list." });
      return;
    }
    setAllocations([...allocations, {
      studentId: student.id,
      studentName: `${student.firstName} ${student.lastName}`,
      amount: 0,
      isCredit,
    }]);
    setStudentSearch("");
    setSelectedStudentForAllocation(null);
  };

  const updateAllocationAmount = (index: number, amount: number) => {
    const updated = [...allocations];
    updated[index].amount = amount;
    setAllocations(updated);
    setAllocatedTotal(updated.reduce((sum, a) => sum + a.amount, 0));
  };

  const removeAllocation = (index: number) => {
    const updated = allocations.filter((_, i) => i !== index);
    setAllocations(updated);
    setAllocatedTotal(updated.reduce((sum, a) => sum + a.amount, 0));
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case 'partially_allocated':
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200"><Split className="w-3 h-3 mr-1" />Partial</Badge>;
      case 'fully_allocated':
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200"><CheckCircle2 className="w-3 h-3 mr-1" />Allocated</Badge>;
      case 'flagged':
        return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200"><AlertTriangle className="w-3 h-3 mr-1" />Flagged</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getPaymentMethodIcon = (method: string) => {
    const methodInfo = PAYMENT_METHODS.find(m => m.value === method);
    if (methodInfo) {
      const Icon = methodInfo.icon;
      return <Icon className="w-4 h-4" />;
    }
    return <DollarSign className="w-4 h-4" />;
  };

  const pendingPayments = payments.filter(p => p.status === 'pending');
  const allocatedPayments = payments.filter(p => p.status === 'fully_allocated' || p.status === 'partially_allocated');
  const flaggedPayments = payments.filter(p => p.status === 'flagged');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#111111]">Payment Reconciliation</h1>
          <p className="text-gray-600 mt-1">Manage external payments and allocate to student accounts</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline"
            onClick={() => setIsAddingPayer(true)}
            data-testid="button-add-payer"
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Add Payer
          </Button>
          <Button 
            className="bg-[#ECC462] text-[#111111] hover:bg-[#d4b058]"
            onClick={() => setIsAddingPayment(true)}
            data-testid="button-add-payment"
          >
            <Plus className="w-4 h-4 mr-2" />
            Record Payment
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Pending Queue</p>
                <p className="text-2xl font-bold text-yellow-600" data-testid="text-pending-count">{pendingPayments.length}</p>
              </div>
              <Clock className="w-8 h-8 text-yellow-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Pending Amount</p>
                <p className="text-2xl font-bold text-[#111111]" data-testid="text-pending-amount">
                  ${pendingPayments.reduce((sum, p) => sum + parseFloat(p.amount), 0).toFixed(2)}
                </p>
              </div>
              <DollarSign className="w-8 h-8 text-[#ECC462]" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Allocated Today</p>
                <p className="text-2xl font-bold text-green-600" data-testid="text-allocated-count">
                  {allocatedPayments.filter(p => p.reconciledAt && format(new Date(p.reconciledAt), 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')).length}
                </p>
              </div>
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Flagged</p>
                <p className="text-2xl font-bold text-red-600" data-testid="text-flagged-count">{flaggedPayments.length}</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pending" data-testid="tab-pending">Pending Queue ({pendingPayments.length})</TabsTrigger>
          <TabsTrigger value="allocated" data-testid="tab-allocated">Allocated ({allocatedPayments.length})</TabsTrigger>
          <TabsTrigger value="payers" data-testid="tab-payers">Payer Directory</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Pending Payments</CardTitle>
                <div className="flex gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      placeholder="Search payer or reference..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10 w-64"
                      data-testid="input-search-payments"
                    />
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {paymentsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : pendingPayments.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <DollarSign className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p>No pending payments in the queue</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Payer</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingPayments.map((payment) => (
                      <TableRow key={payment.id} data-testid={`row-payment-${payment.id}`}>
                        <TableCell>
                          {format(new Date(payment.receivedDate), 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-gray-400" />
                            <div>
                              <p className="font-medium">{payment.payerName}</p>
                              {payment.payerEmail && (
                                <p className="text-sm text-gray-500">{payment.payerEmail}</p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getPaymentMethodIcon(payment.paymentMethod)}
                            <span className="capitalize">{payment.paymentMethod.replace('_', ' ')}</span>
                          </div>
                        </TableCell>
                        <TableCell>{payment.referenceNumber || '-'}</TableCell>
                        <TableCell className="text-right font-medium">
                          ${parseFloat(payment.amount).toFixed(2)}
                        </TableCell>
                        <TableCell>{getStatusBadge(payment.status)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            className="bg-[#ECC462] text-[#111111] hover:bg-[#d4b058]"
                            onClick={() => {
                              setSelectedPayment(payment);
                              setIsAllocating(true);
                            }}
                            data-testid={`button-allocate-${payment.id}`}
                          >
                            <ArrowRight className="w-4 h-4 mr-1" />
                            Allocate
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="allocated" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Allocated Payments</CardTitle>
            </CardHeader>
            <CardContent>
              {allocatedPayments.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p>No allocated payments yet</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date Received</TableHead>
                      <TableHead>Date Allocated</TableHead>
                      <TableHead>Payer</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allocatedPayments.map((payment) => (
                      <TableRow key={payment.id} data-testid={`row-allocated-${payment.id}`}>
                        <TableCell>
                          {format(new Date(payment.receivedDate), 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell>
                          {payment.reconciledAt ? format(new Date(payment.reconciledAt), 'MMM d, yyyy') : '-'}
                        </TableCell>
                        <TableCell>{payment.payerName}</TableCell>
                        <TableCell className="capitalize">{payment.paymentMethod.replace('_', ' ')}</TableCell>
                        <TableCell className="text-right font-medium">
                          ${parseFloat(payment.amount).toFixed(2)}
                        </TableCell>
                        <TableCell>{getStatusBadge(payment.status)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedPayment(payment)}
                            data-testid={`button-view-${payment.id}`}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payers" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Payer Directory</CardTitle>
                <Button 
                  variant="outline"
                  onClick={() => setIsAddingPayer(true)}
                  data-testid="button-add-payer-tab"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Payer
                </Button>
              </div>
              <CardDescription>
                Manage registered payers (parents, guardians, employers) who make payments on behalf of students
              </CardDescription>
            </CardHeader>
            <CardContent>
              {payersLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : payerProfiles.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <UserPlus className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p>No payer profiles yet</p>
                  <p className="text-sm">Add payers to quickly identify recurring payment sources</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Relationship</TableHead>
                      <TableHead>Linked Students</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payerProfiles.map((payer) => {
                      const linkedStudents = payer.linkedStudents || [];
                      return (
                        <TableRow key={payer.id} data-testid={`row-payer-${payer.id}`}>
                          <TableCell className="font-medium">{payer.name}</TableCell>
                          <TableCell>
                            <div>
                              {payer.email && <p className="text-sm">{payer.email}</p>}
                              {payer.phone && <p className="text-sm text-gray-500">{payer.phone}</p>}
                            </div>
                          </TableCell>
                          <TableCell className="capitalize">{payer.relationship || '-'}</TableCell>
                          <TableCell>
                            {linkedStudents.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {linkedStudents.map(s => (
                                  <Badge key={s.id} variant="outline" className="text-xs">
                                    {s.firstName} {s.lastName}
                                  </Badge>
                                ))}
                              </div>
                            ) : '-'}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" data-testid={`button-edit-payer-${payer.id}`}>
                              <Eye className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={isAddingPayment} onOpenChange={setIsAddingPayment}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Record New Payment</DialogTitle>
            <DialogDescription>
              Enter details for an external payment received (e-transfer, cash, cheque, etc.)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label>Amount *</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={newPayment.amount}
                    onChange={(e) => setNewPayment({ ...newPayment, amount: e.target.value })}
                    className="pl-10"
                    data-testid="input-payment-amount"
                  />
                </div>
              </div>
              <div className="col-span-2">
                <Label>Payer Name *</Label>
                <Input
                  placeholder="Name of person or organization"
                  value={newPayment.payerName}
                  onChange={(e) => setNewPayment({ ...newPayment, payerName: e.target.value })}
                  data-testid="input-payer-name"
                />
              </div>
              <div>
                <Label>Payer Email</Label>
                <Input
                  type="email"
                  placeholder="email@example.com"
                  value={newPayment.payerEmail}
                  onChange={(e) => setNewPayment({ ...newPayment, payerEmail: e.target.value })}
                  data-testid="input-payer-email"
                />
              </div>
              <div>
                <Label>Payer Phone</Label>
                <Input
                  placeholder="(555) 123-4567"
                  value={newPayment.payerPhone}
                  onChange={(e) => setNewPayment({ ...newPayment, payerPhone: e.target.value })}
                  data-testid="input-payer-phone"
                />
              </div>
              <div>
                <Label>Payment Method *</Label>
                <Select
                  value={newPayment.paymentMethod}
                  onValueChange={(val) => setNewPayment({ ...newPayment, paymentMethod: val })}
                >
                  <SelectTrigger data-testid="select-payment-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map(m => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Reference Number</Label>
                <Input
                  placeholder="Transaction ID / Cheque #"
                  value={newPayment.referenceNumber}
                  onChange={(e) => setNewPayment({ ...newPayment, referenceNumber: e.target.value })}
                  data-testid="input-reference-number"
                />
              </div>
              <div className="col-span-2">
                <Label>Date Received *</Label>
                <Input
                  type="date"
                  value={newPayment.receivedDate}
                  onChange={(e) => setNewPayment({ ...newPayment, receivedDate: e.target.value })}
                  data-testid="input-received-date"
                />
              </div>
              <div className="col-span-2">
                <Label>Notes</Label>
                <Textarea
                  placeholder="Any additional information..."
                  value={newPayment.notes}
                  onChange={(e) => setNewPayment({ ...newPayment, notes: e.target.value })}
                  data-testid="input-payment-notes"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddingPayment(false)}>Cancel</Button>
            <Button
              className="bg-[#ECC462] text-[#111111] hover:bg-[#d4b058]"
              onClick={() => createPaymentMutation.mutate(newPayment)}
              disabled={!newPayment.amount || !newPayment.payerName || createPaymentMutation.isPending}
              data-testid="button-submit-payment"
            >
              {createPaymentMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAllocating && selectedPayment !== null} onOpenChange={(open) => {
        if (!open) {
          setIsAllocating(false);
          setSelectedPayment(null);
          setAllocations([]);
          setAllocatedTotal(0);
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Allocate Payment</DialogTitle>
            <DialogDescription>
              Distribute this payment to student accounts or create credit balances
            </DialogDescription>
          </DialogHeader>
          {selectedPayment && (
            <div className="space-y-4 py-4">
              <Card className="bg-gray-50">
                <CardContent className="pt-4">
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-gray-500">Payment Amount</p>
                      <p className="text-xl font-bold text-[#111111]">
                        ${parseFloat(selectedPayment.amount).toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">From</p>
                      <p className="font-medium">{selectedPayment.payerName}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Method</p>
                      <p className="capitalize">{selectedPayment.paymentMethod.replace('_', ' ')}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div>
                <Label>Search Student to Add</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="Search by name, email, or phone..."
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    className="pl-10"
                    data-testid="input-search-student"
                  />
                </div>
                {searchedStudents.length > 0 && studentSearch && (
                  <div className="absolute z-10 mt-1 w-full max-w-md bg-white border rounded-lg shadow-lg max-h-48 overflow-auto">
                    {searchedStudents.map(student => (
                      <div
                        key={student.id}
                        className="p-2 hover:bg-gray-100 cursor-pointer flex items-center justify-between"
                        onClick={() => handleAddAllocation(student)}
                        data-testid={`option-student-${student.id}`}
                      >
                        <div>
                          <p className="font-medium">{student.firstName} {student.lastName}</p>
                          <p className="text-sm text-gray-500">{student.email}</p>
                        </div>
                        <Plus className="w-4 h-4 text-gray-400" />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {allocations.length > 0 && (
                <div className="space-y-2">
                  <Label>Allocations</Label>
                  {allocations.map((allocation, index) => (
                    <div key={index} className="flex items-center gap-3 p-3 border rounded-lg">
                      <div className="flex-1">
                        <p className="font-medium">{allocation.studentName}</p>
                        {allocation.isCredit && (
                          <Badge variant="outline" className="text-xs">Credit Balance</Badge>
                        )}
                      </div>
                      <div className="w-32">
                        <div className="relative">
                          <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            value={allocation.amount || ""}
                            onChange={(e) => updateAllocationAmount(index, parseFloat(e.target.value) || 0)}
                            className="pl-6 h-8"
                            data-testid={`input-allocation-amount-${index}`}
                          />
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeAllocation(index)}
                        data-testid={`button-remove-allocation-${index}`}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex justify-between items-center pt-2 border-t">
                    <span className="text-sm text-gray-500">Total Allocated</span>
                    <span className={`font-bold ${allocatedTotal > parseFloat(selectedPayment.amount) ? 'text-red-600' : allocatedTotal === parseFloat(selectedPayment.amount) ? 'text-green-600' : 'text-[#111111]'}`}>
                      ${allocatedTotal.toFixed(2)} / ${parseFloat(selectedPayment.amount).toFixed(2)}
                    </span>
                  </div>
                  {allocatedTotal < parseFloat(selectedPayment.amount) && (
                    <p className="text-sm text-yellow-600 flex items-center gap-1">
                      <AlertTriangle className="w-4 h-4" />
                      ${(parseFloat(selectedPayment.amount) - allocatedTotal).toFixed(2)} remaining will be marked as unallocated
                    </p>
                  )}
                </div>
              )}

              <div>
                <Label>Allocation Notes</Label>
                <Textarea
                  placeholder="Notes about this allocation..."
                  value={allocationNotes}
                  onChange={(e) => setAllocationNotes(e.target.value)}
                  data-testid="input-allocation-notes"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setIsAllocating(false);
              setSelectedPayment(null);
              setAllocations([]);
            }}>
              Cancel
            </Button>
            <Button
              className="bg-[#ECC462] text-[#111111] hover:bg-[#d4b058]"
              onClick={() => {
                if (selectedPayment) {
                  allocatePaymentMutation.mutate({
                    paymentId: selectedPayment.id,
                    allocations,
                    notes: allocationNotes,
                  });
                }
              }}
              disabled={allocations.length === 0 || allocatedTotal === 0 || allocatePaymentMutation.isPending}
              data-testid="button-confirm-allocation"
            >
              {allocatePaymentMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirm Allocation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddingPayer} onOpenChange={setIsAddingPayer}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Payer Profile</DialogTitle>
            <DialogDescription>
              Create a profile for a recurring payer (parent, guardian, employer)
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            createPayerMutation.mutate({
              name: formData.get('name') as string,
              email: formData.get('email') as string || undefined,
              phone: formData.get('phone') as string || undefined,
              relationship: formData.get('relationship') as string || undefined,
            });
          }}>
            <div className="space-y-4 py-4">
              <div>
                <Label>Name *</Label>
                <Input name="name" required placeholder="Full name" data-testid="input-new-payer-name" />
              </div>
              <div>
                <Label>Email</Label>
                <Input name="email" type="email" placeholder="email@example.com" data-testid="input-new-payer-email" />
              </div>
              <div>
                <Label>Phone</Label>
                <Input name="phone" placeholder="(555) 123-4567" data-testid="input-new-payer-phone" />
              </div>
              <div>
                <Label>Relationship</Label>
                <Select name="relationship">
                  <SelectTrigger data-testid="select-relationship">
                    <SelectValue placeholder="Select relationship" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="parent">Parent</SelectItem>
                    <SelectItem value="guardian">Guardian</SelectItem>
                    <SelectItem value="employer">Employer</SelectItem>
                    <SelectItem value="sponsor">Sponsor</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddingPayer(false)}>Cancel</Button>
              <Button
                type="submit"
                className="bg-[#ECC462] text-[#111111] hover:bg-[#d4b058]"
                disabled={createPayerMutation.isPending}
                data-testid="button-submit-payer"
              >
                {createPayerMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Add Payer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
