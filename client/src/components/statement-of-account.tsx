import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, CreditCard, Banknote, Receipt, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";

interface StudentTransaction {
  id: number;
  studentId: number;
  date: string;
  description: string;
  amount: string;
  gst: string;
  pst: string;
  total: string;
  transactionType: "payment" | "charge" | "refund" | "adjustment";
  paymentMethod?: string;
  referenceNumber?: string;
  notes?: string;
  refundStatus?: string | null;
}

interface StatementOfAccountProps {
  studentId: number;
}

export function StatementOfAccount({ studentId }: StatementOfAccountProps) {
  const [isAddingTransaction, setIsAddingTransaction] = useState(false);
  const [refundingTransaction, setRefundingTransaction] = useState<StudentTransaction | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const { toast } = useToast();

  const { data: transactions = [], isLoading } = useQuery<StudentTransaction[]>({
    queryKey: ["/api/student-transactions", studentId],
    queryFn: () => apiRequest("GET", `/api/student-transactions/${studentId}`),
  });

  const addTransactionMutation = useMutation({
    mutationFn: (transaction: Partial<StudentTransaction>) =>
      apiRequest("POST", "/api/student-transactions", { ...transaction, studentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student-transactions", studentId] });
      setIsAddingTransaction(false);
      toast({ title: "Success", description: "Transaction added successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to add transaction", variant: "destructive" });
    },
  });

  const directRefundMutation = useMutation({
    mutationFn: ({ transactionId, amount, reason }: { transactionId: number; amount: string; reason: string }) =>
      apiRequest("POST", `/api/admin/transactions/${transactionId}/refund`, { amount: parseFloat(amount), reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student-transactions", studentId] });
      setRefundingTransaction(null);
      setRefundAmount("");
      setRefundReason("");
      toast({
        title: "Refund issued",
        description: "The refund has been recorded successfully.",
        className: "bg-gradient-to-r from-[#ECC462] to-amber-500 text-[#111111] border-0",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Refund failed",
        description: error?.data?.message || error?.message || "Failed to process refund",
        variant: "destructive",
      });
    },
  });

  const currentBalance = transactions.reduce((balance, transaction) => {
    const amount = parseFloat(transaction.total);
    if (transaction.transactionType === "payment" || transaction.transactionType === "refund") {
      return balance - amount;
    } else {
      return balance + amount;
    }
  }, 0);

  const handleAddTransaction = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const amount = parseFloat(formData.get("amount") as string);
    const gst = parseFloat(formData.get("gst") as string) || 0;
    const pst = parseFloat(formData.get("pst") as string) || 0;
    const total = amount + gst + pst;
    addTransactionMutation.mutate({
      date: formData.get("date") as string,
      description: formData.get("description") as string,
      amount: amount.toFixed(2),
      gst: gst.toFixed(2),
      pst: pst.toFixed(2),
      total: total.toFixed(2),
      transactionType: formData.get("transactionType") as "payment" | "charge" | "refund" | "adjustment",
      paymentMethod: formData.get("paymentMethod") as string,
      referenceNumber: formData.get("referenceNumber") as string,
      notes: formData.get("notes") as string,
    });
  };

  const handleRefundSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!refundingTransaction) return;
    const maxAmount = parseFloat(refundingTransaction.total);
    const amt = parseFloat(refundAmount) || maxAmount;
    if (amt <= 0 || amt > maxAmount) {
      toast({ title: "Invalid amount", description: `Amount must be between $0.01 and $${maxAmount.toFixed(2)}.`, variant: "destructive" });
      return;
    }
    directRefundMutation.mutate({
      transactionId: refundingTransaction.id,
      amount: amt.toFixed(2),
      reason: refundReason,
    });
  };

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case "payment": return <CreditCard className="h-4 w-4" />;
      case "charge": return <Receipt className="h-4 w-4" />;
      case "refund": return <Banknote className="h-4 w-4" />;
      default: return <Receipt className="h-4 w-4" />;
    }
  };

  const getTransactionColor = (type: string) => {
    switch (type) {
      case "payment": return "bg-green-100 text-green-800";
      case "charge": return "bg-blue-100 text-blue-800";
      case "refund": return "bg-orange-100 text-orange-800";
      case "adjustment": return "bg-purple-100 text-purple-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  if (isLoading) return <div>Loading transactions...</div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-2xl font-bold">Statement of Account</CardTitle>
          <Dialog open={isAddingTransaction} onOpenChange={setIsAddingTransaction}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Transaction
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Add New Transaction</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleAddTransaction} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="date">Date</Label>
                    <Input id="date" name="date" type="date" required defaultValue={format(new Date(), "yyyy-MM-dd")} />
                  </div>
                  <div>
                    <Label htmlFor="transactionType">Transaction Type</Label>
                    <Select name="transactionType" required>
                      <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="charge">Charge</SelectItem>
                        <SelectItem value="payment">Payment</SelectItem>
                        <SelectItem value="refund">Refund</SelectItem>
                        <SelectItem value="adjustment">Adjustment</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label htmlFor="description">Description</Label>
                  <Input id="description" name="description" placeholder="Enter transaction description" required />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="amount">Amount</Label>
                    <Input id="amount" name="amount" type="number" step="0.01" placeholder="0.00" required />
                  </div>
                  <div>
                    <Label htmlFor="gst">GST</Label>
                    <Input id="gst" name="gst" type="number" step="0.01" placeholder="0.00" />
                  </div>
                  <div>
                    <Label htmlFor="pst">PST</Label>
                    <Input id="pst" name="pst" type="number" step="0.01" placeholder="0.00" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="paymentMethod">Payment Method</Label>
                    <Select name="paymentMethod">
                      <SelectTrigger><SelectValue placeholder="Select method" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="credit">Credit Card</SelectItem>
                        <SelectItem value="debit">Debit Card</SelectItem>
                        <SelectItem value="check">Check</SelectItem>
                        <SelectItem value="e-transfer">E-Transfer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="referenceNumber">Reference Number</Label>
                    <Input id="referenceNumber" name="referenceNumber" placeholder="Enter reference number" />
                  </div>
                </div>
                <div>
                  <Label htmlFor="notes">Notes</Label>
                  <Input id="notes" name="notes" placeholder="Additional notes (optional)" />
                </div>
                <div className="flex justify-end space-x-2">
                  <Button type="button" variant="outline" onClick={() => setIsAddingTransaction(false)}>Cancel</Button>
                  <Button type="submit" disabled={addTransactionMutation.isPending}>
                    {addTransactionMutation.isPending ? "Adding..." : "Add Transaction"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>

        <CardContent>
          <div className="mb-6 p-4 bg-blue-50 rounded-lg">
            <div className="flex justify-between items-center">
              <span className="text-lg font-semibold">Current Balance:</span>
              <span className={`text-2xl font-bold ${currentBalance >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                ${Math.abs(currentBalance).toFixed(2)} {currentBalance >= 0 ? 'Owing' : 'Credit'}
              </span>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>GST</TableHead>
                <TableHead>PST</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell>{format(new Date(transaction.date), "MMM d, yyyy")}</TableCell>
                  <TableCell className="font-medium">{transaction.description}</TableCell>
                  <TableCell>
                    <Badge className={getTransactionColor(transaction.transactionType)}>
                      <div className="flex items-center gap-1">
                        {getTransactionIcon(transaction.transactionType)}
                        {transaction.transactionType.charAt(0).toUpperCase() + transaction.transactionType.slice(1)}
                      </div>
                    </Badge>
                  </TableCell>
                  <TableCell>${parseFloat(transaction.amount).toFixed(2)}</TableCell>
                  <TableCell>${parseFloat(transaction.gst).toFixed(2)}</TableCell>
                  <TableCell>${parseFloat(transaction.pst).toFixed(2)}</TableCell>
                  <TableCell className="font-semibold">${parseFloat(transaction.total).toFixed(2)}</TableCell>
                  <TableCell className="capitalize">{transaction.paymentMethod || "N/A"}</TableCell>
                  <TableCell className="text-right">
                    {transaction.transactionType === "payment" && transaction.refundStatus !== "refunded" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => {
                          setRefundingTransaction(transaction);
                          setRefundAmount(parseFloat(transaction.total).toFixed(2));
                          setRefundReason("");
                        }}
                        title="Issue refund"
                      >
                        <RotateCcw className="h-4 w-4 mr-1" />
                        Refund
                      </Button>
                    ) : transaction.refundStatus === "refunded" ? (
                      <Badge className="bg-orange-100 text-orange-800 text-xs">Refunded</Badge>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
              {transactions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-gray-500 py-8">
                    No transactions found. Click "Add Transaction" to get started.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Direct Refund Dialog */}
      <Dialog open={!!refundingTransaction} onOpenChange={(open) => { if (!open) { setRefundingTransaction(null); setRefundAmount(""); setRefundReason(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-red-600" />
              Issue Refund
            </DialogTitle>
          </DialogHeader>
          {refundingTransaction && (
            <form onSubmit={handleRefundSubmit} className="space-y-4">
              <div className="p-3 bg-gray-50 rounded-lg text-sm space-y-1">
                <p><span className="text-gray-500">Transaction:</span> <span className="font-medium">{refundingTransaction.description}</span></p>
                <p><span className="text-gray-500">Original amount:</span> <span className="font-medium">${parseFloat(refundingTransaction.total).toFixed(2)}</span></p>
              </div>
              <div>
                <Label htmlFor="refund-amount">Refund Amount</Label>
                <Input
                  id="refund-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={parseFloat(refundingTransaction.total)}
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  required
                />
                <p className="text-xs text-gray-500 mt-1">Max: ${parseFloat(refundingTransaction.total).toFixed(2)} — leave at full amount for a complete refund</p>
              </div>
              <div>
                <Label htmlFor="refund-reason">Reason <span className="text-red-500">*</span></Label>
                <Textarea
                  id="refund-reason"
                  placeholder="Enter reason for refund..."
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  required
                  rows={3}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => { setRefundingTransaction(null); setRefundAmount(""); setRefundReason(""); }}>
                  Cancel
                </Button>
                <Button type="submit" variant="destructive" disabled={directRefundMutation.isPending || !refundReason.trim()}>
                  {directRefundMutation.isPending ? "Processing..." : "Issue Refund"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
